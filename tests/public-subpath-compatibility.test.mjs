import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import test from 'node:test';

import {
  hasClinicalVisitNoteText,
  VISIT_NOTE_MIN_TEXT_LENGTH,
} from '../src/core/clinical-record-quality.js';
import { createSyncUrlKey } from '../src/core/identity.js';
import { DEFAULT_DATA_HOME, resolveMyChartPaths } from '../src/core/paths.js';

test('published source subpaths retain their named exports', () => {
  assert.equal(VISIT_NOTE_MIN_TEXT_LENGTH, 500);
  assert.equal(
    hasClinicalVisitNoteText(`Assessment: ${'synthetic clinical text '.repeat(30)}`),
    true,
  );
  assert.equal(
    createSyncUrlKey('https://example.test/mychart/app/visits/note?csn=abc#main'),
    'https://example.test/mychart/app/visits/note?csn=abc',
  );
  assert.equal(DEFAULT_DATA_HOME, resolveMyChartPaths().dataHome);
});

test('published live-harness compatibility launcher remains executable', async () => {
  if (process.platform === 'win32') return;
  const launcher = await stat(new URL('../scripts/init-live-harness.sh', import.meta.url));
  assert.notEqual(launcher.mode & 0o111, 0);
});
