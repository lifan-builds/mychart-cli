import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalClinicalRouteIdentity,
  classifySyncLink,
  normalizeSyncCategories,
} from '../src/core/sync-route-classifier.js';
import { selectExtractionLinks } from '../src/browser/sync-runner.js';

const origin = 'https://mychart.example.test';

for (const [name, href, category, expected] of [
  ['modern result', `${origin}/mychart/app/test-results/details?eorderid=1`, 'test-results', 'strict'],
  ['legacy component', `${origin}/mychart/Clinical/TestResults?component=1`, 'test-results', 'strict'],
  ['visit note', `${origin}/mychart/app/visits/note?csn=1&noteid=2`, 'visits', 'strict'],
  ['trend', `${origin}/mychart/app/test-results/past-result-details?component=1`, 'test-results', 'rejected'],
  ['content redirect', `${origin}/mychart/Home/ContentRedirect?option=language`, 'test-results', 'rejected'],
  ['login', `${origin}/mychart/Authentication/Login`, 'visits', 'rejected'],
  ['credible unknown', `${origin}/mychart/clinical/new-results?resultid=1`, 'test-results', 'exhaustive'],
]) {
  test(`classifies ${name}`, () => {
    assert.equal(classifySyncLink({ href }, { category, expectedOrigin: origin }).admission, expected);
  });
}

test('strict extraction selection does not re-admit trend routes', () => {
  const selected = selectExtractionLinks({
    extraction: {
      page: { sourceUrl: `${origin}/mychart/app/test-results` },
      links: [
        { text: 'Compare result trends', href: `${origin}/mychart/app/test-results/past-result-details?component=1` },
        { text: 'Result', href: `${origin}/mychart/app/test-results/details?eorderid=1` },
      ],
    },
    target: { category: 'test-results' },
    expectedOrigin: origin,
    patientContextToken: 'private-token',
  });
  assert.deepEqual(selected.map((item) => item.classification.admission).sort(), ['rejected', 'strict']);
});

test('canonical identity ignores query order, fragments, and presentation parameters', () => {
  const left = canonicalClinicalRouteIdentity(`${origin}/mychart/app/test-results/details?eorderid=1&pageMode=2#x`, {
    category: 'test-results', patientContextToken: 'a',
  });
  const right = canonicalClinicalRouteIdentity(`${origin}/mychart/app/test-results/details?pageMode=9&eorderid=1`, {
    category: 'test-results', patientContextToken: 'a',
  });
  assert.equal(left, right);
  assert.notEqual(left, canonicalClinicalRouteIdentity(`${origin}/mychart/app/test-results/details?eorderid=1`, {
    category: 'test-results', patientContextToken: 'b',
  }));
});

test('category normalization is stable and rejects unsupported values', () => {
  assert.deepEqual(normalizeSyncCategories([' Test-Results ', 'visits', 'VISITS']), ['test-results', 'visits']);
  assert.throws(() => normalizeSyncCategories(['billing']), /Unsupported/);
});
