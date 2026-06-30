import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { JsonMedicalStore } from '../src/storage/json-store.js';

test('JsonMedicalStore saves extracted pages and persists sync metadata atomically', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'awesome-mychart-store-'));
  const storePath = path.join(dir, 'store.json');
  const store = new JsonMedicalStore({ storePath });

  const result = await store.saveExtractedPage({
    page: {
      sourceUrl: 'https://example.test/mychart/app/test-results/details?id=1',
      category: 'test-results',
      patient: { name: 'Demo Child', label: 'Demo Child' },
    },
    records: [{
      id: 'lab-1',
      category: 'test-results',
      recordType: 'test-result',
      title: 'CBC(Demo Child)',
      date: '2026-06-09',
      rawText: 'CBC(Demo Child)\nWhite Blood Cells\nValue11.2High',
      sourceUrl: 'https://example.test/mychart/app/test-results/details?id=1',
    }],
  });
  await store.saveSyncMetadata({
    lastDeepSyncAt: '2026-06-09T12:00:00.000Z',
    visitedUrls: { 'https://example.test/mychart/app/test-results/details?id=1': '2026-06-09T12:00:00.000Z' },
  });

  assert.equal(result.recordCount, 1);
  assert.equal((await store.getAllRecords()).length, 1);
  assert.equal((await store.getIndexCards()).length, 1);
  assert.equal((await store.getSyncMetadata()).lastDeepSyncAt, '2026-06-09T12:00:00.000Z');

  const raw = await readFile(storePath, 'utf8');
  assert.match(raw, /"version": 1/);
  assert.doesNotMatch(raw, /\.tmp/);
});
