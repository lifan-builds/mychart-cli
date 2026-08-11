import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertActivePatientContext,
  bindPatientContext,
  inspectRequiredActivePatientContext,
} from '../src/browser/patient-context.js';

function element({ dataPatientName = '', ariaLabel = '', title = '', innerText = '' } = {}) {
  const attributes = {
    'data-patient-name': dataPatientName,
    'aria-label': ariaLabel,
    title,
  };
  return {
    innerText,
    getAttribute(name) {
      return attributes[name] || '';
    },
  };
}

function root(elements = []) {
  return { querySelectorAll: () => elements };
}

test('duplicated avatar initial validates an exact synthetic patient context', () => {
  assert.deepEqual(
    inspectRequiredActivePatientContext('Demo Child', root([element({ innerText: 'DDemo Child' })])),
    { status: 'validated' },
  );
});

test('clean aria-label outranks noisy rendered patient context text', () => {
  assert.deepEqual(
    inspectRequiredActivePatientContext('Demo Child', root([element({ ariaLabel: 'Demo Child', innerText: 'Avatar D Demo Child menu' })])),
    { status: 'validated' },
  );
});

test('substring and suffix labels fail exact context validation', () => {
  assert.deepEqual(
    inspectRequiredActivePatientContext('Demo Child', root([element({ ariaLabel: 'Demo Child Jr' })])),
    { status: 'mismatch' },
  );
});

test('missing patient context controls fail closed', () => {
  assert.deepEqual(inspectRequiredActivePatientContext('Demo Child', root([])), { status: 'missing' });
});

test('multiple independently active patient controls are ambiguous', () => {
  assert.deepEqual(
    inspectRequiredActivePatientContext('Demo Child', root([
      element({ ariaLabel: 'Demo Child' }),
      element({ ariaLabel: 'Other Child' }),
    ])),
    { status: 'ambiguous' },
  );
});

test('selector overlap is deduplicated by element identity', () => {
  const current = element({ ariaLabel: 'Demo Child' });
  assert.deepEqual(
    inspectRequiredActivePatientContext('Demo Child', root([current, current])),
    { status: 'validated' },
  );
});

test('assertion receives sanitized status only and never returns a raw label', async () => {
  let callbackResult;
  const page = {
    async evaluate(callback, expected) {
      callbackResult = callback(expected, root([element({ innerText: 'DDemo Child' })]));
      return callbackResult;
    },
  };
  const result = await assertActivePatientContext(page, 'Demo Child');
  assert.deepEqual(callbackResult, { status: 'validated' });
  assert.deepEqual(result, { status: 'validated', normalizedLabel: 'demo child' });
  assert.equal(JSON.stringify(callbackResult).includes('Demo Child'), false);
});

test('persisted context bindings use nonreversible keys and omit the raw label', async () => {
  const profileDir = await mkdtemp(path.join(tmpdir(), 'mychart-context-'));
  const binding = await bindPatientContext({
    profileDir,
    origin: 'https://mychart.example.test',
    normalizedLabel: 'demo child',
    validated: true,
  });
  const metadata = await readFile(path.join(profileDir, 'mychart-private-context.json'), 'utf8');
  assert.equal(binding.bound, true);
  assert.equal(metadata.toLowerCase().includes('demo child'), false);
  assert.equal(metadata.includes(binding.token), true);
});
