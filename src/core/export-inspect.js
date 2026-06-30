import { readFile } from 'node:fs/promises';

import { normalizeClinicalDateForRange } from './clinical-dates.js';

export async function inspectAgentJsonlExportFile(file) {
  const content = await readFile(file, 'utf8');
  return inspectAgentJsonlExportContent(content, { file });
}

export function inspectAgentJsonlExportContent(content = '', { file = '' } = {}) {
  const parsedLines = String(content || '')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`);
      }
    });
  const manifests = parsedLines.filter((line) => line.type === 'manifest');
  const records = parsedLines.filter((line) => line.type === 'record');
  const chunks = parsedLines.filter((line) => line.type === 'chunk');
  const dates = records
    .map((record) => record.dateIso || normalizeClinicalDateForRange(record.date || ''))
    .filter(Boolean)
    .sort();

  return {
    file,
    manifestCount: manifests.length,
    recordCount: records.length,
    chunkCount: chunks.length,
    manifestRecordCount: manifests[0]?.recordCount ?? null,
    manifestChunkCount: manifests[0]?.chunkCount ?? null,
    categories: countBy(records, (record) => record.category || 'record'),
    clinicalDateRange: {
      startDate: dates[0] || '',
      endDate: dates.at(-1) || '',
    },
    latestDate: dates.at(-1) || '',
    sourceHosts: countBy(records, (record) => sourceHost(record.sourceUrl)),
    duplicateCounts: countDuplicateRecords(records),
    topRecordTitles: topCounts(records, (record) => record.title || 'Record', 12)
      .map(([title, count]) => ({ title, count })),
  };
}

function countDuplicateRecords(records = []) {
  const counts = countBy(records, duplicateKeyForRecord);
  const duplicateKeys = Object.entries(counts)
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }));
  return {
    duplicateKeyCount: duplicateKeys.length,
    totalDuplicateRecords: duplicateKeys.reduce((total, item) => total + item.count - 1, 0),
    keys: duplicateKeys.slice(0, 25),
  };
}

function duplicateKeyForRecord(record = {}) {
  return [
    record.sourceUrl || '',
    record.metadata?.analyte || record.title || '',
    record.dateIso || normalizeClinicalDateForRange(record.date || ''),
  ].join('|');
}

function countBy(items = [], getKey = () => '') {
  return items.reduce((counts, item) => {
    const key = getKey(item);
    if (!key) return counts;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function topCounts(items = [], getKey = () => '', limit = 10) {
  return Object.entries(countBy(items, getKey))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function sourceHost(sourceUrl = '') {
  try {
    return new URL(sourceUrl).host;
  } catch {
    return sourceUrl ? 'invalid-url' : '';
  }
}
