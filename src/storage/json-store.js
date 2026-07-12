import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  hashText,
  normalizePatient as sharedNormalizePatient,
} from '../core/identity.js';
import {
  hasStoredVisitNoteSubstance,
  sanitizeStoredVisitText,
  sanitizeStoredVisitTitle,
} from '../core/clinical-record-quality.js';
import {
  augmentRecordsWithDerivedTestResults,
  getIdsToReplaceForSource,
  getIndexCardIdsWithoutRecords,
  getInvalidStoredDataCleanupIds,
  getInvalidStoredVisitShellIds,
  getRecordsWithoutIndexCards,
  prepareExtractedPageForStorage,
  summarizeSavedRecordQuality,
} from '../core/record-intake.js';

export const STORE_VERSION = 1;

export function createEmptyStore(now = new Date().toISOString()) {
  return {
    version: STORE_VERSION,
    updatedAt: now,
    records: [],
    indexCards: [],
    history: [],
    settings: {},
    syncMetadata: {
      lastDeepSyncAt: '',
      lastIncrementalExportAt: '',
      visitedUrls: {},
      patientVisitedUrls: {},
      canonicalCoverage: {},
      syncRuns: {},
    },
  };
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeStoredTestResultText(text = '', patient = null) {
  const label = patient?.label || patient?.name || '';
  return String(text || '')
    .split('\n')
    .map((line) => {
      let cleaned = line
        .replace(/\bWaiting to start\.\.\./gi, ' ')
        .replace(/\bResultsCompare result trends\b/gi, 'Results')
        .replace(/\bCompare result trends\b/gi, ' ')
        .replace(/\bView trends\b/gi, ' ')
        .replace(/\b(Value|Your value is|Normal range:|Normal value:)(?=\S)/gi, '$1 ')
        .replace(/(\d(?:\.\d+)?)(High|Low)\b/gi, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
      if (label) {
        cleaned = cleaned
          .replace(new RegExp(`\\s*\\(${escapeRegExp(label)}\\)\\s*$`, 'i'), '')
          .trim();
      }
      return cleaned;
    })
    .filter((line) => line && !/^\)+$/.test(line))
    .join('\n')
    .trim();
}

function sanitizeStoredTestResultTitle(title = '', patient = null) {
  let cleaned = String(title || '').trim();
  const label = patient?.label || patient?.name || '';
  if (label) {
    cleaned = cleaned
      .replace(new RegExp(`\\s*\\(${escapeRegExp(label)}\\)\\s*$`, 'i'), '')
      .trim();
  }
  return cleaned || title;
}

function sanitizeStoredMedicationText(text = '') {
  let normalized = String(text || '')
    .replace(/\bDetails\s+(?=Documented by|Started taking|Prescribed|Approved by|Quantity|Day supply)\b/gi, ' ')
    .replace(/\bPrescription Details\s*/gi, ' ')
    .replace(/\bRefill Details\s*/gi, ' ')
    .replace(/\bPharmacy Details\b.*$/i, ' ')
    .replace(/\bRequest refill\b/gi, ' ')
    .replace(/\bDetailsStarted taking\b/gi, 'Started taking')
    .replace(/\bPrescribed([A-Z][a-z]+ \d{1,2}, \d{4})/g, 'Prescribed $1')
    .replace(/\bApproved by([A-Z])/g, 'Approved by $1')
    .replace(/\bQuantity(\d)/g, 'Quantity $1')
    .replace(/\bDay supply(\d)/g, 'Day supply $1')
    .replace(/\bStarted taking([A-Z][a-z]+ \d{1,2}, \d{4})/g, 'Started taking $1')
    .replace(/\bDocumented by([A-Z])/g, 'Documented by $1')
    .replace(/\s+/g, ' ')
    .trim();
  const firstCommonName = normalized.search(/\bCommonly known as:/i);
  if (firstCommonName >= 0) {
    const secondCommonName = normalized.slice(firstCommonName + 1).search(/\bCommonly known as:/i);
    if (secondCommonName >= 0) {
      normalized = normalized.slice(0, firstCommonName + 1 + secondCommonName).trim();
    }
  }
  const parts = normalized.split(/\s+(?=Commonly known as:|Started taking |Documented by |Prescribed |Approved by |Quantity |Day supply )/i);
  const seen = new Set();
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(' ')
    .trim();
}

function inferPatientFromStoredRecord(record = {}) {
  const text = [record.title, record.summary, record.rawText, record.snippet]
    .filter(Boolean)
    .join('\n');
  const patterns = [
    /\bYou(?:'|’)re viewing\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,4})\.?\b/i,
    /\bToday(?:'|’)s Visits\s*\(([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,4})\)\b/i,
    /\(([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,4})\)\s*(?:$|\n)/i,
  ];
  for (const pattern of patterns) {
    const name = String(text.match(pattern)?.[1] || '').trim();
    if (name) return sharedNormalizePatient(name);
  }
  return null;
}

export class JsonMedicalStore {
  constructor({ storePath } = {}) {
    if (!storePath) throw new Error('storePath is required.');
    this.storePath = storePath;
  }

  async readStore() {
    try {
      const parsed = JSON.parse(await readFile(this.storePath, 'utf8'));
      return this.normalizeStore(parsed);
    } catch (error) {
      if (error.code === 'ENOENT') return createEmptyStore();
      throw error;
    }
  }

  normalizeStore(store = {}) {
    return {
      ...createEmptyStore(store.updatedAt || new Date().toISOString()),
      ...store,
      records: Array.isArray(store.records) ? store.records : [],
      indexCards: Array.isArray(store.indexCards) ? store.indexCards : [],
      history: Array.isArray(store.history) ? store.history : [],
      settings: store.settings && typeof store.settings === 'object' ? store.settings : {},
      syncMetadata: {
        ...createEmptyStore().syncMetadata,
        ...(store.syncMetadata || store.settings?.deepSyncMetadata || {}),
      },
    };
  }

  async writeStore(store) {
    const nextStore = this.normalizeStore({
      ...store,
      version: STORE_VERSION,
      updatedAt: new Date().toISOString(),
    });
    await mkdir(path.dirname(this.storePath), { recursive: true });
    const tmpPath = `${this.storePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(nextStore, null, 2)}\n`, 'utf8');
    await rename(tmpPath, this.storePath);
    return nextStore;
  }

  mergeExtractedPage(store, extraction) {
    const { sourceUrl, normalizedRecords, normalizedIndexCards, quality } = prepareExtractedPageForStorage({
      extraction,
      normalizeRecord: (record) => this.normalizeRecord(record),
      normalizeIndexCard: (card) => this.normalizeIndexCard(card),
      createIndexCard: (record) => this.createIndexCard(record),
    });
    const recordIdsToDelete = new Set([
      ...getInvalidStoredVisitShellIds(store.records),
      ...(sourceUrl ? getIdsToReplaceForSource(store.records, normalizedRecords, sourceUrl) : []),
    ]);
    const indexIdsToDelete = new Set([
      ...getInvalidStoredVisitShellIds(store.indexCards),
      ...(sourceUrl ? getIdsToReplaceForSource(store.indexCards, normalizedIndexCards, sourceUrl) : []),
      ...getIndexCardIdsWithoutRecords(store.indexCards, store.records, normalizedRecords, recordIdsToDelete),
    ]);
    const originalRecordsById = new Map(store.records.map((record) => [record.id, record]));
    const recordsById = new Map(store.records
      .filter((record) => !recordIdsToDelete.has(record.id)).map((record) => [record.id, record]));
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    for (const record of normalizedRecords) {
      const prior = originalRecordsById.get(record.id);
      if (!prior) inserted += 1;
      else if (JSON.stringify(prior) === JSON.stringify(record)) unchanged += 1;
      else updated += 1;
      recordsById.set(record.id, record);
    }
    const indexById = new Map(store.indexCards
      .filter((card) => !indexIdsToDelete.has(card.id)).map((card) => [card.id, card]));
    getRecordsWithoutIndexCards([...recordsById.values()], [...indexById.values()], [])
      .map((record) => this.createIndexCard(this.normalizeRecord(record)))
      .forEach((card) => indexById.set(card.id, card));
    normalizedIndexCards.forEach((card) => indexById.set(card.id, card));
    store.records = [...recordsById.values()];
    store.indexCards = [...indexById.values()];
    return {
      recordCount: normalizedRecords.length,
      indexCount: normalizedIndexCards.length,
      quality,
      deltas: {
        inserted,
        updated,
        unchanged,
        deleted: [...recordIdsToDelete].filter((id) => !normalizedRecords.some((record) => record.id === id)).length,
      },
    };
  }

  async saveExtractedPage(extraction) {
    const store = await this.readStore();
    const result = this.mergeExtractedPage(store, extraction);
    await this.writeStore(store);
    return result;
  }

  async openWriteSession({ checkpointPages = 10, checkpointMs = 10000 } = {}) {
    return new JsonStoreWriteSession(this, await this.readStore(), { checkpointPages, checkpointMs });
  }

  async cleanupInvalidStoredData() {
    const store = await this.readStore();
    const { recordIds, indexCardIds } = getInvalidStoredDataCleanupIds(store.records, store.indexCards);
    if (!recordIds.length && !indexCardIds.length) return;
    const recordIdSet = new Set(recordIds);
    const indexCardIdSet = new Set(indexCardIds);
    const records = store.records.filter((record) => !recordIdSet.has(record.id));
    const indexCards = store.indexCards.filter((card) => !indexCardIdSet.has(card.id));
    const missingIndexRecords = getRecordsWithoutIndexCards(records, indexCards, []);
    await this.writeStore({
      ...store,
      records,
      indexCards: [
        ...indexCards,
        ...missingIndexRecords.map((record) => this.createIndexCard(this.normalizeRecord(record))),
      ],
    });
  }

  async getAllRecords() {
    await this.cleanupInvalidStoredData();
    const store = await this.readStore();
    return augmentRecordsWithDerivedTestResults(
      store.records.map((record) => this.normalizeRecord(record)),
    );
  }

  async getIndexCards() {
    await this.cleanupInvalidStoredData();
    const store = await this.readStore();
    const normalizedCards = store.indexCards.map((card) => this.normalizeIndexCard(card));
    const existingCardIds = new Set(normalizedCards.map((card) => card.id).filter(Boolean));
    const normalizedRecords = store.records.map((record) => this.normalizeRecord(record));
    const derivedCards = augmentRecordsWithDerivedTestResults(normalizedRecords)
      .filter((record) => record.category === 'test-results' && !existingCardIds.has(record.id))
      .map((record) => this.createIndexCard(record));
    return [...normalizedCards, ...derivedCards];
  }

  async getSyncMetadata() {
    const store = await this.readStore();
    return store.syncMetadata;
  }

  async saveSyncMetadata(metadata) {
    const store = await this.readStore();
    await this.writeStore({
      ...store,
      syncMetadata: {
        lastDeepSyncAt: metadata.lastDeepSyncAt || '',
        lastIncrementalExportAt: metadata.lastIncrementalExportAt || '',
        visitedUrls: metadata.visitedUrls || {},
        patientVisitedUrls: metadata.patientVisitedUrls || {},
        canonicalCoverage: metadata.canonicalCoverage || {},
        syncRuns: metadata.syncRuns || {},
      },
    });
  }

  async clearAllData() {
    await this.writeStore(createEmptyStore());
  }

  createIndexCard(record) {
    const patient = this.normalizePatient(record.patient);
    return {
      id: record.id,
      category: record.category,
      recordType: record.recordType || record.category || 'record',
      title: record.title,
      date: record.date || '',
      snippet: String(record.summary || record.clinicalText || record.rawText || '').slice(0, 500),
      patient,
      sourceUrl: record.sourceUrl,
      extractedAt: record.extractedAt || new Date().toISOString(),
    };
  }

  normalizeRecord(record) {
    const patient = inferPatientFromStoredRecord(record) || this.normalizePatient(record.patient);
    const normalized = {
      ...record,
      patient,
      rawText: record.rawText || record.raw_data || '',
      sourceUrl: record.sourceUrl || record.source_url || '',
      extractedAt: record.extractedAt || record.timestamp || new Date().toISOString(),
    };
    if (normalized.category === 'health-summary'
      && /seattlechildrens\.org/i.test(normalized.sourceUrl)
      && /(?:test|result|lab)/i.test(`${normalized.recordType || ''} ${normalized.sourceUrl}`)) {
      normalized.category = 'test-results';
      normalized.recordType = normalized.recordType || 'test-result';
    }
    if (normalized.category === 'visits') {
      const sourceText = String(normalized.sourceText || normalized.rawText || '');
      const clinicalText = sanitizeStoredVisitText(normalized.clinicalText || normalized.rawText);
      normalized.sourceText = sourceText;
      normalized.clinicalText = clinicalText;
      normalized.rawText = clinicalText;
      normalized.summary = sanitizeStoredVisitText(normalized.summary || normalized.clinicalText);
      normalized.title = sanitizeStoredVisitTitle(normalized.title, normalized.clinicalText);
      if (/\/app\/visits\/note\b/i.test(normalized.sourceUrl)
        && hasStoredVisitNoteSubstance(`${normalized.title || ''}\n${normalized.summary || ''}\n${normalized.clinicalText || ''}`)) {
        normalized.recordType = 'visit-note';
        normalized.summary = sanitizeStoredVisitText(normalized.clinicalText);
      }
    }
    if (normalized.category === 'test-results') {
      normalized.rawText = sanitizeStoredTestResultText(normalized.rawText, normalized.patient);
      normalized.summary = sanitizeStoredTestResultText(normalized.summary || normalized.rawText, normalized.patient);
      normalized.title = sanitizeStoredTestResultTitle(normalized.title, normalized.patient);
    }
    if (normalized.category === 'medications') {
      normalized.rawText = sanitizeStoredMedicationText(normalized.rawText);
      normalized.summary = sanitizeStoredMedicationText(normalized.summary || normalized.rawText);
    }
    if (!normalized.id) {
      const patientKey = patient?.key || 'unknown-patient';
      normalized.id = `${patientKey}:${normalized.category || 'record'}:${Date.now()}`;
    }
    if (!normalized.recordType) normalized.recordType = normalized.category || 'record';
    return normalized;
  }

  normalizeIndexCard(card) {
    const patient = this.normalizePatient(card.patient);
    const normalized = {
      id: card.id,
      category: card.category || 'general',
      recordType: card.recordType || card.category || 'record',
      title: card.title || card.category || 'Record',
      date: card.date || '',
      snippet: String(card.snippet || '').slice(0, 500),
      patient,
      sourceUrl: card.sourceUrl || '',
      extractedAt: card.extractedAt || new Date().toISOString(),
    };
    if (normalized.category === 'health-summary'
      && /seattlechildrens\.org/i.test(normalized.sourceUrl)
      && /(?:test|result|lab)/i.test(`${normalized.recordType || ''} ${normalized.sourceUrl}`)) {
      normalized.category = 'test-results';
      normalized.recordType = normalized.recordType || 'test-result';
    }
    if (normalized.category === 'visits') {
      normalized.snippet = sanitizeStoredVisitText(normalized.snippet);
      normalized.title = sanitizeStoredVisitTitle(normalized.title, normalized.snippet);
    }
    if (normalized.category === 'test-results') {
      normalized.snippet = sanitizeStoredTestResultText(normalized.snippet, normalized.patient);
      normalized.title = sanitizeStoredTestResultTitle(normalized.title, normalized.patient);
    }
    if (normalized.category === 'medications') {
      normalized.snippet = sanitizeStoredMedicationText(normalized.snippet);
    }
    return normalized;
  }

  normalizePatient(value) {
    return sharedNormalizePatient(value);
  }

  hashText(value) {
    return hashText(value);
  }
}

export class JsonStoreWriteSession {
  constructor(owner, store, { checkpointPages, checkpointMs }) {
    this.owner = owner;
    this.store = store;
    this.checkpointPages = checkpointPages;
    this.checkpointMs = checkpointMs;
    this.pendingPages = 0;
    this.lastCheckpointAt = Date.now();
    this.checkpointWrites = 0;
  }

  get syncMetadata() {
    return this.store.syncMetadata;
  }

  get records() {
    return this.store.records.map((record) => this.owner.normalizeRecord(record));
  }

  setSyncMetadata(metadata) {
    this.store.syncMetadata = { ...this.store.syncMetadata, ...metadata };
  }

  async mergeExtractedPage(extraction) {
    const result = this.owner.mergeExtractedPage(this.store, extraction);
    this.pendingPages += 1;
    return result;
  }

  async checkpointIfDue() {
    if (this.pendingPages >= this.checkpointPages || Date.now() - this.lastCheckpointAt >= this.checkpointMs) {
      return this.checkpoint();
    }
    return false;
  }

  async checkpoint({ force = false } = {}) {
    if (!force && !this.pendingPages) return false;
    this.store = await this.owner.writeStore(this.store);
    this.pendingPages = 0;
    this.lastCheckpointAt = Date.now();
    this.checkpointWrites += 1;
    return true;
  }
}

export { summarizeSavedRecordQuality };
