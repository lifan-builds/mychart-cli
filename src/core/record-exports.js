import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildAgentJsonlExport } from './agent-jsonl-export.js';
import { getLatestClinicalDateFromCards } from './clinical-dates.js';
import {
  buildDateRangeMarkdownExportDownload,
  buildMarkdownExportDownload,
  filterCardsByRecordDateRange,
} from './markdown-export.js';
import {
  DEFAULT_MAX_SYNC_AGE_MINUTES,
  DEFAULT_STORE_PATH,
} from './paths.js';
import { createRecordBrowserState } from './record-browser.js';
import { JsonMedicalStore } from '../storage/json-store.js';

export function assertFreshDeepSync({
  syncMetadata = {},
  maxAgeMinutes = DEFAULT_MAX_SYNC_AGE_MINUTES,
  now = new Date(),
} = {}) {
  const maxAgeNumber = Number(maxAgeMinutes);
  if (!Number.isFinite(maxAgeNumber) || maxAgeNumber < 1) {
    throw new Error('max sync age must be a positive number of minutes.');
  }
  const lastDeepSyncAt = syncMetadata?.lastDeepSyncAt || '';
  if (!lastDeepSyncAt) {
    throw new Error('No previous mychart-cli deep sync timestamp is available. Run with --sync or --allow-stale-export.');
  }
  const lastDeepSyncTime = Date.parse(lastDeepSyncAt);
  if (Number.isNaN(lastDeepSyncTime)) {
    throw new Error(`mychart-cli deep sync timestamp is invalid: ${lastDeepSyncAt}`);
  }
  const ageMinutes = (now.getTime() - lastDeepSyncTime) / 60000;
  if (ageMinutes > maxAgeNumber) {
    throw new Error(
      `mychart-cli deep sync is stale (${Math.floor(ageMinutes)} minutes old; max ${maxAgeNumber}). Run with --sync or --allow-stale-export.`,
    );
  }
  return {
    lastDeepSyncAt,
    ageMinutes,
    maxAgeMinutes: maxAgeNumber,
  };
}

export async function readStoredRecords({
  storePath = DEFAULT_STORE_PATH,
} = {}) {
  const store = new JsonMedicalStore({ storePath });
  const [cards, records, syncMetadata] = await Promise.all([
    store.getIndexCards(),
    store.getAllRecords(),
    store.getSyncMetadata(),
  ]);
  return { cards, records, syncMetadata };
}

export async function exportRecordsMarkdown({
  cards = [],
  records = [],
  all = false,
  startDate = '',
  endDate = '',
  filters = {},
  generatedAt,
} = {}) {
  return buildRecordsMarkdownExport({
    cards,
    records,
    all,
    startDate,
    endDate,
    filters,
    generatedAt,
  });
}

export function filterRecordCards({
  cards = [],
  records = [],
  patient = '',
  patientLabelExact = '',
  patientKey = '',
  category = '',
  categories = [],
  query = '',
} = {}) {
  const recordsById = records instanceof Map
    ? records
    : new Map(records.map((record) => [record.id, record]));
  let filteredCards = cards.filter((card) => recordsById.has(card.id));

  if (patient) {
    const needle = String(patient).toLowerCase();
    filteredCards = filteredCards.filter((card) => (
      String(card.patient?.label || '').toLowerCase().includes(needle)
    ));
  }

  if (patientLabelExact) {
    const expectedLabel = String(patientLabelExact).replace(/\s+/g, ' ').trim().toLowerCase();
    filteredCards = filteredCards.filter((card) => (
      String(card.patient?.label || card.patient?.name || '').replace(/\s+/g, ' ').trim().toLowerCase() === expectedLabel
    ));
  }

  if (categories.length) {
    const categorySet = new Set(categories);
    filteredCards = filteredCards.filter((card) => categorySet.has(card.category));
  }

  const state = createRecordBrowserState({
    cards: filteredCards,
    records: recordsById,
    patientKey,
    category,
    query,
    selectedRecordId: '',
    limit: Number.POSITIVE_INFINITY,
  });

  return {
    cards: state.filteredCards,
    recordsById,
    totalMatchingCount: state.totalMatchingCount,
    totalCardCount: state.cards.length,
  };
}

export function buildRecordsMarkdownExport({
  cards = [],
  records = [],
  all = false,
  startDate = '',
  endDate = '',
  filters = {},
  generatedAt,
} = {}) {
  const recordsById = records instanceof Map
    ? records
    : new Map(records.map((record) => [record.id, record]));
  const exportDownload = all
    ? buildMarkdownExportDownload({
        generatedAt,
        cards,
        records: recordsById,
        filters,
      })
    : buildDateRangeMarkdownExportDownload({
        generatedAt,
        startDate,
        endDate,
        cards,
        records: recordsById,
        filters,
      });
  const exportedCards = all
    ? cards
    : filterCardsByRecordDateRange(cards, recordsById, { startDate, endDate });
  return {
    ...exportDownload,
    exportedCards,
  };
}

export function buildRecordsAgentJsonlExport({
  cards = [],
  records = [],
  all = false,
  startDate = '',
  endDate = '',
  filters = {},
  syncMetadata = {},
  generatedAt,
  chunkSize,
  chunkOverlap,
} = {}) {
  return buildAgentJsonlExport({
    generatedAt,
    cards,
    records,
    all,
    startDate,
    endDate,
    filters,
    syncMetadata,
    chunkSize,
    chunkOverlap,
  });
}

export function exportLatestDay({
  cards = [],
  records = [],
  patient = '',
  patientLabelExact = '',
  patientKey = '',
  categories,
  category = '',
  query = '',
  filters = {},
  generatedAt,
} = {}) {
  const categorySet = new Set((Array.isArray(categories) ? categories : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean));
  const recordsById = records instanceof Map
    ? records
    : new Map(records.map((record) => [record.id, record]));
  const categoryFilteredCards = categorySet.size
    ? cards.filter((card) => categorySet.has(card.category))
    : cards;
  const filtered = filterRecordCards({
    cards: categoryFilteredCards,
    records: recordsById,
    patient,
    patientLabelExact,
    patientKey,
    category,
    query,
  });
  const latestDate = getLatestClinicalDateFromCards(filtered.cards);
  if (!latestDate) {
    throw new Error('No dated records matched the current filters, so latest-day export cannot be built.');
  }
  const exportDownload = buildRecordsMarkdownExport({
    cards: filtered.cards,
    records: filtered.recordsById,
    startDate: latestDate,
    endDate: latestDate,
    filters: {
      ...filters,
      query,
      patientKey,
      patientLabel: patientLabelExact || patient || filters.patientLabel || '',
      category: category || filters.category || '',
      startDate: latestDate,
      endDate: latestDate,
    },
    generatedAt,
  });

  return {
    ...exportDownload,
    latestDate,
    filteredCards: filtered.cards,
  };
}

export async function writeRecordsMarkdownExport({
  outputPath,
  content,
} = {}) {
  if (!outputPath) throw new Error('outputPath is required.');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, 'utf8');
  return outputPath;
}

export async function writeRecordsAgentJsonlExport({
  outputPath,
  content,
} = {}) {
  if (!outputPath) throw new Error('outputPath is required.');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, 'utf8');
  return outputPath;
}
