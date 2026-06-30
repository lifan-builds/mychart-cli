import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAgentJsonlExport,
  chunkText,
} from '../src/core/agent-jsonl-export.js';
import { inspectAgentJsonlExportContent } from '../src/core/export-inspect.js';

test('buildAgentJsonlExport emits manifest, record, and chunk JSONL lines', () => {
  const patient = { key: 'demo-child', label: 'Demo Child', relationship: 'son' };
  const exportDownload = buildAgentJsonlExport({
    generatedAt: '2026-06-09T12:00:00.000Z',
    startDate: '2026-06-09',
    endDate: '2026-06-09',
    filters: { category: 'visits' },
    syncMetadata: {
      lastDeepSyncAt: '2026-06-09T11:00:00.000Z',
      visitedUrls: { hidden: true },
    },
    cards: [{
      id: 'visit-1',
      patient,
      category: 'visits',
      recordType: 'visit-note',
      title: 'Daily Progress Note',
      date: 'June 09, 2026',
      snippet: 'Noisy snippet',
      sourceUrl: 'https://example.test/visit',
      extractedAt: '2026-06-09T11:30:00.000Z',
    }],
    records: [{
      id: 'visit-1',
      patient,
      category: 'visits',
      recordType: 'visit-note',
      rawText: 'Noisy raw body',
      clinicalText: 'Assessment and Plan\nContinue respiratory support.',
      sourceUrl: 'https://example.test/visit',
      documentAttachments: [{
        label: 'Scan 1',
        status: 'downloaded',
        displayName: 'Scan',
        fileDescription: 'GENE DX',
        mimeType: 'application/pdf',
        filePath: '/tmp/scan.pdf',
        byteLength: 123,
        sha256: 'abc',
        textExtraction: {
          status: 'extracted',
          method: 'pypdf',
          pageCount: 4,
          textLength: 42,
          ocrStatus: 'unavailable',
          ocrMethod: 'vision',
          ocrError: 'macOS Vision OCR is only available on darwin.',
        },
      }],
    }],
  });

  const lines = parseJsonl(exportDownload.content);

  assert.equal(exportDownload.filename, 'mychart-cli-records-2026-06-09-to-2026-06-09-2026-06-09T12-00-00-000Z.jsonl');
  assert.equal(exportDownload.mimeType, 'application/x-ndjson');
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((line) => line.type), ['manifest', 'record', 'chunk']);
  assert.equal(lines[0].schemaVersion, 1);
  assert.equal(lines[0].recordCount, 1);
  assert.equal(lines[0].chunkCount, 1);
  assert.deepEqual(lines[0].syncMetadata, {
    lastDeepSyncAt: '2026-06-09T11:00:00.000Z',
    lastIncrementalExportAt: '',
  });
  assert.equal(lines[1].recordId, 'visit-1');
  assert.equal(lines[1].dateIso, '2026-06-09');
  assert.equal(lines[1].quality.level, 'clean');
  assert.equal(lines[1].attachments[0].fileDescription, 'GENE DX');
  assert.equal(lines[1].attachments[0].textExtraction.pageCount, 4);
  assert.equal(lines[1].attachments[0].textExtraction.ocrMethod, 'vision');
  assert.equal(lines[1].chunkCount, 1);
  assert.equal(lines[1].textBytes, Buffer.byteLength('Assessment and Plan\nContinue respiratory support.', 'utf8'));
  assert.equal(lines[2].chunkId, 'visit-1:chunk:0001');
  assert.equal(lines[2].text, 'Assessment and Plan\nContinue respiratory support.');
  assert.equal(lines[2].charStart, 0);
  assert.equal(lines[2].charEnd, lines[2].text.length);
});

test('buildAgentJsonlExport filters by date range and omits records without text chunks', () => {
  const patient = { key: 'demo-child', label: 'Demo Child' };
  const exportDownload = buildAgentJsonlExport({
    generatedAt: '2026-06-09T12:00:00.000Z',
    startDate: '2026-06-08',
    endDate: '2026-06-09',
    cards: [
      { id: 'inside', patient, category: 'test-results', title: 'CBC', date: '6/9/2026' },
      { id: 'empty', patient, category: 'visits', title: 'Empty', date: '2026-06-09' },
      { id: 'outside', patient, category: 'visits', title: 'Old', date: '2026-06-07' },
    ],
    records: [
      { id: 'inside', category: 'test-results', rawText: 'White Blood Cells\nYour value is 7.2 K/uL' },
      { id: 'empty', category: 'visits', rawText: '' },
      { id: 'outside', category: 'visits', rawText: 'Older note' },
    ],
  });

  const lines = parseJsonl(exportDownload.content);
  const records = lines.filter((line) => line.type === 'record');
  const chunks = lines.filter((line) => line.type === 'chunk');

  assert.deepEqual(exportDownload.exportedCards.map((card) => card.id), ['inside', 'empty']);
  assert.deepEqual(records.map((line) => line.recordId), ['inside', 'empty']);
  assert.equal(records.find((line) => line.recordId === 'empty').chunkCount, 0);
  assert.deepEqual(chunks.map((line) => line.recordId), ['inside']);
  assert.equal(lines[0].recordCount, 2);
  assert.equal(lines[0].chunkCount, 1);
});

test('buildAgentJsonlExport dedupes repeated source analyte date rows and emits metadata', () => {
  const patient = { key: 'demo-child', label: 'Demo Child' };
  const exportDownload = buildAgentJsonlExport({
    generatedAt: '2026-06-10T12:00:00.000Z',
    startDate: '2026-06-09',
    endDate: '2026-06-10',
    cards: [
      {
        id: 'pco2-a',
        patient,
        category: 'test-results',
        title: 'pCO2 Capillary',
        date: '2026-06-09',
        sourceUrl: 'https://mychart.example.test/results/bg',
      },
      {
        id: 'pco2-b',
        patient,
        category: 'test-results',
        title: 'pCO2 Capillary',
        date: '2026-06-09',
        sourceUrl: 'https://mychart.example.test/results/bg',
      },
      {
        id: 'ph',
        patient,
        category: 'test-results',
        title: 'pH Capillary',
        date: '2026-06-10',
        sourceUrl: 'https://mychart.example.test/results/bg',
      },
    ],
    records: [
      {
        id: 'pco2-a',
        category: 'test-results',
        title: 'pCO2 Capillary',
        rawText: 'pCO2 Capillary\nValue 36 mmHg',
        sourceUrl: 'https://mychart.example.test/results/bg',
        metadata: { analyte: 'pCO2 Capillary', labValues: { pCO2: 36 }, specimenType: 'capillary' },
      },
      {
        id: 'pco2-b',
        category: 'test-results',
        title: 'pCO2 Capillary',
        rawText: 'pCO2 Capillary\nValue 36 mmHg',
        sourceUrl: 'https://mychart.example.test/results/bg',
        metadata: { analyte: 'pCO2 Capillary' },
      },
      {
        id: 'ph',
        category: 'test-results',
        title: 'pH Capillary',
        rawText: 'pH Capillary\nValue 7.42',
        sourceUrl: 'https://mychart.example.test/results/bg',
        metadata: { analyte: 'pH Capillary', labValues: { pH: 7.42 }, specimenType: 'capillary' },
      },
    ],
  });

  const lines = parseJsonl(exportDownload.content);
  const records = lines.filter((line) => line.type === 'record');

  assert.equal(records.length, 2);
  assert.equal(lines[0].duplicateCounts.totalDuplicateRecords, 1);
  assert.equal(lines[0].clinicalDelta.unchangedRepeatedRecords, 1);
  assert.equal(lines[0].clinicalDelta.newRecords, 1);
  assert.equal(records.find((line) => line.recordId === 'pco2-a').metadata.labValues.pCO2, 36);
});

test('inspectAgentJsonlExportContent summarizes records instead of counting raw lines', () => {
  const exportDownload = buildAgentJsonlExport({
    generatedAt: '2026-06-10T12:00:00.000Z',
    startDate: '2026-06-10',
    endDate: '2026-06-10',
    cards: [{
      id: 'lab-1',
      category: 'test-results',
      title: 'Blood Gas',
      date: '2026-06-10',
      sourceUrl: 'https://mychart.example.test/results/bg',
    }],
    records: [{
      id: 'lab-1',
      category: 'test-results',
      title: 'Blood Gas',
      rawText: 'pH Capillary\nValue 7.42',
      sourceUrl: 'https://mychart.example.test/results/bg',
    }],
  });

  const inspection = inspectAgentJsonlExportContent(exportDownload.content, { file: '/tmp/export.jsonl' });

  assert.equal(inspection.recordCount, 1);
  assert.equal(inspection.chunkCount, 1);
  assert.deepEqual(inspection.categories, { 'test-results': 1 });
  assert.equal(inspection.latestDate, '2026-06-10');
  assert.deepEqual(inspection.sourceHosts, { 'mychart.example.test': 1 });
  assert.deepEqual(inspection.topRecordTitles, [{ title: 'Blood Gas', count: 1 }]);
});

test('chunkText is deterministic and overlaps long note chunks', () => {
  const text = [
    'Assessment and Plan',
    'A'.repeat(90),
    '',
    'Respiratory Support',
    'B'.repeat(90),
    '',
    'Medication',
    'C'.repeat(90),
  ].join('\n');

  const first = chunkText(text, { chunkSize: 120, chunkOverlap: 20 });
  const second = chunkText(text, { chunkSize: 120, chunkOverlap: 20 });

  assert.deepEqual(first, second);
  assert.ok(first.length > 1);
  assert.equal(first[1].charStart, first[0].charEnd - 20);
  assert.equal(first[0].text, text.slice(first[0].charStart, first[0].charEnd));
});

function parseJsonl(content) {
  return content.trim().split('\n').map((line) => JSON.parse(line));
}
