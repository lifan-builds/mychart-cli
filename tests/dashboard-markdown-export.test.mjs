import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDateRangeMarkdownExportDownload,
  buildMarkdownExportDownload,
  filterCardsByRecordDateRange,
} from '../src/core/markdown-export.js';

test('buildMarkdownExportDownload creates a patient-friendly Markdown records file', () => {
  const patient = { key: 'patient-one', label: 'Patient One' };
  const exportDownload = buildMarkdownExportDownload({
    generatedAt: '2026-05-12T18:30:00.000Z',
    cards: [
      {
        id: 'old-visit',
        patient,
        category: 'visits',
        recordType: 'visit-note',
        title: 'Older Visit Note',
        date: '2026-05-01',
        snippet: 'Older snippet',
        sourceUrl: 'https://example.test/mychart/app/visits/note?csn=old',
      },
      {
        id: 'lab-cbc',
        patient,
        category: 'test-results',
        recordType: 'lab',
        title: 'CBC Result',
        date: '2026-05-10',
        snippet: 'White blood cells result',
        sourceUrl: 'https://example.test/mychart/results/cbc',
      },
    ],
    records: [
      {
        id: 'old-visit',
        category: 'visits',
        recordType: 'visit-note',
        clinicalText: 'Assessment and Plan\nPatient is improving.',
        rawText: 'Noisy portal text',
      },
      {
        id: 'lab-cbc',
        category: 'test-results',
        recordType: 'lab',
        rawText: 'White blood cells\nNormal range: 3.4 - 10.8 K/uL\nYour value is 7.2 K/uL',
        summary: 'CBC summary',
      },
    ],
    filters: {
      query: 'white blood',
      patientKey: 'patient-one',
      patientLabel: 'Patient One',
      category: 'test-results',
    },
  });

  assert.equal(exportDownload.filename, 'mychart-cli-records-2026-05-12T18-30-00-000Z.md');
  assert.equal(exportDownload.mimeType, 'text/markdown');
  assert.match(exportDownload.content, /^# mychart-cli Records Export/);
  assert.match(exportDownload.content, /Disclaimer: This is not medical advice\./);
  assert.match(exportDownload.content, /Records exported: 1 of 2/);
  assert.match(exportDownload.content, /- Patient: Patient One/);
  assert.match(exportDownload.content, /- Category: Test Results/);
  assert.match(exportDownload.content, /## 1\. CBC Result/);
  assert.match(exportDownload.content, /### Result Data/);
  assert.match(exportDownload.content, /White blood cells: value 7\.2; K\/uL; reference 3\.4 - 10\.8 K\/uL/);
  assert.match(exportDownload.content, /White blood cells\nNormal range: 3\.4 - 10\.8 K\/uL\nYour value is 7\.2 K\/uL/);
  assert.doesNotMatch(exportDownload.content, /Older Visit Note/);
});

test('buildMarkdownExportDownload groups same-day test results compactly', () => {
  const patient = { key: 'baby', label: 'Baby Patient' };
  const exportDownload = buildMarkdownExportDownload({
    generatedAt: '2026-05-29T12:00:00.000Z',
    cards: [
      {
        id: 'cmp',
        patient,
        category: 'test-results',
        recordType: 'test-result',
        title: 'Comprehensive Metabolic Panel',
        date: '2026-05-28',
        sourceUrl: 'https://example.test/results/cmp',
      },
      {
        id: 'visit',
        patient,
        category: 'visits',
        recordType: 'visit-note',
        title: 'Daily Progress Note',
        date: '2026-05-28',
        sourceUrl: 'https://example.test/visits/note',
      },
      {
        id: 'cbc',
        patient,
        category: 'test-results',
        recordType: 'test-result',
        title: 'CBC',
        date: '2026-05-28',
        sourceUrl: 'https://example.test/results/cbc',
      },
      {
        id: 'other-cbc',
        patient: { key: 'other', label: 'Other Patient' },
        category: 'test-results',
        recordType: 'test-result',
        title: 'Other Patient CBC',
        date: '2026-05-28',
        sourceUrl: 'https://example.test/results/other-cbc',
      },
    ],
    records: [
      {
        id: 'cmp',
        category: 'test-results',
        rawText: [
          'Comprehensive Metabolic Panel',
          'Collected on May 28, 2026 5:37 AM',
          'Sodium',
          'Normal range: 134 - 144 mmol/L',
          'Value 139 mmol/L',
        ].join('\n'),
        sourceUrl: 'https://example.test/results/cmp',
      },
      {
        id: 'visit',
        category: 'visits',
        clinicalText: 'Respiratory support unchanged.',
        sourceUrl: 'https://example.test/visits/note',
      },
      {
        id: 'cbc',
        category: 'test-results',
        rawText: [
          'CBC',
          'Collected on May 28, 2026 5:40 AM',
          'Hemoglobin',
          'Normal range: 12.0 - 17.0 g/dL',
          'Value 13.3 g/dL',
        ].join('\n'),
        sourceUrl: 'https://example.test/results/cbc',
      },
      {
        id: 'other-cbc',
        category: 'test-results',
        rawText: [
          'CBC',
          'Collected on May 28, 2026 5:45 AM',
          'Hemoglobin',
          'Normal range: 12.0 - 17.0 g/dL',
          'Value 12.9 g/dL',
        ].join('\n'),
        sourceUrl: 'https://example.test/results/other-cbc',
      },
    ],
  });

  assert.match(exportDownload.content, /## 1\. Test Results - 2026-05-28/);
  assert.match(exportDownload.content, /- Records grouped: 2/);
  assert.match(exportDownload.content, /### Result 1: Comprehensive Metabolic Panel/);
  assert.match(exportDownload.content, /### Result 2: CBC/);
  assert.match(exportDownload.content, /#### Result Data/);
  assert.match(exportDownload.content, /Sodium: value 139; mmol\/L; reference 134 - 144 mmol\/L/);
  assert.match(exportDownload.content, /Hemoglobin: value 13\.3; g\/dL; reference 12\.0 - 17\.0 g\/dL/);
  assert.match(exportDownload.content, /## 2\. Daily Progress Note/);
  assert.match(exportDownload.content, /## 3\. Other Patient CBC/);
  assert.doesNotMatch(exportDownload.content, /## 3\. CBC/);
});

test('buildDateRangeMarkdownExportDownload exports records in an explicit clinical date range', () => {
  const cards = [
    {
      id: 'before',
      title: 'Before Range',
      category: 'visits',
      recordType: 'visit',
      date: '2026-05-01',
    },
    {
      id: 'inside',
      title: 'Inside Range',
      category: 'test-results',
      recordType: 'test-result',
      date: '05/10/26',
    },
    {
      id: 'inside-long',
      title: 'Inside Long Date',
      category: 'visits',
      recordType: 'visit-note',
      date: 'May 12, 2026',
    },
    {
      id: 'after',
      title: 'After Range',
      category: 'test-results',
      recordType: 'test-result',
      date: '2026-05-16',
    },
  ];
  const records = new Map([
    ['before', { id: 'before', rawText: 'Before range details' }],
    ['inside', { id: 'inside', rawText: 'Inside range details' }],
    ['inside-long', { id: 'inside-long', rawText: 'Inside long-date details' }],
    ['after', { id: 'after', rawText: 'After range details' }],
  ]);

  const filtered = filterCardsByRecordDateRange(cards, records, {
    startDate: '2026-05-05',
    endDate: '2026-05-12',
  });
  const exportDownload = buildDateRangeMarkdownExportDownload({
    generatedAt: '2026-05-15T18:30:00.000Z',
    startDate: '2026-05-05',
    endDate: '2026-05-12',
    cards,
    records,
  });

  assert.deepEqual(filtered.map((card) => card.id), ['inside', 'inside-long']);
  assert.equal(exportDownload.filename, 'mychart-cli-records-2026-05-05-to-2026-05-12-2026-05-15T18-30-00-000Z.md');
  assert.match(exportDownload.content, /Date from: 2026-05-05/);
  assert.match(exportDownload.content, /Date to: 2026-05-12/);
  assert.match(exportDownload.content, /Inside Range/);
  assert.match(exportDownload.content, /Inside Long Date/);
  assert.doesNotMatch(exportDownload.content, /Before Range/);
  assert.doesNotMatch(exportDownload.content, /After Range/);
});
