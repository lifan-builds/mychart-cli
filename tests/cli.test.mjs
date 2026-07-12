import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { detachLaunchedBrowserForOneShot, main } from '../src/cli.mjs';

test('CLI help advertises agent-facing commands', async () => {
  let output = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    output += chunk;
    return true;
  };
  try {
    await main(['--help']);
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.match(output, /browser start/);
  assert.match(output, /browser ensure/);
  assert.match(output, /sync \[--login\]/);
  assert.match(output, /--seed-url URL/);
  assert.match(output, /records list/);
  assert.match(output, /export markdown/);
  assert.match(output, /export jsonl/);
  assert.match(output, /export inspect/);
  assert.doesNotMatch(output, /\bask\b/);
  assert.doesNotMatch(output, /\b(?:AI|LLM|medical advice)\b/i);
});

test('CLI sync parses value-bearing options as sync options without ambient CDP', async () => {
  const profileDir = await mkdtemp(path.join(tmpdir(), 'mychart-cli-no-session-'));
  await assert.rejects(
    () => main(['sync', '--profile', profileDir, '--switch-patient', 'Demo Child', '--seed-url', 'https://example.test/mychart/app/test-results/details?eorderid=1', '--max-pages', '1']),
    /Could not read mychart-cli live harness session/,
  );
});

test('CLI sync rejects invalid budgets and categories before opening a browser session', async () => {
  await assert.rejects(() => main(['sync', '--max-pages', '0']), /--max-pages must be a positive number/);
  await assert.rejects(() => main(['sync', '--max-broad-pages', 'NaN']), /--max-broad-pages must be a positive number/);
  await assert.rejects(() => main(['sync', '--categories', 'billing']), /Unsupported sync categories/);
});

test('browser ensure detaches a launched browser process for one-shot exit', () => {
  let processUnrefCount = 0;
  let streamUnrefCount = 0;
  const stream = {
    unref() {
      streamUnrefCount += 1;
    },
  };
  const processHandle = {
    stdio: [stream, null, stream],
    unref() {
      processUnrefCount += 1;
    },
  };

  detachLaunchedBrowserForOneShot({
    browser: {
      process() {
        return processHandle;
      },
    },
  });

  assert.equal(processUnrefCount, 1);
  assert.equal(streamUnrefCount, 2);
});

test('browser ensure detach helper tolerates an existing browser session', () => {
  assert.doesNotThrow(() => detachLaunchedBrowserForOneShot(null));
});

test('CLI export emits safe JSON summary and protects state without scoped freshness', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mychart-cli-export-'));
  const storePath = path.join(dir, 'store.json');
  const outputDir = path.join(dir, 'exports');
  const pullStatePath = path.join(outputDir, '.last-pull-state.json');
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, `${JSON.stringify({
    version: 1,
    updatedAt: '2026-06-10T12:00:00.000Z',
    records: [{
      id: 'lab-1',
      patient: { key: 'demo-child', label: 'Demo Child' },
      category: 'test-results',
      recordType: 'test-result',
      title: 'CBC',
      date: '2026-06-10',
      rawText: 'White Blood Cells\nYour value is 7.2 K/uL',
      sourceUrl: 'https://mychart.example.test/results/1',
    }],
    indexCards: [{
      id: 'lab-1',
      patient: { key: 'demo-child', label: 'Demo Child' },
      category: 'test-results',
      recordType: 'test-result',
      title: 'CBC',
      date: '2026-06-10',
      snippet: 'White Blood Cells',
      sourceUrl: 'https://mychart.example.test/results/1',
    }],
    syncMetadata: { lastDeepSyncAt: '2026-06-10T10:00:00.000Z' },
  }, null, 2)}\n`, 'utf8');

  let output = '';
  const originalLog = console.log;
  console.log = (chunk) => {
    output += `${chunk}\n`;
  };
  try {
    await main([
      'export',
      'jsonl',
      '--store',
      storePath,
      '--since-last-pull',
      '--pull-state',
      pullStatePath,
      '--output-dir',
      outputDir,
      '--patient-label-exact',
      'Demo Child',
      '--json-summary',
    ]);
  } finally {
    console.log = originalLog;
  }

  const summary = JSON.parse(output);
  assert.equal(summary.recordCount, 1);
  assert.equal(summary.chunkCount, 1);
  assert.equal(summary.outputPath.startsWith(outputDir), true);
  assert.equal(summary.pullState.updated, false);
  assert.equal(summary.pullState.reason, 'freshness-unsafe');
  assert.equal(JSON.stringify(summary).includes('White Blood Cells'), false);

  const exportText = await readFile(summary.outputPath, 'utf8');
  assert.match(exportText, /"type":"manifest"/);
  await assert.rejects(() => readFile(pullStatePath, 'utf8'), /ENOENT/);
});
