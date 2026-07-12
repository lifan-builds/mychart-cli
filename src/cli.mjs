#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { initLiveHarness } from '../scripts/init-live-harness.mjs';
import { validateLiveHarness } from '../scripts/validate-live-harness.mjs';
import { launchLiveHarness } from '../scripts/launch-live-harness.mjs';
import { filterCardsByRecordDateRange } from './core/markdown-export.js';
import {
  filterRecordCards,
  readStoredRecords,
} from './core/record-exports.js';
import { inspectAgentJsonlExportFile } from './core/export-inspect.js';
import { runAgentExportWorkflow } from './core/agent-export-workflow.js';
import { normalizeSyncCategories } from './core/sync-route-classifier.js';
import {
  DEFAULT_LIVE_PROFILE_DIR,
  DEFAULT_TIMEOUT_SECONDS,
} from './core/paths.js';
import {
  closeLiveHarnessDashboard,
  openBrowserSession,
  triggerRawDeepSync,
} from './browser/sync-api.js';
import {
  loginToMyChartWithEnv,
  switchMyChartProxyContext,
} from './browser/mychart-auth.js';
import { loadEnvironmentFile } from './core/env.js';

function usage() {
  return `Usage:
  node src/cli.mjs browser start [--visible|--headless] [--profile PATH] [--url URL]
  node src/cli.mjs browser check
  node src/cli.mjs browser validate
  node src/cli.mjs browser ensure [--headless|--visible] [--validate] [--wait] [--timeout-seconds N] [--profile PATH] [--url URL]
  node src/cli.mjs sync [--login] [--categories visits,test-results] [--require-active-patient TEXT] [--exhaustive] [--max-broad-pages N] [--seed-url URL] [--force] [--max-pages N] [--max-records N] [--switch-patient TEXT]
  node src/cli.mjs records list [--patient-label-exact TEXT] [--category TEXT] [--query TEXT] [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD] [--json] [--store PATH]
  node src/cli.mjs records show --id ID [--json]
  node src/cli.mjs export markdown [--sync] [--latest-day|--since-last-pull --pull-state PATH|--days N|--start-date YYYY-MM-DD --end-date YYYY-MM-DD|--all] [--output PATH|--output-dir PATH] [--json-summary] [--store PATH]
  node src/cli.mjs export jsonl [--sync] [--latest-day|--since-last-pull --pull-state PATH|--days N|--start-date YYYY-MM-DD --end-date YYYY-MM-DD|--all] [--output PATH|--output-dir PATH] [--json-summary] [--store PATH]
  node src/cli.mjs export inspect FILE [--json]
`;
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value.`);
      return argv[index];
    };
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--visible') options.headless = false;
    else if (arg === '--headless') options.headless = true;
    else if (arg === '--profile') options.profileDir = path.resolve(next());
    else if (arg === '--url') options.url = next();
    else if (arg === '--sync') options.sync = true;
    else if (arg === '--login') options.login = true;
    else if (arg === '--env-file') options.envFile = path.resolve(next());
    else if (arg === '--categories') options.categories = next().split(',').map((item) => item.trim()).filter(Boolean);
    else if (arg === '--seed-url') {
      if (!options.seedUrls) options.seedUrls = [];
      options.seedUrls.push(next());
    }
    else if (arg === '--force') options.force = true;
    else if (arg === '--max-pages') options.maxPages = Number(next());
    else if (arg === '--max-records') options.maxRecords = Number(next());
    else if (arg === '--max-broad-pages') options.maxBroadPages = Number(next());
    else if (arg === '--exhaustive') options.exhaustive = true;
    else if (arg === '--require-active-patient') options.requireActivePatient = next();
    else if (arg === '--switch-patient') options.switchPatient = next();
    else if (arg === '--timeout-seconds') options.timeoutSeconds = Number(next());
    else if (arg === '--max-sync-age-minutes') options.maxSyncAgeMinutes = Number(next());
    else if (arg === '--patient') options.patient = next();
    else if (arg === '--patient-label-exact') options.patientLabelExact = next();
    else if (arg === '--patient-key') options.patientKey = next();
    else if (arg === '--category') options.category = next();
    else if (arg === '--query') options.query = next();
    else if (arg === '--start-date') options.startDate = next();
    else if (arg === '--end-date') options.endDate = next();
    else if (arg === '--latest-day') options.latestDay = true;
    else if (arg === '--since-last-pull') options.sinceLastPull = true;
    else if (arg === '--allow-stale-export') options.allowStaleExport = true;
    else if (arg === '--days') options.days = Number(next());
    else if (arg === '--all') options.all = true;
    else if (arg === '--output') options.output = path.resolve(next());
    else if (arg === '--input') options.input = path.resolve(next());
    else if (arg === '--output-dir') options.outputDir = path.resolve(next());
    else if (arg === '--pull-state') options.pullStatePath = path.resolve(next());
    else if (arg === '--store' || arg === '--store-path') options.storePath = path.resolve(next());
    else if (arg === '--json-summary') options.jsonSummary = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--validate') options.validate = true;
    else if (arg === '--wait') options.wait = true;
    else if (arg === '--id') options.id = next();
    else if (!arg.startsWith('-')) {
      if (!options._) options._ = [];
      options._.push(arg);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

async function withSession(options, callback) {
  const session = await openBrowserSession({
    profileDir: options.profileDir || DEFAULT_LIVE_PROFILE_DIR,
    timeoutSeconds: options.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS,
  });
  try {
    return await callback(session);
  } finally {
    await closeLiveHarnessDashboard(session);
  }
}

async function commandBrowser(subcommand, options) {
  if (subcommand === 'start') {
    if (options.profileDir) process.env.AWESOME_MYCHART_PROFILE_DIR = options.profileDir;
    const result = await initLiveHarness({
      headless: options.headless === true,
      mychartUrl: options.url,
    });
    const close = async () => {
      await result.browser?.close();
      process.exit(0);
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    await new Promise((resolve) => result.browser.on('disconnected', resolve));
    return;
  }
  if (subcommand === 'check' || subcommand === 'validate') {
    const requireAuth = subcommand === 'validate';
    const validation = await validateLiveHarness({ requireAuth });
    printBrowserStatus(validation, { requireAuth });
    if (!validation.ok) process.exitCode = 1;
    return;
  }
  if (subcommand === 'ensure') {
    const result = await ensureBrowserHarness(options);
    printBrowserStatus(result.validation, { requireAuth: options.validate !== false });
    if (!result.validation.ok) process.exitCode = 1;
    detachLaunchedBrowserForOneShot(result.launched);
    return;
  }
  throw new Error(`Unknown browser command: ${subcommand || ''}`);
}

function printBrowserStatus(validation, { requireAuth = false } = {}) {
  console.log(JSON.stringify({
    ok: validation.ok,
    browserOk: validation.browserOk,
    mychartOpen: validation.mychartOpen,
    authStatus: validation.authStatus,
    patientContext: validation.patientContext,
    needsMfa: validation.needsMfa,
    endpoint: validation.endpoint,
    mychartTabs: validation.mychartTabs.map((tab) => ({ title: tab.title, url: tab.url })),
    errors: validation.errors,
    requireAuth,
  }, null, 2));
}

async function ensureBrowserHarness(options = {}) {
  if (options.profileDir) process.env.AWESOME_MYCHART_PROFILE_DIR = options.profileDir;
  const requireAuth = options.validate !== false;
  let launched = null;
  let validation = await validateLiveHarness({ requireAuth }).catch((error) => ({
    ok: false,
    browserOk: false,
    mychartOpen: false,
    authStatus: 'unreachable',
    patientContext: null,
    needsMfa: false,
    errors: [error.message],
    endpoint: '',
    mychartTabs: [],
  }));

  if (!validation.browserOk) {
    launched = await launchLiveHarness({
      headless: options.headless !== false,
      mychartUrl: options.url,
      pipe: false,
    });
  }

  const timeoutMs = (options.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS) * 1000;
  const startedAt = Date.now();
  do {
    validation = await validateLiveHarness({ requireAuth }).catch((error) => ({
      ok: false,
      browserOk: false,
      mychartOpen: false,
      authStatus: 'unreachable',
      patientContext: null,
      needsMfa: false,
      errors: [error.message],
      endpoint: '',
      mychartTabs: [],
    }));
    if (validation.ok || !options.wait) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (Date.now() - startedAt < timeoutMs);

  await launched?.browser?.disconnect();
  return { started: Boolean(launched), launched, validation };
}

export function detachLaunchedBrowserForOneShot(launched) {
  const processHandle = launched?.browser?.process?.();
  processHandle?.unref?.();
  for (const stream of processHandle?.stdio || []) {
    stream?.unref?.();
  }
}

async function commandSync(options) {
  options.categories = normalizeSyncCategories(options.categories || []);
  for (const [flag, value] of [
    ['--max-pages', options.maxPages],
    ['--max-records', options.maxRecords],
    ['--max-broad-pages', options.maxBroadPages],
    ['--timeout-seconds', options.timeoutSeconds],
  ]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 1)) {
      throw new Error(`${flag} must be a positive number.`);
    }
  }
  await withSession(options, async ({ browser, page, session }) => {
    if (options.login) {
      await loadEnvironmentFile({ envPath: options.envFile });
      const login = await loginToMyChartWithEnv(browser, {
        session,
        timeoutSeconds: options.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS,
      });
      console.error(`MyChart login status: ${login.status}`);
      if (!['logged_in', 'already_logged_in'].includes(login.status)) {
        throw new Error(`MyChart login did not complete automatically: ${login.status}`);
      }
    }
    if (options.switchPatient) {
      const proxy = await switchMyChartProxyContext(browser, {
        session,
        patient: options.switchPatient,
        timeoutSeconds: options.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS,
      });
      console.error(`MyChart patient context: ${proxy.status}`);
    }
    const status = await triggerRawDeepSync(page, {
      browser,
      session,
      force: options.force,
      categories: options.categories,
      seedUrls: options.seedUrls,
      maxRecords: options.maxRecords,
      maxPages: options.maxPages,
      maxBroadPages: options.maxBroadPages,
      exhaustive: options.exhaustive,
      requireActivePatient: options.requireActivePatient,
      profileDir: options.profileDir || DEFAULT_LIVE_PROFILE_DIR,
      storePath: options.storePath,
      timeoutSeconds: options.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS,
      onProgress: (progress) => {
        console.error(
          `Sync: ${progress.current || 'running'}; pages ${progress.pagesVisited || 0}/${progress.pagesPlanned || 0}; records ${progress.recordsSaved || 0}; errors ${(progress.errors || []).length}`,
        );
      },
    });
    console.log(JSON.stringify(status, null, 2));
  });
}

async function getFilteredRecords(options) {
  const { cards, records, syncMetadata } = await readStoredRecords({
    storePath: options.storePath,
  });
  const filtered = filterRecordCards({
    cards,
    records,
    patient: options.patient,
    patientLabelExact: options.patientLabelExact,
    patientKey: options.patientKey,
    category: options.category,
    query: options.query,
  });
  if (options.startDate || options.endDate) {
    filtered.cards = filterCardsByRecordDateRange(filtered.cards, filtered.recordsById, {
      startDate: options.startDate,
      endDate: options.endDate,
    });
    filtered.totalMatchingCount = filtered.cards.length;
  }
  return { cards, records, syncMetadata, filtered };
}

async function commandRecords(subcommand, options) {
  const { records, filtered } = await getFilteredRecords(options);
  if (subcommand === 'list') {
    const recordsById = filtered.recordsById;
    const rows = filtered.cards.map((card) => ({
      id: card.id,
      patient: card.patient?.label || '',
      category: card.category || '',
      recordType: card.recordType || '',
      date: card.date || '',
      title: card.title || '',
      sourceUrl: card.sourceUrl || recordsById.get(card.id)?.sourceUrl || '',
    }));
    if (options.json) console.log(JSON.stringify(rows, null, 2));
    else rows.forEach((row) => console.log(`${row.date || 'undated'}\t${row.category}\t${row.patient}\t${row.title}\t${row.id}`));
    return;
  }
  if (subcommand === 'show') {
    if (!options.id) throw new Error('records show requires --id.');
    const record = records.find((item) => item.id === options.id);
    if (!record) throw new Error(`No record found for id ${options.id}.`);
    if (options.json) console.log(JSON.stringify(record, null, 2));
    else console.log(record.rawText || record.clinicalText || record.summary || '');
    return;
  }
  throw new Error(`Unknown records command: ${subcommand || ''}`);
}

async function commandExport(subcommand, options) {
  if (subcommand === 'inspect') {
    const inputPath = options.input || (options._?.[0] ? path.resolve(options._[0]) : '');
    if (!inputPath) throw new Error('export inspect requires FILE.');
    const inspection = await inspectAgentJsonlExportFile(inputPath);
    if (options.json) {
      console.log(JSON.stringify(inspection, null, 2));
      return;
    }
    printExportInspection(inspection);
    return;
  }
  if (!['markdown', 'jsonl'].includes(subcommand)) throw new Error(`Unknown export command: ${subcommand || ''}`);
  const summary = await runAgentExportWorkflow({
    ...options,
    format: subcommand,
    outputPath: options.output,
    onSyncProgress: (progress) => {
      console.error(
        `Sync: ${progress.current || 'running'}; pages ${progress.pagesVisited || 0}/${progress.pagesPlanned || 0}; records ${progress.recordsSaved || 0}; errors ${(progress.errors || []).length}`,
      );
    },
    onSyncRetry: ({ attempt, error }) => {
      console.error(`Sync transient browser-frame error; retry ${attempt}: ${error.message}`);
    },
  });
  if (options.jsonSummary) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (summary.login) console.error(`MyChart login status: ${summary.login.status}`);
  if (summary.proxy) console.error(`MyChart patient context: ${summary.proxy.status}${summary.proxy.text ? ` (${summary.proxy.text})` : ''}`);
  if (summary.sync) {
    console.error(`Sync complete: records saved ${summary.sync.recordsSaved}; errors ${summary.sync.errorCount}.`);
  }
  console.log(`Wrote ${summary.recordCount} record(s) to ${summary.outputPath}`);
  console.log(`Stored records available: ${summary.stored.recordCount}; index cards available: ${summary.stored.indexCardCount}`);
  if (summary.lastDeepSyncAt) console.log(`Last deep sync: ${summary.lastDeepSyncAt}`);
  if (summary.pullState?.updated) console.log(`Updated pull state: ${summary.pullState.lastClinicalDate}`);
  if (summary.babySafeSummary) printBabySafeSummary(summary.babySafeSummary);
}

function printExportInspection(inspection) {
  console.log(`File: ${inspection.file}`);
  console.log(`Records: ${inspection.recordCount}`);
  console.log(`Chunks: ${inspection.chunkCount}`);
  console.log(`Clinical date range: ${inspection.clinicalDateRange.startDate || 'unknown'} to ${inspection.clinicalDateRange.endDate || 'unknown'}`);
  console.log(`Latest clinical date: ${inspection.latestDate || 'unknown'}`);
  console.log(`Categories: ${formatCounts(inspection.categories) || 'none'}`);
  console.log(`Source hosts: ${formatCounts(inspection.sourceHosts) || 'none'}`);
  console.log(`Duplicate source/analyte/date-range keys: ${inspection.duplicateCounts.totalDuplicateRecords}`);
  if (inspection.topRecordTitles.length) {
    console.log('Top record titles:');
    for (const row of inspection.topRecordTitles) console.log(`  ${row.count} ${row.title}`);
  }
}

function printBabySafeSummary(summary) {
  console.log(`Latest clinical date: ${summary.latestClinicalDate || 'unknown'}`);
  if (summary.categories.length) console.log(`Categories: ${summary.categories.map((item) => `${item.category} (${item.count})`).join(', ')}`);
  if (summary.visitNotes.length) {
    console.log('Visit notes:');
    for (const note of summary.visitNotes) {
      console.log(`  ${note.date || 'undated'} ${note.title}${note.author ? ` (${note.author})` : ''}`);
    }
  }
  if (summary.keyTestNames.length) console.log(`Key tests: ${summary.keyTestNames.join(', ')}`);
  if (summary.likelyFilesToUpdate.length) console.log(`Likely files to update: ${summary.likelyFilesToUpdate.join(', ')}`);
}

function formatCounts(counts = {}) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => `${key} (${count})`)
    .join(', ');
}

export async function main(argv = process.argv.slice(2)) {
  const [command, subcommand, ...rest] = argv;
  if (command === '--help' || command === '-h') {
    process.stdout.write(usage());
    return;
  }
  if (!command) {
    process.stdout.write(usage());
    return;
  }
  if (command === 'sync') {
    const syncOptions = parseOptions([subcommand, ...rest].filter(Boolean));
    if (syncOptions.help) {
      process.stdout.write(usage());
      return;
    }
    return commandSync(syncOptions);
  }
  const options = parseOptions(rest);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (command === 'browser') return commandBrowser(subcommand, options);
  if (command === 'records') return commandRecords(subcommand, options);
  if (command === 'export') return commandExport(subcommand, options);
  throw new Error(`Unknown command: ${command}`);
}

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (import.meta.url === invokedUrl) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
