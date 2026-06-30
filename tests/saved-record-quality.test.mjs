import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  sanitizeStoredVisitText,
} from '../src/core/clinical-record-quality.js';
import {
  augmentRecordsWithDerivedTestResults,
  deriveEmbeddedTestResultRecords,
  getInvalidStoredVisitShellIds,
  summarizeSavedRecordQuality,
} from '../src/core/record-intake.js';
import { JsonMedicalStore } from '../src/storage/json-store.js';

const babyPatient = { key: 'demo-child', label: 'Demo Child', name: 'Demo Child' };

function makeStore() {
  return new JsonMedicalStore({
    storePath: path.join(tmpdir(), `awesome-mychart-test-${process.pid}-${Date.now()}-${Math.random()}.json`),
  });
}

test('summarizeSavedRecordQuality grades actual saved visit-note records', () => {
  const summary = summarizeSavedRecordQuality([
    {
      category: 'visits',
      recordType: 'visit-note',
      title: 'Telephone Encounter',
      rawText: 'Telephone Encounter by Nurse at 01/01/26 1200\nPatient called with an update.',
      sourceUrl: 'https://example.test/mychart/app/visits/note?csn=1',
    },
    {
      category: 'visits',
      recordType: 'visit-note',
      title: 'Notes from Care Team',
      rawText: 'Notes from Care Team',
      sourceUrl: 'https://example.test/mychart/app/visits/note?csn=2',
    },
    {
      category: 'test-results',
      recordType: 'test-result',
      rawText: 'Result',
    },
  ]);

  assert.equal(summary.visitRecords, 2);
  assert.equal(summary.visitNotes, 2);
  assert.equal(summary.substantiveVisitNotes, 1);
  assert.equal(summary.shellLikeVisitNotes, 1);
  assert.deepEqual(summary.recordTypes, {
    'visit-note': 2,
    'test-result': 1,
  });
});

test('sanitizeStoredVisitText removes collapsed MyChart menu text and reflows headings', () => {
  const cleaned = sanitizeStoredVisitText([
    'Your Menu Search the menu Clear search field Main menu Find Care',
    'Settings Personal Information Back to the Home Page Switch patients Change language\nNotes from Care Team',
    'Progress Notes Updated Mar 26, 2026 Progress Notes by Demo Clinician, MD at 03/26/26 0930',
    'Example Health Hospital Medicine Initial Consultation',
    'Assessment and Plan Continue monitoring.',
    'Subjective: Patient states symptoms improved.',
    'Objective: Vitals stable.',
    'Plan: Follow up as instructed.',
  ].join(' '));

  assert.doesNotMatch(cleaned, /Your Menu|Search the menu|Switch patients/i);
  assert.match(cleaned, /^Notes from Care Team\nProgress Notes Updated/m);
  assert.match(cleaned, /\nProgress Notes by Demo Clinician/);
  assert.match(cleaned, /\nAssessment and Plan /);
  assert.match(cleaned, /\nSubjective:/);
  assert.match(cleaned, /\nObjective:/);
  assert.match(cleaned, /\nPlan:/);
});

test('sanitizeStoredVisitText can start at the first clinical marker when note tab label is missing', () => {
  const cleaned = sanitizeStoredVisitText([
    'Your Menu Search the menu Clear search field Main menu Find Care',
    'Settings Personal Information Back to the Home Page Switch patients Change language',
    'Progress Notes by Demo Clinician, MD at 03/26/26 0930',
    'Assessment and Plan Continue monitoring.',
    'Chief Complaint: Follow up.',
  ].join('\n'));

  assert.doesNotMatch(cleaned, /Your Menu|Search the menu|Switch patients/i);
  assert.match(cleaned, /^Progress Notes by Demo Clinician/);
  assert.match(cleaned, /\nAssessment and Plan /);
  assert.match(cleaned, /\nChief Complaint:/);
});

test('sanitizeStoredVisitText cleans NICU plan of care and hospital H&P note shapes', () => {
  const plan = sanitizeStoredVisitText([
    "Demo Child's Menu Search the menu Clear search field Main menu",
    'Plan of Care by Nurse B, RN at 05/03/26 1955 Vital signs are stable on room air.',
    'Mother and father visited and ask appropriate questions.',
  ].join(' '));
  const admit = sanitizeStoredVisitText([
    'Notes from Care Team May 8, 2026 H&P signed by Clinician, ARNP at 05/08/26 1901',
    'ADMIT SUMMARY Transferring Hospital: NICU Hospital Course: Infant stable.',
  ].join(' '));

  assert.doesNotMatch(plan, /Search the menu|Clear search field|Main menu/i);
  assert.match(plan, /^Plan of Care by Nurse B/);
  assert.match(plan, /Vital signs are stable on room air/);
  assert.match(admit, /^Notes from Care Team/);
  assert.match(admit, /\nH&P signed by Clinician/);
  assert.match(admit, /\nADMIT SUMMARY/);
  assert.match(admit, /\nTransferring Hospital:/);
  assert.match(admit, /\nHospital Course:/);
});

test('sanitizeStoredVisitText reflows dense NICU admission demographics', () => {
  const cleaned = sanitizeStoredVisitText([
    'Notes from Care Team May 8, 2026 H&P signed by Clinician, ARNP at 05/08/26 1901',
    'ADMIT SUMMARY Transferring Hospital: Outside Place of Service: NICU Transported By: Team',
    "Mother's DOB: REDACTED Mother's Age: 30 Mother's Blood Type: O Positive",
    "Baby's Race: Asian Baby's Ethnicity: Not Hispanic or Latino Syphilis: Negative HIV: Negative Rubella: Immune",
    'GBS: Negative HBsAg: Negative Hep C: Negative EDC OB: 05/16/2026 RSV Vaccine: Yes Complications - Preg/Labor/Deliv: subamniotic bleed Hospital Course: Infant stable.',
  ].join(' '));

  assert.match(cleaned, /\nPlace of Service:/);
  assert.match(cleaned, /\nTransported By:/);
  assert.match(cleaned, /\nMother's DOB:/);
  assert.match(cleaned, /\nMother's Age:/);
  assert.match(cleaned, /\nMother's Blood Type:/);
  assert.match(
    sanitizeStoredVisitText("Mother's Age: 30 Mother's Blood O Positive Baby's Race: Asian"),
    /\nMother's Blood Type: O Positive\nBaby's Race: Asian/
  );
  assert.match(cleaned, /\nBaby's Race:/);
  assert.match(cleaned, /\nBaby's Ethnicity:/);
  assert.match(cleaned, /\nSyphilis:/);
  assert.match(cleaned, /\nHIV:/);
  assert.match(cleaned, /\nRubella:/);
  assert.match(cleaned, /\nGBS:/);
  assert.match(cleaned, /\nHBsAg:/);
  assert.match(cleaned, /\nHep C:/);
  assert.match(cleaned, /\nEDC OB:/);
  assert.match(cleaned, /\nRSV Vaccine:/);
  assert.match(cleaned, /\nComplications - Preg\/Labor\/Deliv:/);
});

test('invalid stored visit shell cleanup removes empty baby visit-list cards', () => {
  assert.deepEqual(
    getInvalidStoredVisitShellIds([
      {
        id: 'empty-baby-visits',
        category: 'visits',
        recordType: 'visit',
        sourceUrl: 'https://example.test/mychart/Visits',
        rawText: 'There are no upcoming visits to display. There are no past visits to display. This was a hospital visit',
      },
      {
        id: 'nicu-plan',
        category: 'visits',
        recordType: 'visit-note',
        sourceUrl: 'https://example.test/mychart/app/visits/note?csn=1',
        rawText: 'Plan of Care by Nurse B, RN\nVital signs are stable on room air.',
      },
    ]),
    ['empty-baby-visits'],
  );
});

test('normalizeRecord upgrades substantive baby note URLs to visit-note metadata', () => {
  const db = makeStore();
  const record = db.normalizeRecord({
    category: 'visits',
    recordType: 'visit',
    title: 'Error:',
    summary: "Demo Child's Menu Search the menu Clear search field Main menu",
    sourceUrl: 'https://example.test/mychart/app/visits/note?csn=baby',
    rawText: [
      "Demo Child's Menu Search the menu Clear search field Main menu",
      'Plan of Care by Nurse B, RN at 05/03/26 1955',
      'Vital signs are stable on room air.',
    ].join(' '),
  });

  assert.equal(record.recordType, 'visit-note');
  assert.equal(record.title, 'Plan of Care');
  assert.doesNotMatch(record.summary, /Search the menu|Clear search field|Main menu/i);
  assert.match(record.summary, /^Plan of Care by Nurse B/);
  assert.doesNotMatch(record.rawText, /Search the menu|Clear search field|Main menu/i);
});

test('normalizeRecord preserves source text and creates a cleaned clinical note view', () => {
  const db = makeStore();
  const rawText = [
    "Demo Child's Menu Search the menu Clear search field Main menu",
    'Notes from Care Team Progress Notes by Demo Clinician, MD at 05/09/26 2202',
    'Assessment and Plan: Infant remains admitted to NICU.',
  ].join(' ');
  const record = db.normalizeRecord({
    category: 'visits',
    recordType: 'visit-note',
    sourceUrl: 'https://example.test/mychart/app/visits/note?csn=baby',
    rawText,
  });
  const card = db.createIndexCard(record);

  assert.equal(record.sourceText, rawText);
  assert.doesNotMatch(record.clinicalText, /Search the menu|Clear search field|Main menu/i);
  assert.match(record.clinicalText, /^Notes from Care Team\nProgress Notes by Demo Clinician/);
  assert.equal(record.rawText, record.clinicalText);
  assert.match(card.snippet, /Assessment and\nPlan:/);
});

test('normalizeRecord upgrades bare procedure note URLs to visit-note metadata', () => {
  const db = makeStore();
  const record = db.normalizeRecord({
    category: 'visits',
    recordType: 'visit',
    title: 'Procedures signed by Cody J. Espinoza, ARNP at 03/31/26 0134',
    sourceUrl: 'https://example.test/mychart/app/visits/note?csn=baby&hnoID=procedure',
    rawText: [
      'PROCEDURE NOTE: Placement of Umbilical Venous Catheter',
      'Date/Time Note Written: 03/31/2026 01:34:17',
      "Patient's Name: DEMO CHILD",
      'Indications: Nutritional support',
      'Complications: N/A',
      'The umbilical vein was dilated using forceps.',
    ].join('\n'),
  });

  assert.equal(record.recordType, 'visit-note');
  assert.equal(record.title, 'Procedures signed by Cody J. Espinoza, ARNP at 03/31/26 0134');
  assert.match(record.summary, /Umbilical Venous Catheter|Nutritional support/);
});

test('normalizeRecord repairs baby patient context from stored title suffixes', () => {
  const db = makeStore();
  const record = db.normalizeRecord({
    category: 'test-results',
    recordType: 'test-result',
    title: 'CBC W/DIFFERENTIAL(Demo Child)',
    patient: { name: 'Demo Patient', label: 'Demo Patient' },
    sourceUrl: 'https://example.test/mychart/app/test-results/details?id=1',
    rawText: 'CBC W/DIFFERENTIAL(Demo Child)\nYour value is 12.3 K/uL',
  });

  assert.equal(record.patient.name, 'Demo Child');
});

test('normalizeRecord and normalizeIndexCard drop bogus patient labels', () => {
  const db = makeStore();
  const record = db.normalizeRecord({
    category: 'test-results',
    recordType: 'test-result',
    title: 'POC BEDSIDE GLUCOSE (NON ORD)',
    patient: { name: 'NON ORD', label: 'NON ORD' },
    sourceUrl: 'https://example.test/mychart/app/test-results/details?id=1',
    rawText: 'POC BEDSIDE GLUCOSE (NON ORD)\nYour value is 91 mg/dL',
  });
  const card = db.normalizeIndexCard({
    id: 'bogus',
    category: 'medications',
    recordType: 'medication',
    title: 'Cetirizine HCl (ZYRTEC ALLERGY PO)',
    patient: { name: 'ZYRTEC ALLERGY PO', label: 'ZYRTEC ALLERGY PO' },
    snippet: 'Documented by MA',
  });

  assert.equal(record.patient, null);
  assert.equal(card.patient, null);
});

test('normalizeRecord and normalizeIndexCard clean test-result display noise', () => {
  const db = makeStore();
  const record = db.normalizeRecord({
    id: 'cbc',
    category: 'test-results',
    recordType: 'test-result',
    title: 'CBC W/DIFFERENTIAL(Demo Child)',
    patient: { name: 'Demo Child', label: 'Demo Child' },
    rawText: [
      'CBC W/DIFFERENTIAL(Demo Child)',
      'Collected on May 09, 2026 4:00 PM',
      'White Blood Cells',
      'Normal value: 4.40 - 13.10 K/uL',
      'Value11.95High',
      'Compare result trends',
      'View trends',
      ')',
      'Waiting to start...',
    ].join('\n'),
  });
  const card = db.normalizeIndexCard({
    id: 'cbc',
    category: 'test-results',
    recordType: 'test-result',
    title: 'CBC W/DIFFERENTIAL(Demo Child)',
    patient: { name: 'Demo Child', label: 'Demo Child' },
    snippet: 'Value 11.95\n)\nWaiting to start...',
  });

  assert.equal(record.title, 'CBC W/DIFFERENTIAL');
  assert.match(record.rawText, /^CBC W\/DIFFERENTIAL\nCollected/m);
  assert.match(record.rawText, /Value 11\.95 High/);
  assert.doesNotMatch(record.rawText, /Waiting to start|Compare result trends|View trends|\n\)\n?/);
  assert.equal(card.title, 'CBC W/DIFFERENTIAL');
  assert.doesNotMatch(card.snippet, /Waiting to start|\n\)\n?/);
});

test('visit notes expose embedded recent lab results as grouped test-result records', () => {
  const records = deriveEmbeddedTestResultRecords({
    id: 'baby-note-1',
    category: 'visits',
    recordType: 'visit-note',
    title: 'Progress Notes by NICU Clinician at 05/09/26 0900',
    date: 'May 9, 2026',
    patient: babyPatient,
    sourceUrl: 'https://example.test/mychart/app/visits/note?csn=nicu&hnoID=one',
    extractedAt: '2026-05-10T00:00:00.000Z',
    rawText: [
      'Progress Notes by NICU Clinician at 05/09/26 0900',
      'Assessment and Plan:',
      'Recent Results',
      'CBC WITH DIFFERENTIAL',
      'Collection Time: 05/09/26 4:00 AM',
      'Result Value Ref Range',
      'White Blood Cells 11.95 4.40 - 13.10 K/uL',
      'Hemoglobin 15.3 13.5 - 19.5 g/dL',
      'BILIRUBIN TOTAL',
      'Collection Time: 05/09/26 5:15 AM',
      'Result Value Ref Range',
      'Bilirubin Total 8.2 0.2 - 1.3 mg/dL',
      'Respiratory Support',
      'Room air.',
    ].join('\n'),
  });

  assert.equal(records.length, 2);
  assert.equal(records[0].category, 'test-results');
  assert.equal(records[0].recordType, 'test-result');
  assert.equal(records[0].patient.label, 'Demo Child');
  assert.match(records[0].title, /CBC WITH DIFFERENTIAL \(May 9, 2026\)/);
  assert.match(records[0].rawText, /White Blood Cells 11\.95/);
  assert.doesNotMatch(records[0].rawText, /Respiratory Support/);
  assert.match(records[1].title, /BILIRUBIN TOTAL \(May 9, 2026\)/);
  assert.match(records[1].rawText, /Bilirubin Total 8\.2/);
});

test('embedded test-result extraction groups unlabelled panels by collection day', () => {
  const records = deriveEmbeddedTestResultRecords({
    id: 'baby-note-2',
    category: 'visits',
    recordType: 'visit-note',
    title: 'Progress Notes by NICU Clinician',
    patient: babyPatient,
    sourceUrl: 'https://example.test/mychart/app/visits/note?csn=nicu&hnoID=two',
    rawText: [
      'Recent Results',
      'Collection Time: 05/10/26 6:00 AM',
      'Result Value Ref Range',
      'POC Glucose 61 62 - 125 mg/dL',
      'Nutrition',
      'Feeds advanced.',
    ].join('\n'),
  });

  assert.equal(records.length, 1);
  assert.match(records[0].title, /Test Results \(May 10, 2026\)/);
  assert.equal(records[0].date, 'May 10, 2026');
  assert.match(records[0].rawText, /POC Glucose 61/);
});

test('embedded test-result extraction falls back to the visit day when no collection time is visible', () => {
  const records = deriveEmbeddedTestResultRecords({
    id: 'baby-note-visit-day',
    category: 'visits',
    recordType: 'visit-note',
    title: 'Progress Notes by NICU Clinician',
    date: 'May 11, 2026',
    patient: babyPatient,
    sourceUrl: 'https://example.test/mychart/app/visits/note?csn=nicu&hnoID=three',
    rawText: [
      'Recent Results',
      'Blood gas',
      'pH 7.34',
      'Glucose 72 mg/dL',
      'Plan',
      'Continue current care.',
    ].join('\n'),
  });

  assert.equal(records.length, 1);
  assert.match(records[0].title, /Test Results \(May 11, 2026\)/);
  assert.equal(records[0].date, 'May 11, 2026');
  assert.match(records[0].rawText, /Glucose 72 mg\/dL/);
});

test('derived embedded test results are not duplicated when a matching result already exists', () => {
  const existingLab = {
    id: 'lab-cbc',
    category: 'test-results',
    recordType: 'test-result',
    title: 'CBC WITH DIFFERENTIAL',
    date: 'May 9, 2026',
    patient: babyPatient,
    rawText: 'White Blood Cells 11.95 K/uL',
  };
  const visit = {
    id: 'baby-note-3',
    category: 'visits',
    recordType: 'visit-note',
    title: 'Progress Notes by NICU Clinician',
    date: 'May 9, 2026',
    patient: babyPatient,
    rawText: [
      'Recent Results',
      'CBC WITH DIFFERENTIAL',
      'Collection Time: 05/09/26 4:00 AM',
      'Result Value Ref Range',
      'White Blood Cells 11.95 4.40 - 13.10 K/uL',
    ].join('\n'),
  };

  assert.deepEqual(
    augmentRecordsWithDerivedTestResults([existingLab, visit]).map((record) => record.id),
    ['lab-cbc', 'baby-note-3'],
  );
});

test('normalizeRecord and normalizeIndexCard clean repeated medication details', () => {
  const db = makeStore();
  const record = db.normalizeRecord({
    category: 'medications',
    recordType: 'medication',
    title: 'simethicone 80 mg chewable tablet',
    rawText: 'simethicone 80 mg chewable tablet Commonly known as: MYLICON Details Documented by MA Morgan S Commonly known as: MYLICON Documented by MA Morgan S',
    summary: 'simethicone 80 mg chewable tablet Commonly known as: MYLICON Details Documented by MA Morgan S Commonly known as: MYLICON Documented by MA Morgan S',
  });
  const card = db.normalizeIndexCard({
    id: 'med',
    category: 'medications',
    recordType: 'medication',
    title: 'simethicone 80 mg chewable tablet',
    snippet: record.rawText,
  });

  assert.equal(
    record.rawText,
    'simethicone 80 mg chewable tablet Commonly known as: MYLICON Documented by MA Morgan S',
  );
  assert.equal(card.snippet, record.rawText);
});

test('normalizeRecord removes repeated pharmacy/refill medication action text', () => {
  const db = makeStore();
  const record = db.normalizeRecord({
    category: 'medications',
    recordType: 'medication',
    title: 'polyethylene glycol 17 g packet',
    rawText: 'polyethylene glycol 17 g packet Commonly known as: MIRALAX Take 1 diluted packet by mouth Daily as needed for Constipation. Prescribed April 2, 2026 Approved by Demo Clinician, MD Quantity 30 each Day supply 30 Pharmacy Details DEMO PHARMACY Request refill Commonly known as: MIRALAX Take 1 diluted packet by mouth Daily as needed for Constipation.Prescription DetailsPrescribedApril 2, 2026Approved byDemo Clinician, MDRefill DetailsQuantity30 eachDay supply30Pharmacy DetailsDEMO PHARMACYRequest refill',
  });

  assert.equal(
    record.rawText,
    'polyethylene glycol 17 g packet Commonly known as: MIRALAX Take 1 diluted packet by mouth Daily as needed for Constipation. Prescribed April 2, 2026 Approved by Demo Clinician, MD Quantity 30 each Day supply 30',
  );
  assert.doesNotMatch(record.rawText, /Pharmacy Details|Request refill|Prescription Details|Refill Details/i);
});

test('sanitizeStoredVisitTitle prefers admission summary over incidental section labels', () => {
  const db = makeStore();
  const record = db.normalizeRecord({
    category: 'visits',
    recordType: 'visit',
    title: 'Transferring Hospital:',
    sourceUrl: 'https://example.test/mychart/app/visits/note?csn=baby',
    rawText: [
      'Notes from Care Team May 8, 2026',
      'H&P signed by Clinician, ARNP at 05/08/26 1901',
      'ADMIT SUMMARY Transferring Hospital: Outside NICU Hospital Course: Infant stable.',
    ].join(' '),
  });

  assert.equal(record.title, 'ADMIT SUMMARY');
  assert.equal(record.recordType, 'visit-note');
});

test('sanitizeStoredVisitTitle prefers authored progress note titles', () => {
  const db = makeStore();
  const record = db.normalizeRecord({
    category: 'visits',
    recordType: 'visit-note',
    title: 'Progress Notes',
    sourceUrl: 'https://example.test/mychart/app/visits/note?csn=baby&hnoID=one',
    rawText: [
      'Notes from Care Team Progress Notes (Demo Child) Signed May 9, 2026',
      'Progress Notes signed by Jordan I. Clinician, ARNP at 05/09/26 2202',
      'Assessment and Plan: Infant remains admitted to NICU.',
    ].join('\n'),
  });

  assert.equal(record.title, 'Progress Notes signed by Jordan I. Clinician, ARNP at 05/09/26 2202');
});
