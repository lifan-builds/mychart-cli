import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createPullStateScopeKey,
  resolveSinceLastPullRange,
  runAgentExportWorkflow,
  validateAgentExportOptions,
} from '../src/core/agent-export-workflow.js';

test('createPullStateScopeKey scopes by patient, sync categories, export category, and query', () => {
  assert.equal(
    createPullStateScopeKey({
      patientLabelExact: 'Demo Child',
      categories: ['visits', 'test-results'],
      category: 'test-results',
      query: 'scan',
    }),
    'patientKey=|patientLabel=Demo Child|categories=test-results,visits|category=test-results|query=scan',
  );
});

test('resolveSinceLastPullRange prefers saved state and keeps the start date inclusive', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mychart-pull-state-'));
  const statePath = path.join(dir, '.last-pull-state.json');
  const options = {
    pullStatePath: statePath,
    patientLabelExact: 'Demo Child',
    categories: ['visits', 'test-results'],
    days: 3,
  };
  const stateKey = createPullStateScopeKey(options);
  await writeFile(statePath, `${JSON.stringify({
    version: 1,
    scopes: {
      [stateKey]: { lastClinicalDate: '2026-06-08' },
    },
  })}\n`, 'utf8');

  const range = await resolveSinceLastPullRange({
    cards: [
      { id: 'old', date: '2026-06-08' },
      { id: 'new', date: '2026-06-10' },
    ],
    options,
    outputDir: dir,
  });

  assert.equal(range.startDate, '2026-06-08');
  assert.equal(range.endDate, '2026-06-10');
  assert.equal(range.fallbackSource, 'pull-state');
  assert.equal(range.stateKey, stateKey);
});

test('resolveSinceLastPullRange falls back to export filenames, then recent days', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mychart-filename-range-'));
  const statePath = path.join(dir, '.last-pull-state.json');
  await writeFile(
    path.join(dir, 'mychart-cli-records-2026-06-01-to-2026-06-07-2026-06-07T12-00-00-000Z.jsonl'),
    '',
  );

  const filenameRange = await resolveSinceLastPullRange({
    cards: [{ id: 'new', date: '2026-06-10' }],
    options: { pullStatePath: statePath, days: 2 },
    outputDir: dir,
  });
  assert.equal(filenameRange.startDate, '2026-06-07');
  assert.equal(filenameRange.endDate, '2026-06-10');
  assert.equal(filenameRange.fallbackSource, 'export-filename');

  const daysDir = await mkdtemp(path.join(tmpdir(), 'mychart-days-range-'));
  const daysRange = await resolveSinceLastPullRange({
    cards: [{ id: 'new', date: '2026-06-10' }],
    options: { pullStatePath: path.join(daysDir, '.last-pull-state.json'), days: 2 },
    outputDir: daysDir,
  });
  assert.equal(daysRange.startDate, '2026-06-09');
  assert.equal(daysRange.endDate, '2026-06-10');
  assert.equal(daysRange.fallbackSource, 'days');
});

test('validateAgentExportOptions rejects conflicting range modes', () => {
  assert.throws(
    () => validateAgentExportOptions({ latestDay: true, all: true }),
    /latest-day cannot be combined with --all/,
  );
  assert.throws(
    () => validateAgentExportOptions({ sinceLastPull: true, startDate: '2026-06-01' }),
    /since-last-pull cannot be combined with --start-date/,
  );
  assert.throws(
    () => validateAgentExportOptions({ format: 'csv' }),
    /format must be jsonl or markdown/,
  );
});

test('runAgentExportWorkflow writes export and returns safe machine-readable summary', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mychart-agent-export-'));
  const storePath = path.join(dir, 'store.json');
  const outputDir = path.join(dir, 'exports');
  const pullStatePath = path.join(outputDir, '.last-pull-state.json');
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, `${JSON.stringify({
    version: 1,
    updatedAt: '2026-06-10T12:00:00.000Z',
    records: [
      {
        id: 'lab-1',
        patient: { key: 'demo-child', label: 'Demo Child' },
        category: 'test-results',
        recordType: 'test-result',
        title: 'CBC',
        date: '2026-06-10',
        rawText: 'White Blood Cells\nYour value is 7.2 K/uL',
        sourceUrl: 'https://mychart.example.test/results/1',
        extractedAt: '2026-06-10T11:00:00.000Z',
      },
      {
        id: 'visit-1',
        patient: { key: 'demo-child', label: 'Demo Child' },
        category: 'visits',
        recordType: 'visit-note',
        title: 'Daily Progress Note',
        date: '2026-06-09',
        clinicalText: 'Assessment and Plan\nContinue support.',
        rawText: 'Noisy raw body',
        sourceUrl: 'https://mychart.example.test/visits/1',
        extractedAt: '2026-06-09T11:00:00.000Z',
      },
      {
        id: 'other-1',
        patient: { key: 'other', label: 'Other' },
        category: 'test-results',
        recordType: 'test-result',
        title: 'Other CBC',
        date: '2026-06-10',
        rawText: 'Other patient text',
        sourceUrl: 'https://mychart.example.test/results/2',
      },
    ],
    indexCards: [
      {
        id: 'lab-1',
        patient: { key: 'demo-child', label: 'Demo Child' },
        category: 'test-results',
        recordType: 'test-result',
        title: 'CBC',
        date: '2026-06-10',
        snippet: 'White Blood Cells',
        sourceUrl: 'https://mychart.example.test/results/1',
      },
      {
        id: 'visit-1',
        patient: { key: 'demo-child', label: 'Demo Child' },
        category: 'visits',
        recordType: 'visit-note',
        title: 'Daily Progress Note',
        date: '2026-06-09',
        snippet: 'Assessment and Plan',
        sourceUrl: 'https://mychart.example.test/visits/1',
      },
      {
        id: 'other-1',
        patient: { key: 'other', label: 'Other' },
        category: 'test-results',
        recordType: 'test-result',
        title: 'Other CBC',
        date: '2026-06-10',
        snippet: 'Other',
        sourceUrl: 'https://mychart.example.test/results/2',
      },
    ],
    syncMetadata: { lastDeepSyncAt: '2026-06-10T10:00:00.000Z' },
  }, null, 2)}\n`, 'utf8');

  const summary = await runAgentExportWorkflow({
    storePath,
    outputDir,
    pullStatePath,
    sinceLastPull: true,
    patientLabelExact: 'Demo Child',
    categories: ['visits', 'test-results'],
    days: 2,
    format: 'jsonl',
    generatedAt: '2026-06-10T12:00:00.000Z',
  });

  assert.equal(summary.format, 'jsonl');
  assert.equal(summary.recordCount, 2);
  assert.equal(summary.chunkCount, 2);
  assert.equal(summary.dateRange.startDate, '2026-06-09');
  assert.equal(summary.dateRange.endDate, '2026-06-10');
  assert.equal(summary.latestClinicalDate, '2026-06-10');
  assert.deepEqual(summary.categoryCounts, { visits: 1, 'test-results': 1 });
  assert.deepEqual(summary.sourceHostCounts, { 'mychart.example.test': 2 });
  assert.equal(summary.stored.recordCount, 3);
  assert.equal(summary.stored.indexCardCount, 3);
  assert.equal(summary.pullState.updated, false);
  assert.equal(summary.pullState.reason, 'freshness-unsafe');
  assert.equal(summary.freshnessSafe, false);
  assert.equal(JSON.stringify(summary).includes('White Blood Cells'), false);

  const exportContent = await readFile(summary.outputPath, 'utf8');
  const lines = exportContent.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((line) => line.type), ['manifest', 'record', 'record', 'chunk', 'chunk']);

  await assert.rejects(() => readFile(pullStatePath, 'utf8'), /ENOENT/);
});
