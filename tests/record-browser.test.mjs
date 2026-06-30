import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRecordBrowserState,
  getCategoryOptions,
  getPatientOptions,
  getRecordDisplayText,
  labelize,
  summarizeRecordDisplayQuality,
} from '../src/core/record-browser.js';

const patientOne = { key: 'one', label: 'Patient One' };
const patientTwo = { key: 'two', label: 'Patient Two' };

test('createRecordBrowserState filters by patient, category, and full raw text', () => {
  const cards = [
    { id: 'old', patient: patientTwo, category: 'visits', title: 'Visit', date: 'Apr 01, 2026' },
    { id: 'new', patient: patientOne, category: 'test-results', title: 'CBC', date: 'Apr 03, 2026' },
  ];
  const records = [
    { id: 'old', rawText: 'Follow up instructions' },
    { id: 'new', rawText: 'White blood cells value is 7.2' },
  ];

  const state = createRecordBrowserState({
    cards,
    records,
    query: 'white blood',
    patientKey: 'one',
    category: 'test-results',
    selectedRecordId: 'old',
  });

  assert.equal(state.countLabel, '1/2');
  assert.equal(state.totalMatchingCount, 1);
  assert.equal(state.isLimited, false);
  assert.equal(state.selectedRecordId, 'new');
  assert.deepEqual(state.filteredCards.map((card) => card.id), ['new']);
});

test('createRecordBrowserState counts all matches when the visible list is limited', () => {
  const cards = Array.from({ length: 3 }, (_, index) => ({
    id: `record-${index}`,
    patient: patientOne,
    category: 'visits',
    title: 'Visit',
    date: `Apr 0${index + 1}, 2026`,
  }));

  const state = createRecordBrowserState({ cards, limit: 2 });

  assert.equal(state.countLabel, '3/3');
  assert.equal(state.totalMatchingCount, 3);
  assert.equal(state.isLimited, true);
  assert.equal(state.filteredCards.length, 2);
});

test('record browser option helpers produce stable labels', () => {
  const cards = [
    { patient: patientTwo, category: 'test-results' },
    { patient: patientOne, category: 'visits' },
    { patient: patientOne, category: 'visits' },
  ];

  assert.deepEqual(getPatientOptions(cards).map((patient) => patient.label), [
    'Patient One',
    'Patient Two',
  ]);
  assert.deepEqual(getCategoryOptions(cards), ['test-results', 'visits']);
  assert.equal(labelize('test-results'), 'Test Results');
});

test('summarizeRecordDisplayQuality flags unclear records without exposing text', () => {
  assert.deepEqual(
    summarizeRecordDisplayQuality(
      {
        category: 'visits',
        recordType: 'visit-note',
        title: 'Notes from Care Team',
        sourceUrl: 'https://example.test/mychart/app/visits/note?csn=1',
      },
      { rawText: 'Notes from Care Team' },
    ),
    {
      level: 'review',
      label: '3 issues',
      flags: ['missing date', 'missing patient', 'note substance unclear'],
    },
  );

  assert.equal(
    summarizeRecordDisplayQuality(
      {
        category: 'test-results',
        title: 'CBC',
        date: 'Apr 03, 2026',
        patient: patientOne,
        sourceUrl: 'https://example.test/mychart/app/test-results/details?id=1',
      },
      { rawText: 'Your value is 7.2 K/uL' },
    ).level,
    'clean',
  );
});

test('record browser displays cleaned clinical note view by default', () => {
  const card = {
    category: 'visits',
    recordType: 'visit-note',
    snippet: 'Card snippet',
    sourceUrl: 'https://example.test/mychart/app/visits/note?csn=1',
  };
  const record = {
    category: 'visits',
    recordType: 'visit-note',
    clinicalText: 'Progress Notes by Demo Clinician\nAssessment and Plan: Clean view.',
    rawText: 'Noisy raw body',
    sourceText: 'Your Menu Search the menu noisy source',
  };

  assert.equal(
    getRecordDisplayText(record, card),
    'Progress Notes by Demo Clinician\nAssessment and Plan: Clean view.',
  );
});
