import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSourceUrlKey,
  createVisitCsnKey,
  normalizePatient,
  patientSyncKey,
} from '../src/core/identity.js';

test('normalizePatient creates stable keys from name and relationship', () => {
  const patient = normalizePatient({ name: 'Example Patient', relationship: 'Self' });

  assert.equal(patient.label, 'Example Patient (Self)');
  assert.equal(patient.key, normalizePatient({ name: 'Example Patient', relationship: 'Self' }).key);
  assert.notEqual(patient.key, normalizePatient({ name: 'Example Patient', relationship: 'Child' }).key);
});

test('normalizePatient canonicalizes no-relationship objects and strings to one key', () => {
  assert.equal(
    normalizePatient({ name: 'Demo Child', label: 'Demo Child' }).key,
    normalizePatient('Demo Child').key,
  );
});

test('normalizePatient rejects lab and medication labels as patient names', () => {
  assert.equal(normalizePatient('NON ORD'), null);
  assert.equal(normalizePatient('ZYRTEC ALLERGY PO'), null);
  assert.equal(normalizePatient('SGOT'), null);
  assert.equal(normalizePatient('Demo Child')?.name, 'Demo Child');
  assert.equal(normalizePatient('Demo Patient')?.name, 'Demo Patient');
});

test('source identity removes hash fragments and groups visit csn pages', () => {
  assert.equal(
    createSourceUrlKey('https://example.test/mychart/app/visits/note?csn=abc#main'),
    'https://example.test/mychart/app/visits/note?csn=abc',
  );
  assert.equal(
    createVisitCsnKey('https://example.test/mychart/app/visits/past-details?csn=abc&pageMode=notesfirst'),
    'https://example.test/visit-csn/abc',
  );
});

test('patientSyncKey uses the explicit unknown-patient fallback', () => {
  assert.equal(patientSyncKey(null), 'unknown-patient');
  assert.equal(patientSyncKey({ key: 'patient-one' }), 'patient-one');
});
