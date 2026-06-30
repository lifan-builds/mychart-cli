#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_MAX_SYNC_AGE_MINUTES,
  DEFAULT_LIVE_PROFILE_DIR,
  DEFAULT_TIMEOUT_SECONDS,
} from '../src/core/paths.js';
import { runAgentExportWorkflow } from '../src/core/agent-export-workflow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

function usage() {
  return `Usage:
  node scripts/export-recent-records.mjs [options]

Exports mychart-cli records from the live harness without printing record text
to stdout. For unattended runs, prefer:
  npm run mychart -- browser ensure --headless --validate --wait
Use npm run init:live when interactive login, MFA, CAPTCHA, or device
verification is required.

Options:
  --sync                         Trigger raw deep sync before export.
  --login                        Log into MyChart with env vars before sync/export.
                                Uses AWESOME_MYCHART_USERNAME/AWESOME_MYCHART_PASSWORD
                                or MYCHART_USERNAME/MYCHART_PASSWORD.
  --switch-patient TEXT          Switch MyChart proxy/current patient context before sync.
                                Example: --switch-patient "Demo Child"
  --env-file PATH                Load credential env vars from a gitignored file.
                                Default: .env
  --force                        Force deep sync to revisit URLs.
  --categories visits,test-results
  --seed-url URL                 Visit this exact MyChart detail URL during sync.
                                May be repeated.
  --max-records N
  --max-pages N
  --days N                       Export the last N clinical days. Default: 3.
  --latest-day                   Export only the latest clinical date available
                                after patient/category/query filters.
  --max-sync-age-minutes N       With --latest-day and no --sync, fail if stored
                                sync is older than N minutes. Default: ${DEFAULT_MAX_SYNC_AGE_MINUTES}.
  --allow-stale-export           Allow --latest-day export from stale stored data.
  --start-date YYYY-MM-DD
  --end-date YYYY-MM-DD
  --all                          Export all matching records.
  --patient TEXT                 Patient label contains TEXT.
  --patient-label-exact TEXT     Exact patient label match; preferred for automation.
  --patient-key KEY              Exact mychart-cli patient key.
  --category CATEGORY            visits, test-results, medications, etc.
  --query TEXT                   Dashboard-style search query.
  --output PATH                  Output path.
  --format jsonl|markdown        Export format. Default: jsonl.
  --profile PATH                 Live harness profile path. Default: ${DEFAULT_LIVE_PROFILE_DIR}
  --timeout-seconds N            Sync timeout. Default: ${DEFAULT_TIMEOUT_SECONDS}.
  --help

After writing JSONL, inspect it with:
  npm run mychart -- export inspect <file>
`;
}

function parseArgs(argv) {
  const options = {
    days: 3,
    sync: false,
    login: false,
    force: false,
    all: false,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    profileDir: DEFAULT_LIVE_PROFILE_DIR,
    maxSyncAgeMinutes: DEFAULT_MAX_SYNC_AGE_MINUTES,
    format: 'jsonl',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value.`);
      return argv[index];
    };

    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--sync') options.sync = true;
    else if (arg === '--login') options.login = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--latest-day') options.latestDay = true;
    else if (arg === '--allow-stale-export') options.allowStaleExport = true;
    else if (arg === '--profile') options.profileDir = path.resolve(next());
    else if (arg === '--env-file') options.envFile = path.resolve(next());
    else if (arg === '--seed-url') {
      if (!options.seedUrls) options.seedUrls = [];
      options.seedUrls.push(next());
    }
    else if (arg === '--output') options.output = path.resolve(next());
    else if (arg === '--format') options.format = next();
    else if (arg === '--days') options.days = Number(next());
    else if (arg === '--start-date') options.startDate = next();
    else if (arg === '--end-date') options.endDate = next();
    else if (arg === '--timeout-seconds') options.timeoutSeconds = Number(next());
    else if (arg === '--max-sync-age-minutes') options.maxSyncAgeMinutes = Number(next());
    else if (arg === '--max-records') options.maxRecords = Number(next());
    else if (arg === '--max-pages') options.maxPages = Number(next());
    else if (arg === '--categories') options.categories = next().split(',').map((item) => item.trim()).filter(Boolean);
    else if (arg === '--switch-patient') options.switchPatient = next();
    else if (arg === '--patient') options.patient = next();
    else if (arg === '--patient-label-exact') options.patientLabelExact = next();
    else if (arg === '--patient-key') options.patientKey = next();
    else if (arg === '--category') options.category = next();
    else if (arg === '--query') options.query = next();
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (options.latestDay && options.all) {
    throw new Error('--latest-day cannot be combined with --all.');
  }
  if (!Number.isFinite(options.maxSyncAgeMinutes) || options.maxSyncAgeMinutes < 1) {
    throw new Error('--max-sync-age-minutes must be a positive number.');
  }
  if (!['jsonl', 'markdown'].includes(options.format)) {
    throw new Error('--format must be jsonl or markdown.');
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const summary = await runAgentExportWorkflow({
    ...options,
    outputPath: options.output,
    outputDir: PROJECT_ROOT,
    onSyncProgress: (progress) => {
      console.error(
        `Sync: ${progress.current || 'running'}; pages ${progress.pagesVisited || 0}/${progress.pagesPlanned || 0}; records ${progress.recordsSaved || 0}; errors ${(progress.errors || []).length}`,
      );
    },
    onSyncRetry: ({ attempt, error }) => {
      console.error(`Sync transient browser-frame error; retry ${attempt}: ${error.message}`);
    },
  });
  if (summary.login) console.error(`MyChart login status: ${summary.login.status}`);
  if (summary.proxy) console.error(`MyChart patient context: ${summary.proxy.status}${summary.proxy.text ? ` (${summary.proxy.text})` : ''}`);
  if (summary.sync) {
    console.error(`Sync complete: records saved ${summary.sync.recordsSaved}; errors ${summary.sync.errorCount}.`);
  }
  console.log(`Wrote ${summary.recordCount} record(s) to ${summary.outputPath}`);
  console.log(`Stored records available: ${summary.stored.recordCount}; index cards available: ${summary.stored.indexCardCount}`);
  if (summary.lastDeepSyncAt) console.log(`Last deep sync: ${summary.lastDeepSyncAt}`);
  if (summary.pullState?.updated) console.log(`Updated pull state: ${summary.pullState.lastClinicalDate}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
