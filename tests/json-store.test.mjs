import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { JsonMedicalStore } from '../src/storage/json-store.js';

test('JsonMedicalStore saves extracted pages and persists sync metadata atomically', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'awesome-mychart-store-'));
  const storePath = path.join(dir, 'store.json');
  const store = new JsonMedicalStore({ storePath });
  const result = await store.saveExtractedPage({
    page: { sourceUrl: 'https://example.test/mychart/app/test-results/details?id=1', category: 'test-results', patient: { name: 'Demo Child', label: 'Demo Child' } },
    records: [{ id: 'lab-1', category: 'test-results', recordType: 'test-result', title: 'CBC(Demo Child)', date: '2026-06-09', rawText: 'CBC(Demo Child)\nWhite Blood Cells\nValue11.2High', sourceUrl: 'https://example.test/mychart/app/test-results/details?id=1' }],
  });
  await store.saveSyncMetadata({ lastDeepSyncAt: '2026-06-09T12:00:00.000Z', visitedUrls: { 'https://example.test/mychart/app/test-results/details?id=1': '2026-06-09T12:00:00.000Z' } });
  assert.equal(result.recordCount, 1);
  assert.equal((await store.getAllRecords()).length, 1);
  assert.equal((await store.getIndexCards()).length, 1);
  assert.equal((await store.getSyncMetadata()).lastDeepSyncAt, '2026-06-09T12:00:00.000Z');
  const raw = await readFile(storePath, 'utf8');
  assert.match(raw, /"version": 1/);
  assert.doesNotMatch(raw, /\.tmp/);
});

test('write session batches page merges into bounded atomic checkpoints', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mychart-write-session-'));
  const store = new JsonMedicalStore({ storePath: path.join(dir, 'store.json') });
  const session = await store.openWriteSession({ checkpointPages: 2, checkpointMs: 60000 });
  const extraction = (id) => ({
    page: { sourceUrl: `https://example.test/details?id=${id}`, category: 'test-results' },
    records: [{ id, category: 'test-results', title: id, date: '2026-07-12', rawText: id, sourceUrl: `https://example.test/details?id=${id}` }],
  });
  await session.mergeExtractedPage(extraction('one'));
  assert.equal(await session.checkpointIfDue(), false);
  await session.mergeExtractedPage(extraction('two'));
  assert.equal(await session.checkpointIfDue(), true);
  assert.equal(session.checkpointWrites, 1);
  assert.equal((await store.getAllRecords()).length, 2);
});

test('failed later checkpoint leaves the last atomic generation readable', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mychart-checkpoint-recovery-'));
  const storePath = path.join(dir, 'store.json');
  const store = new JsonMedicalStore({ storePath });
  const session = await store.openWriteSession({ checkpointPages: 1, checkpointMs: 60000 });
  const extraction = (id) => ({
    page: { sourceUrl: `https://example.test/details?id=${id}`, category: 'test-results' },
    records: [{ id, category: 'test-results', title: id, date: '2026-07-12', rawText: id, sourceUrl: `https://example.test/details?id=${id}` }],
  });
  await session.mergeExtractedPage(extraction('durable'));
  await session.checkpointIfDue();
  await session.mergeExtractedPage(extraction('unflushed'));
  const originalWriteStore = store.writeStore.bind(store);
  store.writeStore = async () => { throw new Error('simulated checkpoint failure'); };
  await assert.rejects(() => session.checkpoint({ force: true }), /simulated checkpoint failure/);
  store.writeStore = originalWriteStore;
  assert.deepEqual((await store.getAllRecords()).map((record) => record.id), ['durable']);
});

test('existing SCH health-summary lab records normalize before filtering', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mychart-category-migration-'));
  const storePath = path.join(dir, 'store.json');
  await writeFile(storePath, JSON.stringify({
    version: 1,
    records: [{ id: 'lab', category: 'health-summary', recordType: 'lab-result', title: 'Panel', sourceUrl: 'https://mychart.seattlechildrens.org/mychart/app/test-results/details?eorderid=1' }],
    indexCards: [{ id: 'lab', category: 'health-summary', recordType: 'lab-result', title: 'Panel', sourceUrl: 'https://mychart.seattlechildrens.org/mychart/app/test-results/details?eorderid=1' }],
  }));
  const store = new JsonMedicalStore({ storePath });
  assert.equal((await store.getAllRecords())[0].category, 'test-results');
  assert.equal((await store.getIndexCards())[0].category, 'test-results');
});
