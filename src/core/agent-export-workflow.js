import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_LIVE_PROFILE_DIR,
  DEFAULT_MAX_SYNC_AGE_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  AWESOME_MYCHART_ROOT,
} from './paths.js';
import {
  getLatestClinicalDateFromCards,
  getRecentClinicalDateRange,
  normalizeClinicalDateForRange,
} from './clinical-dates.js';
import {
  assertFreshDeepSync,
  buildRecordsAgentJsonlExport,
  buildRecordsMarkdownExport,
  filterRecordCards,
  readStoredRecords,
  writeRecordsAgentJsonlExport,
  writeRecordsMarkdownExport,
} from './record-exports.js';
import {
  closeLiveHarnessDashboard,
  openBrowserSession,
  triggerRawDeepSync,
} from '../browser/sync-api.js';
import {
  loginToMyChartWithEnv,
  switchMyChartProxyContext,
} from '../browser/mychart-auth.js';
import { loadEnvironmentFile } from './env.js';
import { hashCanonicalIdentity, normalizeSyncCategories } from './sync-route-classifier.js';
import { bindPatientContext } from '../browser/patient-context.js';
import { readLiveHarnessSession } from '../browser/sync-runner.js';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function createPullStateScopeKey(options = {}) {
  const categoryScope = Array.isArray(options.categories) && options.categories.length
    ? [...new Set(options.categories.map((item) => String(item).trim().toLowerCase()))].sort().join(',')
    : options.category || '';
  return [
    `patientKey=${options.patientKey || ''}`,
    `patientLabel=${options.patientLabelExact || options.patient || ''}`,
    ...(options._contextScope ? [`contextScope=${options._contextScope}`] : []),
    `categories=${categoryScope}`,
    `category=${options.category || ''}`,
    `query=${options.query || ''}`,
  ].join('|');
}

function normalizeLegacyPullStateKey(key = '') {
  return String(key).split('|').map((part) => {
    if (!part.startsWith('categories=')) return part;
    const categories = part.slice('categories='.length).split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
    return `categories=${[...new Set(categories)].sort().join(',')}`;
  }).join('|');
}

export async function readPullState(statePath) {
  if (!statePath) return {};
  try {
    const raw = await readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

export async function writePullState(statePath, state) {
  if (!statePath) throw new Error('pull state path is required.');
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return statePath;
}

export async function findLatestExportEndDateFromFilenames({
  outputDir = process.cwd(),
} = {}) {
  let entries = [];
  try {
    entries = await readdir(outputDir);
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }

  let latest = '';
  for (const entry of entries) {
    const match = /^mychart-cli-records-\d{4}-\d{2}-\d{2}-to-(\d{4}-\d{2}-\d{2})-/.exec(entry);
    if (match && match[1] > latest) latest = match[1];
  }
  return latest;
}

export async function resolveSinceLastPullRange({
  cards = [],
  options = {},
  outputDir = process.cwd(),
} = {}) {
  const latestDate = getLatestClinicalDateFromCards(cards);
  if (!latestDate) {
    throw new Error('No dated records matched the current filters, so since-last-pull export cannot be built.');
  }
  if (!options.pullStatePath) {
    throw new Error('--since-last-pull requires --pull-state PATH.');
  }

  const statePath = options.pullStatePath;
  const state = await readPullState(statePath);
  const stateKey = createPullStateScopeKey(options);
  const equivalentStateEntries = Object.entries(state.scopes || {})
    .filter(([key]) => normalizeLegacyPullStateKey(key) === stateKey)
    .map(([key, value]) => ({ key, date: value?.lastClinicalDate || '' }))
    .filter((entry) => ISO_DATE_PATTERN.test(entry.date));
  const savedEntry = equivalentStateEntries.sort((a, b) => b.date.localeCompare(a.date))[0];
  const savedDate = savedEntry?.date || '';
  const fallbackDate = savedDate || await findLatestExportEndDateFromFilenames({ outputDir });
  const dateRange = fallbackDate
    ? { startDate: fallbackDate, endDate: latestDate }
    : getRecentClinicalDateRangeEndingAtLatest({
        cards,
        days: options.days || 3,
        startDate: options.startDate,
        endDate: options.endDate,
      });

  assertIsoDate(dateRange.startDate, 'Computed start date');
  assertIsoDate(dateRange.endDate, 'Computed end date');
  if (dateRange.startDate > dateRange.endDate) {
    return {
      startDate: latestDate,
      endDate: latestDate,
      state,
      statePath,
      fallbackSource: savedDate ? 'pull-state' : fallbackDate ? 'export-filename' : 'days',
    };
  }

  return {
    ...dateRange,
    state,
    stateKey,
    statePath,
    fallbackSource: savedDate ? 'pull-state' : fallbackDate ? 'export-filename' : 'days',
  };
}

export function validateAgentExportOptions(options = {}) {
  const format = options.format || 'jsonl';
  if (!['jsonl', 'markdown'].includes(format)) {
    throw new Error('--format must be jsonl or markdown.');
  }
  if (options.latestDay && options.all) {
    throw new Error('--latest-day cannot be combined with --all.');
  }
  if (options.sinceLastPull && options.all) {
    throw new Error('--since-last-pull cannot be combined with --all.');
  }
  if (options.sinceLastPull && options.latestDay) {
    throw new Error('--since-last-pull cannot be combined with --latest-day.');
  }
  if (options.sinceLastPull && options.startDate) {
    throw new Error('--since-last-pull cannot be combined with --start-date.');
  }
  if (options.sinceLastPull && options.endDate) {
    throw new Error('--since-last-pull cannot be combined with --end-date.');
  }
  if (options.days !== undefined && (!Number.isFinite(Number(options.days)) || Number(options.days) < 1)) {
    throw new Error('--days must be a positive number.');
  }
  for (const [flag, value] of [
    ['--max-pages', options.maxPages],
    ['--max-records', options.maxRecords],
    ['--max-broad-pages', options.maxBroadPages],
  ]) {
    if (value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 1)) {
      throw new Error(`${flag} must be a positive number.`);
    }
  }
  if (options.timeoutSeconds !== undefined
    && (!Number.isFinite(Number(options.timeoutSeconds)) || Number(options.timeoutSeconds) < 1)) {
    throw new Error('--timeout-seconds must be a positive number.');
  }
  if (options.maxSyncAgeMinutes !== undefined
    && (!Number.isFinite(Number(options.maxSyncAgeMinutes)) || Number(options.maxSyncAgeMinutes) < 1)) {
    throw new Error('--max-sync-age-minutes must be a positive number.');
  }
}

export async function runAgentExportWorkflow(options = {}) {
  options = { ...options };
  if (options.categories?.length) options.categories = normalizeSyncCategories(options.categories);
  if (options.category) {
    options.category = String(options.category).trim().toLowerCase();
    normalizeSyncCategories([options.category]);
  }
  if (options.category && options.categories?.length && !options.categories.includes(options.category)) {
    throw new Error('--category must be included in --categories when both are supplied.');
  }
  validateAgentExportOptions(options);
  const format = options.format || 'jsonl';
  const outputDir = options.outputDir || process.cwd();
  let syncStatus = null;
  let loginStatus = null;
  let proxyStatus = null;

  if (options.login || options.switchPatient || options.sync) {
    const { browser, page, session } = await openBrowserSession({
      profileDir: options.profileDir || DEFAULT_LIVE_PROFILE_DIR,
      timeoutSeconds: options.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS,
    });
    try {
      if (options.login) {
        await loadEnvironmentFile({
          envPath: options.envFile || path.join(AWESOME_MYCHART_ROOT, '.env'),
        });
        loginStatus = await loginToMyChartWithEnv(browser, {
          session,
          timeoutSeconds: options.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS,
        });
        if (!['logged_in', 'already_logged_in'].includes(loginStatus.status)) {
          throw new Error(`MyChart login did not complete automatically: ${loginStatus.status}`);
        }
      }

      if (options.switchPatient) {
        proxyStatus = await switchMyChartProxyContext(browser, {
          session,
          patient: options.switchPatient,
          timeoutSeconds: options.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS,
        });
      }

      if (options.sync) {
        syncStatus = await triggerRawDeepSync(page, {
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
          maxTransientRetries: options.maxTransientRetries ?? 1,
          onProgress: options.onSyncProgress || (() => {}),
          onRetry: options.onSyncRetry || (() => {}),
        });
      }
    } finally {
      await closeLiveHarnessDashboard({ browser, page });
    }
  }

  const { cards, records, syncMetadata } = await readStoredRecords({
    storePath: options.storePath,
  });
  const persistedFreshness = await resolvePersistedFreshness({ options, syncMetadata });
  const freshness = syncStatus
    ? {
        ...persistedFreshness,
        safe: Boolean(syncStatus.freshnessSafe && persistedFreshness.safe),
        status: syncStatus.freshnessSafe && persistedFreshness.safe ? 'safe' : 'unsafe',
        run: syncStatus,
      }
    : persistedFreshness;
  if (freshness.scopeKey) options._contextScope = freshness.scopeKey;
  const filtered = filterRecordCards({
    cards,
    records,
    patient: options.patient,
    patientLabelExact: options.patientLabelExact,
    patientKey: options.patientKey,
    category: options.category,
    categories: options.categories || [],
    query: options.query,
  });
  const latestClinicalDate = getLatestClinicalDateFromCards(filtered.cards);
  const dateRange = await resolveExportDateRange({
    cards: filtered.cards,
    syncMetadata,
    options,
    outputDir,
  });
  const filters = createExportFilters(options, dateRange);
  const exportDownload = format === 'jsonl'
    ? buildRecordsAgentJsonlExport({
        cards: filtered.cards,
        records: filtered.recordsById,
        all: options.all,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        filters,
        syncMetadata,
        generatedAt: options.generatedAt,
        chunkSize: options.chunkSize,
        chunkOverlap: options.chunkOverlap,
      })
    : buildRecordsMarkdownExport({
        cards: filtered.cards,
        records: filtered.recordsById,
        all: options.all,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        filters,
        generatedAt: options.generatedAt,
      });
  const outputPath = options.outputPath
    || path.join(outputDir, exportDownload.filename);

  if (format === 'jsonl') {
    await writeRecordsAgentJsonlExport({ outputPath, content: exportDownload.content });
  } else {
    await writeRecordsMarkdownExport({ outputPath, content: exportDownload.content });
  }

  const recordCount = exportDownload.exportedCards.length;
  const pullState = await maybeUpdatePullState({
    options,
    dateRange,
    outputPath,
    recordCount,
    freshnessSafe: freshness.safe,
  });

  return {
    outputPath,
    format,
    contentType: exportDownload.mimeType || (format === 'jsonl' ? 'application/x-ndjson' : 'text/markdown'),
    recordCount,
    chunkCount: exportDownload.chunkLines?.length || 0,
    dateRange: {
      startDate: dateRange.startDate || '',
      endDate: dateRange.endDate || '',
      all: Boolean(options.all),
      mode: dateRange.mode,
    },
    latestClinicalDate,
    filters,
    stored: {
      recordCount: records.length,
      indexCardCount: cards.length,
      totalMatchingCount: filtered.totalMatchingCount,
      totalCardCount: filtered.totalCardCount,
    },
    lastDeepSyncAt: syncMetadata?.lastDeepSyncAt || '',
    freshnessSafe: freshness.safe,
    freshnessStatus: freshness.status || (freshness.safe ? 'safe' : 'unsafe'),
    sync: summarizeSyncStatus(syncStatus),
    login: loginStatus ? { status: loginStatus.status || '' } : null,
    proxy: proxyStatus ? { status: proxyStatus.status || '' } : null,
    pullState,
    categoryCounts: countBy(exportDownload.exportedCards, (card) => card.category || 'record'),
    sourceHostCounts: countSourceHosts(exportDownload.exportedCards, filtered.recordsById),
    clinicalDelta: exportDownload.manifest?.clinicalDelta || null,
    duplicateCounts: exportDownload.duplicateCounts || exportDownload.manifest?.duplicateCounts || null,
    babySafeSummary: createBabySafeSummary(exportDownload.exportedCards, filtered.recordsById),
    filename: exportDownload.filename,
  };
}

async function resolvePersistedFreshness({ options = {}, syncMetadata = {} } = {}) {
  if (!options.requireActivePatient || !options.categories?.length) {
    return { safe: false, status: 'unknown' };
  }
  try {
    const profileDir = options.profileDir || DEFAULT_LIVE_PROFILE_DIR;
    const session = await readLiveHarnessSession({ profileDir });
    const origin = new URL(session.mychartUrl).origin;
    const binding = await bindPatientContext({
      profileDir,
      origin,
      normalizedLabel: String(options.requireActivePatient).replace(/\s+/g, ' ').trim().toLowerCase(),
      validated: false,
    });
    if (!binding.bound) return { safe: false, status: 'unknown' };
    const scopeKey = hashCanonicalIdentity(`${origin}|${binding.token}|${options.categories.join(',')}`);
    const run = syncMetadata.syncRuns?.[scopeKey];
    if (!run || run.inProgress) {
      return { safe: false, status: run?.inProgress ? 'interrupted' : 'unknown', scopeKey };
    }
    return {
      safe: Boolean(run.freshnessSafe),
      status: run.freshnessSafe ? 'safe' : 'unsafe',
      run,
      scopeKey,
    };
  } catch {
    return { safe: false, status: 'unknown' };
  }
}

async function resolveExportDateRange({
  cards,
  syncMetadata,
  options,
  outputDir,
} = {}) {
  if (options.all) return { startDate: '', endDate: '', mode: 'all' };
  if (options.sinceLastPull) {
    return {
      ...await resolveSinceLastPullRange({ cards, options, outputDir }),
      mode: 'since-last-pull',
    };
  }
  const latestDate = options.latestDay ? getLatestClinicalDateFromCards(cards) : '';
  if (options.latestDay && !latestDate) {
    throw new Error('No dated records matched the current filters, so latest-day export cannot be built.');
  }
  if (options.latestDay && !options.sync && !options.allowStaleExport) {
    assertFreshDeepSync({
      syncMetadata,
      maxAgeMinutes: options.maxSyncAgeMinutes || DEFAULT_MAX_SYNC_AGE_MINUTES,
    });
  }
  if (options.latestDay) {
    return { startDate: latestDate, endDate: latestDate, mode: 'latest-day' };
  }
  return {
    ...getRecentClinicalDateRange({
      days: options.days || 3,
      startDate: options.startDate,
      endDate: options.endDate,
      all: false,
    }),
    mode: options.startDate || options.endDate ? 'explicit-range' : 'recent-days',
  };
}

function getRecentClinicalDateRangeEndingAtLatest({
  cards = [],
  days = 3,
  startDate = '',
  endDate = '',
} = {}) {
  const rangeEnd = endDate || getLatestClinicalDateFromCards(cards);
  if (!rangeEnd) throw new Error('No dated records matched the current filters.');
  const rangeStart = startDate || (() => {
    const date = new Date(`${rangeEnd}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - Math.floor(Number(days || 3)) + 1);
    return date.toISOString().slice(0, 10);
  })();
  return { startDate: rangeStart, endDate: rangeEnd };
}

function createExportFilters(options = {}, dateRange = {}) {
  return {
    query: options.query || '',
    patientKey: options.patientKey || '',
    patientLabel: options.patientLabelExact || options.patient || '',
    category: options.category || '',
    startDate: dateRange.startDate || '',
    endDate: dateRange.endDate || '',
  };
}

async function maybeUpdatePullState({
  options,
  dateRange,
  outputPath,
  recordCount,
  freshnessSafe = false,
} = {}) {
  if (!options.sinceLastPull) {
    return { enabled: false, updated: false };
  }
  const statePath = dateRange.statePath || options.pullStatePath;
  const stateKey = dateRange.stateKey || createPullStateScopeKey(options);
  if (!freshnessSafe) {
    return {
      enabled: true,
      updated: false,
      path: statePath,
      lastClinicalDate: dateRange.endDate || '',
      reason: 'freshness-unsafe',
    };
  }
  if (recordCount <= 0) {
    return {
      enabled: true,
      updated: false,
      path: statePath,
      lastClinicalDate: dateRange.endDate || '',
      reason: 'no-records-exported',
    };
  }
  const updatedAt = new Date().toISOString();
  const updatedState = {
    ...(dateRange.state || {}),
    version: 1,
    updatedAt,
    scopes: {
      ...((dateRange.state && dateRange.state.scopes) || {}),
      [stateKey]: {
        lastClinicalDate: dateRange.endDate,
        lastOutputPath: outputPath,
        lastRecordCount: recordCount,
        updatedAt,
      },
    },
  };
  await writePullState(statePath, updatedState);
  return {
    enabled: true,
    updated: true,
    path: statePath,
    lastClinicalDate: dateRange.endDate || '',
    fallbackSource: dateRange.fallbackSource || '',
  };
}

function summarizeSyncStatus(syncStatus) {
  if (!syncStatus) return null;
  return {
    status: syncStatus.status || '',
    success: Boolean(syncStatus.success),
    pagesPlanned: syncStatus.pagesPlanned || 0,
    pagesVisited: syncStatus.pagesVisited || 0,
    broadPagesAttempted: syncStatus.broadPagesAttempted || 0,
    broadPagesVisited: syncStatus.broadPagesVisited || 0,
    recordsSaved: syncStatus.recordsSaved || 0,
    errorCount: (syncStatus.errors || []).length,
    completionReason: syncStatus.completionReason || '',
    truncated: Boolean(syncStatus.truncated),
    freshnessSafe: Boolean(syncStatus.freshnessSafe),
    requestedMode: syncStatus.requestedMode || '',
    effectiveMode: syncStatus.effectiveMode || '',
    fallbackReason: syncStatus.fallbackReason || '',
    activePatientContext: syncStatus.activePatientContext || '',
    requestedCategories: syncStatus.requestedCategories || [],
    categoryCompletion: syncStatus.categoryCompletion || {},
    routeCounts: syncStatus.routeCounts || {},
    navigatedRouteCounts: syncStatus.navigatedRouteCounts || {},
    stageTimingsMs: syncStatus.stageTimingsMs || {},
    recordDeltas: syncStatus.recordDeltas || {},
    checkpointWrites: syncStatus.checkpointWrites || 0,
    startedAt: syncStatus.startedAt || '',
    finishedAt: syncStatus.finishedAt || '',
  };
}

function countBy(items = [], getKey = () => '') {
  return items.reduce((counts, item) => {
    const key = getKey(item);
    if (!key) return counts;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function countSourceHosts(cards = [], recordsById = new Map()) {
  return countBy(cards, (card) => {
    const record = recordsById.get(card.id) || {};
    const sourceUrl = card.sourceUrl || record.sourceUrl || '';
    try {
      return new URL(sourceUrl).host;
    } catch {
      return sourceUrl ? 'invalid-url' : '';
    }
  });
}

function createBabySafeSummary(cards = [], recordsById = new Map()) {
  const sortedCards = [...cards].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const latestClinicalDate = sortedCards
    .map((card) => normalizeClinicalDateForRange(card.date || recordsById.get(card.id)?.date || ''))
    .filter(Boolean)
    .sort()
    .at(-1) || '';
  const categories = Object.entries(countBy(cards, (card) => card.category || 'record'))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count]) => ({ category, count }));
  const visitNotes = sortedCards
    .filter((card) => card.category === 'visits' && (card.recordType === 'visit-note' || /note/i.test(card.title || '')))
    .slice(0, 12)
    .map((card) => ({
      title: card.title || 'Visit note',
      author: extractAuthorFromTitle(card.title || ''),
      date: normalizeClinicalDateForRange(card.date || '') || card.date || '',
    }));
  const keyTestNames = [...new Set(sortedCards
    .filter((card) => card.category === 'test-results')
    .map((card) => recordsById.get(card.id)?.metadata?.analyte || card.title || '')
    .map((title) => String(title || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean))]
    .slice(0, 16);
  return {
    latestClinicalDate,
    categories,
    visitNotes,
    keyTestNames,
    likelyFilesToUpdate: inferLikelyBabyFiles({ cards, keyTestNames }),
  };
}

function extractAuthorFromTitle(title = '') {
  const match = String(title || '').match(/\bby\s+(.+?)(?:\s+at\s+\d|\s+on\s+|$)/i);
  return match?.[1]?.trim() || '';
}

function inferLikelyBabyFiles({ cards = [], keyTestNames = [] } = {}) {
  const haystack = [
    ...cards.map((card) => `${card.category || ''} ${card.recordType || ''} ${card.title || ''}`),
    ...keyTestNames,
  ].join(' ');
  const files = new Set();
  if (cards.length) files.add('medical');
  if (/\b(?:feed|feeding|lactation|nutrition|diet|fortif|breast|bottle|formula|milk)\b/i.test(haystack)) files.add('feeding');
  if (/\b(?:formula|fortif|neosure|similac|enfamil|human milk fortifier|hmo)\b/i.test(haystack)) files.add('formula');
  if (/\b(?:blood gas|pco2|co2|bicarbonate|hco3|base excess|ph\b|respiratory|oxygen|apnea|brady|desat|episode)\b/i.test(haystack)) {
    files.add('episode-pattern');
  }
  return [...files];
}

function assertIsoDate(date, label) {
  if (!date || !ISO_DATE_PATTERN.test(normalizeClinicalDateForRange(date))) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
}
