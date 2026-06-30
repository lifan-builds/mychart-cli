import { filterCardsByRecordDateRange } from './markdown-export.js';
import { normalizeClinicalDateForRange } from './clinical-dates.js';
import {
  getRecordDisplayText,
  summarizeRecordDisplayQuality,
} from './record-browser.js';

export const AGENT_JSONL_SCHEMA_VERSION = 1;
export const DEFAULT_AGENT_CHUNK_SIZE = 3000;
export const DEFAULT_AGENT_CHUNK_OVERLAP = 300;

export function buildAgentJsonlExport({
  generatedAt = new Date().toISOString(),
  cards = [],
  records = [],
  all = false,
  startDate = '',
  endDate = '',
  filters = {},
  syncMetadata = {},
  chunkSize = DEFAULT_AGENT_CHUNK_SIZE,
  chunkOverlap = DEFAULT_AGENT_CHUNK_OVERLAP,
} = {}) {
  const recordsById = records instanceof Map
    ? records
    : new Map(records.map((record) => [record.id, record]));
  const exportedCards = all
    ? cards
    : filterCardsByRecordDateRange(cards, recordsById, { startDate, endDate });
  const deduped = dedupeExportCards(exportedCards, recordsById, { startDate, endDate });
  const recordEntries = deduped.cards.map((card) => createAgentRecordEntry({
    card,
    record: recordsById.get(card.id) || {},
    chunkSize,
    chunkOverlap,
  }));
  const recordLines = recordEntries.map((entry) => entry.recordLine);
  const chunkLines = recordEntries.flatMap((entry) => entry.chunkLines);
  const timestamp = sanitizeTimestamp(generatedAt);
  const range = all ? 'all' : sanitizeDateRange(startDate, endDate);
  const manifest = {
    type: 'manifest',
    schemaVersion: AGENT_JSONL_SCHEMA_VERSION,
    generatedAt,
    filters,
    recordCount: recordLines.length,
    chunkCount: chunkLines.length,
    syncMetadata: sanitizeSyncMetadata(syncMetadata),
    clinicalDelta: buildClinicalDeltaReport(deduped.cards, recordsById, { startDate, endDate, all }),
    duplicateCounts: deduped.duplicateCounts,
  };
  const lines = [manifest, ...recordLines, ...chunkLines].map((line) => JSON.stringify(line));

  return {
    filename: `mychart-cli-records-${range}-${timestamp}.jsonl`,
    content: `${lines.join('\n')}\n`,
    mimeType: 'application/x-ndjson',
    exportedCards: deduped.cards,
    recordLines,
    chunkLines,
    manifest,
    duplicateCounts: deduped.duplicateCounts,
  };
}

function createAgentRecordEntry({
  card = {},
  record = {},
  chunkSize = DEFAULT_AGENT_CHUNK_SIZE,
  chunkOverlap = DEFAULT_AGENT_CHUNK_OVERLAP,
} = {}) {
  const text = getRecordDisplayText(record, card).trim();
  const chunks = chunkText(text, {
    chunkSize,
    chunkOverlap,
  });
  const patient = card.patient || record.patient || {};
  const category = card.category || record.category || 'record';
  const recordType = card.recordType || record.recordType || category;
  const date = card.date || record.date || '';
  const base = {
    patient: normalizePatientForJsonl(patient),
    category,
    recordType,
    title: card.title || record.title || 'Record',
    date,
    dateIso: normalizeClinicalDateForRange(date),
    sourceUrl: card.sourceUrl || record.sourceUrl || '',
    metadata: sanitizeRecordMetadata(record.metadata || card.metadata || {}),
  };
  const recordId = card.id || record.id || '';
  const recordLine = {
    type: 'record',
    recordId,
    ...base,
    extractedAt: card.extractedAt || record.extractedAt || '',
    quality: summarizeRecordDisplayQuality(card, record),
    attachments: sanitizeAttachments(record.documentAttachments || record.attachments || []),
    textBytes: Buffer.byteLength(text, 'utf8'),
    chunkCount: chunks.length,
  };
  const chunkLines = chunks.map((chunk, index) => ({
    type: 'chunk',
    chunkId: `${recordId}:chunk:${String(index + 1).padStart(4, '0')}`,
    recordId,
    chunkIndex: index,
    chunkCount: chunks.length,
    ...base,
    text: chunk.text,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
  }));

  return { recordLine, chunkLines };
}

function dedupeExportCards(cards = [], recordsById = new Map(), {
  startDate = '',
  endDate = '',
} = {}) {
  const seen = new Map();
  const dedupedCards = [];
  const duplicateKeys = {};
  for (const card of cards) {
    const record = recordsById.get(card.id) || {};
    const key = duplicateKeyForCard(card, record, { startDate, endDate });
    if (!key) {
      dedupedCards.push(card);
      continue;
    }
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { card, record });
      dedupedCards.push(card);
      continue;
    }
    duplicateKeys[key] = (duplicateKeys[key] || 1) + 1;
    const replacement = chooseBetterDuplicate(existing, { card, record });
    if (replacement.card !== existing.card) {
      const index = dedupedCards.findIndex((item) => item.id === existing.card.id);
      if (index >= 0) dedupedCards[index] = card;
      seen.set(key, replacement);
    }
  }
  const duplicateEntries = Object.entries(duplicateKeys)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return {
    cards: dedupedCards,
    duplicateCounts: {
      duplicateKeyCount: duplicateEntries.length,
      totalDuplicateRecords: duplicateEntries.reduce((total, item) => total + item.count - 1, 0),
      keys: duplicateEntries.slice(0, 25),
    },
  };
}

function duplicateKeyForCard(card = {}, record = {}, { startDate = '', endDate = '' } = {}) {
  const sourceUrl = card.sourceUrl || record.sourceUrl || '';
  const analyte = record.metadata?.analyte || card.metadata?.analyte || card.title || record.title || '';
  const date = normalizeClinicalDateForRange(card.date || record.date || '');
  if (!sourceUrl || !analyte || !date) return '';
  return [
    sourceUrl,
    String(analyte).replace(/\s+/g, ' ').trim().toLowerCase(),
    startDate || date,
    endDate || date,
  ].join('|');
}

function chooseBetterDuplicate(left, right) {
  return scoreDuplicateCandidate(right) > scoreDuplicateCandidate(left) ? right : left;
}

function scoreDuplicateCandidate({ card = {}, record = {} } = {}) {
  return [
    record.metadata?.labValues ? 100000 : 0,
    Buffer.byteLength(getRecordDisplayText(record, card), 'utf8'),
    record.extractedAt || card.extractedAt || '',
  ].reduce((total, value) => total + (typeof value === 'number' ? value : 0), 0);
}

function buildClinicalDeltaReport(cards = [], recordsById = new Map(), {
  startDate = '',
  endDate = '',
  all = false,
} = {}) {
  const report = {
    mode: all ? 'all' : startDate && endDate ? 'date-range' : 'unknown',
    newRecords: 0,
    updatedRecords: 0,
    unchangedRepeatedRecords: 0,
    lateRecordsFromPriorDate: 0,
    repeatedClinicalDate: startDate && endDate && startDate < endDate ? startDate : '',
    latestClinicalDate: '',
  };
  for (const card of cards) {
    const record = recordsById.get(card.id) || {};
    const dateIso = normalizeClinicalDateForRange(card.date || record.date || '');
    if (!dateIso) continue;
    if (!report.latestClinicalDate || dateIso > report.latestClinicalDate) report.latestClinicalDate = dateIso;
    if (startDate && dateIso < startDate) report.lateRecordsFromPriorDate += 1;
    else if (report.repeatedClinicalDate && dateIso === report.repeatedClinicalDate) report.unchangedRepeatedRecords += 1;
    else if (!startDate || dateIso > startDate) report.newRecords += 1;
  }
  return report;
}

export function chunkText(text = '', {
  chunkSize = DEFAULT_AGENT_CHUNK_SIZE,
  chunkOverlap = DEFAULT_AGENT_CHUNK_OVERLAP,
} = {}) {
  const source = String(text || '').trim();
  if (!source) return [];
  const maxSize = normalizePositiveInteger(chunkSize, DEFAULT_AGENT_CHUNK_SIZE);
  const overlap = Math.min(
    normalizePositiveInteger(chunkOverlap, DEFAULT_AGENT_CHUNK_OVERLAP),
    Math.max(0, maxSize - 1),
  );
  const chunks = [];
  let start = 0;
  while (start < source.length) {
    const hardEnd = Math.min(source.length, start + maxSize);
    const end = hardEnd >= source.length
      ? source.length
      : findChunkBoundary(source, start, hardEnd, maxSize);
    chunks.push({
      text: source.slice(start, end),
      charStart: start,
      charEnd: end,
    });
    if (end >= source.length) break;
    const nextStart = Math.max(0, end - overlap);
    start = nextStart > start ? nextStart : end;
  }
  return chunks;
}

function findChunkBoundary(text, start, hardEnd, maxSize) {
  const minEnd = start + Math.floor(maxSize * 0.55);
  const window = text.slice(start, hardEnd);
  const candidates = [
    /\n\s*\n/g,
    /\n#{1,6}\s+/g,
    /\n[A-Z][A-Za-z /&(),.-]{2,80}\n/g,
    /[.!?]\s+/g,
    /\s+/g,
  ];

  for (const pattern of candidates) {
    let best = -1;
    for (const match of window.matchAll(pattern)) {
      const candidateEnd = start + match.index + match[0].length;
      if (candidateEnd >= minEnd && candidateEnd <= hardEnd) best = candidateEnd;
    }
    if (best > start) return best;
  }

  return hardEnd;
}

function normalizePatientForJsonl(patient = {}) {
  return {
    key: patient.key || '',
    label: patient.label || patient.name || '',
    relationship: patient.relationship || '',
  };
}

function sanitizeAttachments(attachments = []) {
  return (attachments || []).map((attachment) => ({
    label: attachment.label || '',
    status: attachment.status || '',
    displayName: attachment.displayName || '',
    fileDescription: attachment.fileDescription || '',
    mimeType: attachment.mimeType || '',
    filePath: attachment.filePath || '',
    byteLength: attachment.byteLength || 0,
    sha256: attachment.sha256 || '',
    textExtraction: {
      status: attachment.textExtraction?.status || '',
      method: attachment.textExtraction?.method || '',
      pageCount: attachment.textExtraction?.pageCount || 0,
      textLength: attachment.textExtraction?.textLength || 0,
      error: attachment.textExtraction?.error || '',
      ocrStatus: attachment.textExtraction?.ocrStatus || '',
      ocrMethod: attachment.textExtraction?.ocrMethod || '',
      ocrError: attachment.textExtraction?.ocrError || '',
    },
    sourceUrl: attachment.sourceUrl || '',
    extractedAt: attachment.extractedAt || '',
  }));
}

function sanitizeRecordMetadata(metadata = {}) {
  const sanitized = {};
  if (metadata.analyte) sanitized.analyte = String(metadata.analyte);
  if (metadata.collectedAt) sanitized.collectedAt = String(metadata.collectedAt);
  if (metadata.collectedTime) sanitized.collectedTime = String(metadata.collectedTime);
  if (metadata.specimenType) sanitized.specimenType = String(metadata.specimenType);
  if (Array.isArray(metadata.abnormalFlags)) sanitized.abnormalFlags = metadata.abnormalFlags.map(String);
  if (metadata.labValues && typeof metadata.labValues === 'object') {
    sanitized.labValues = Object.fromEntries(
      Object.entries(metadata.labValues)
        .filter(([, value]) => Number.isFinite(value))
        .map(([key, value]) => [key, value]),
    );
  }
  return sanitized;
}

function sanitizeSyncMetadata(syncMetadata = {}) {
  return {
    lastDeepSyncAt: syncMetadata.lastDeepSyncAt || '',
    lastIncrementalExportAt: syncMetadata.lastIncrementalExportAt || '',
  };
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function sanitizeTimestamp(value = new Date().toISOString()) {
  return String(value).replace(/[:.]/g, '-');
}

function sanitizeDateRange(startDate = '', endDate = '') {
  if (startDate && endDate) return `${startDate}-to-${endDate}`;
  if (startDate) return `from-${startDate}`;
  if (endDate) return `through-${endDate}`;
  return 'all';
}
