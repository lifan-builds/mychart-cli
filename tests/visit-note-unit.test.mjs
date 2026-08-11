import assert from 'node:assert/strict';
import test from 'node:test';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  extractMyChartRecordsFromText,
  extractRecordsFromDocument,
} = require('../src/extraction/extractor-core.js');

function makeDocumentFromMainText(text, href) {
  const main = {
    innerText: text,
    textContent: text,
    querySelectorAll() {
      return [];
    },
  };
  return {
    title: 'MyChart - Note from Care Team',
    body: { innerText: text, textContent: text },
    documentElement: { innerText: text, textContent: text },
    querySelector(selector) {
      return selector.includes('main') || selector.includes('[role="main"]') ? main : null;
    },
    querySelectorAll() {
      return [];
    },
    location: { href },
  };
}

test('visit-note unit captures one loaded telephone note body', () => {
  const records = extractMyChartRecordsFromText(`
    MyChart - Note from Care Team
    Notes from Care Team
    Telephone Encounter
    Signed Apr 13, 2026
    Telephone Encounter by Nurse Example, RN at 04/13/26 1104
    Patient called the answering service with a clinical concern.
    Patient states symptoms are ongoing after virtual urgent care.
    Nurse spoke with patient and reviewed instructions.
  `, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/app/visits/note?csn=abc&hnoID=def',
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].recordType, 'visit-note');
  assert.equal(records[0].title, 'Telephone Encounter by Nurse Example, RN at 04/13/26 1104');
});

test('visit-note unit captures a loaded anesthesia procedure note body', () => {
  const records = extractMyChartRecordsFromText(`
    MyChart - Note from Care Team
    Notes from Care Team
    Anesthesia Procedure Notes
    Signed Apr 28, 2026
    Neuraxial Procedure Note
    Procedure: Epidural
    Indication: Labor analgesia
    Preprocedure check: patient identified and consent verified
    Patient position: Sitting
    Preparation: sterile prep and drape
    Procedure level: lumbar
    Approach: midline
    Needle: Tuohy
    Attempts: 1
    Performing provider: Example Clinician, MD
    Authorizing provider: Example Supervisor, MD
    Comments: tolerated procedure without complication
  `, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/app/visits/note?csn=abc&hnoID=def',
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].recordType, 'visit-note');
  assert.equal(records[0].title, 'Anesthesia Procedure Notes');
});

test('visit-note unit captures MyChart procedure notes without a signed marker', () => {
  const records = extractMyChartRecordsFromText(`
    MyChart - Note from Care Team
    Notes from Care Team
    Anesthesia Procedure Notes
    Updated Mar 30, 2026
    Anesthesia Procedure Notes by Example Clinician, DO at 03/30/26 1322
    Procedure Orders
    1. Neuraxial [1234567890] ordered by Example Clinician, DO
    Neuraxial Procedure Note Procedure: epidural catheter placement
    Indication: labor analgesia
    Preprocedure check: patient identified and consent verified
    Patient position: sitting
    Preparation: sterile prep
    Procedure level: L3-4
    Approach: midline
    Needle: Tuohy
    Attempts: 1
    Performing provider: Example Clinician, DO
    Authorizing provider: Example Clinician, DO
    Comments: patient tolerated procedure without acute complication
    Medications Administered
  `, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/app/visits/note?csn=abc&hnoID=def',
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].recordType, 'visit-note');
  assert.equal(records[0].title, 'Anesthesia Procedure Notes');
});

test('visit-note unit captures bare MyChart procedure bodies as visit notes', () => {
  const records = extractMyChartRecordsFromText(`
    Date: 03/31/2026
    Procedure Time: 01:33
    Indications: Nutritional support
    Complications: N/A
    Comments: The following was performed for this patient.
    Verified the correct procedure, for the correct patient, at the correct site.
    The umbilical vein was dilated using forceps.
    A 3.5 Fr, single lumen, umbilical catheter was easily advanced into the vein.
    The position of the catheter was confirmed with an x-ray.
  `, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/app/visits/note?csn=abc&hnoID=procedure',
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].recordType, 'visit-note');
  assert.equal(records[0].title, 'Procedure for Nutritional support on 03/31/2026 at 01:33');
  assert.match(records[0].rawText, /umbilical catheter/);
});

test('visit-note unit captures NICU progress notes signed by a clinician', () => {
  const href = 'https://mychart.example.org/mychart/app/visits/note?csn=abc&hnoID=def';
  const noteText = [
    'MyChart - Note from Care Team',
    'Notes from Care Team',
    'Progress Notes (Baby Example)',
    'Signed May 9, 2026',
    'Progress Notes signed by Example Clinician, ARNP at 05/09/26 2202',
    'PROGRESS NOTE Date of Service: 05/09/2026 EXAMPLE, BABY MRN: TEST-ID PAC: TEST-PAC',
    'Physical Exam DOL: 40 GA: 33 wks 2 d PMA: 39 wks 0 d BW: 1660 Weight: 2560',
    'Place of Service: NICU Intensive Cardiac and respiratory monitoring, continuous and/or frequent vital sign monitoring General Exam: Stable on warmer in room air.',
    'Medication Active Medications: Nystatin Powder (PRN), Start Date: 05/05/2026, Duration: 5',
    'Respiratory Support: Type: Room Air Start Date: 05/03/2026 Duration: 7',
    'FEN Assessment: Infant tolerating feeds. Plan: Continue feeds.',
  ].join('\n');
  const extraction = extractRecordsFromDocument(makeDocumentFromMainText(noteText, href), {
    href,
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.records[0].recordType, 'visit-note');
  assert.equal(extraction.records[0].title, 'Progress Notes signed by Example Clinician, ARNP at 05/09/26 2202');
  assert.match(extraction.records[0].rawText, /Progress Notes signed by Example Clinician/);
  assert.match(extraction.records[0].rawText, /Physical Exam\nDOL:/);
  assert.match(extraction.records[0].rawText, /Medication\nActive Medications:/);
  assert.match(extraction.records[0].rawText, /Respiratory Support/);
  assert.match(extraction.records[0].summary, /Assessment: Infant tolerating feeds/);
});

test('visit-note unit captures a short loaded procedure note shell from the open page', () => {
  const href = 'https://mychart.example.org/mychart/app/visits/note?csn=abc&hnoID=def';
  const noteText = [
    'MyChart - Note from Care Team',
    'Notes from Care Team',
    'Anesthesia Procedure Notes',
    'Signed Apr 28, 2026',
    'Anesthesia Procedure Notes by Example Clinician, MD at 04/28/26 0901',
  ].join('\n');
  const extraction = extractRecordsFromDocument(makeDocumentFromMainText(noteText, href), {
    href,
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.indexCards.length, 1);
  assert.equal(extraction.records[0].recordType, 'visit-note');
  assert.equal(extraction.records[0].title, 'Anesthesia Procedure Notes');
});

test('visit-note unit captures a visible procedure note title when deep text is app shell', () => {
  const href = 'https://mychart.example.org/mychart/app/visits/note?csn=abc&hnoID=def';
  const visibleText = [
    'MyChart - Note from Care Team',
    'Anesthesia Procedure Notes',
  ].join('\n');
  const shellText = [
    '$$WP.Strings.getNamespace("visits").addString("ProcedureNotes", "Procedure Notes");',
    'if (self === top) var else top.location = "/mychart/Home/LogOut";',
    'Notes from Care Team',
    'Signed',
    'x'.repeat(60000),
  ].join('\n');
  const main = {
    innerText: visibleText,
    textContent: shellText,
    querySelectorAll() {
      return [];
    },
  };
  const documentRef = {
    title: 'MyChart - Note from Care Team',
    body: { innerText: visibleText, textContent: shellText },
    documentElement: { innerText: visibleText, textContent: shellText },
    querySelector(selector) {
      return selector.includes('main') || selector.includes('[role="main"]') ? main : null;
    },
    querySelectorAll() {
      return [];
    },
    location: { href },
  };
  const extraction = extractRecordsFromDocument(documentRef, {
    href,
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.records[0].recordType, 'visit-note');
  assert.equal(extraction.records[0].title, 'Anesthesia Procedure Notes');
  assert.ok(extraction.records[0].rawText.length < 1000);
});

test('visit-note unit prefers substantive deep note text over a concise visible header', () => {
  const href = 'https://mychart.example.org/mychart/app/visits/note?csn=abc&hnoID=def';
  const visibleText = [
    'MyChart - Note from Care Team',
    'Anesthesia Procedure Notes',
  ].join('\n');
  const deepText = [
    'MyChart - Note from Care Team',
    'Notes from Care Team',
    'Anesthesia Procedure Notes',
    'Signed Apr 15, 2026',
    'Anesthesia Procedure Notes by Example Clinician, MD at 04/15/26 1015',
    'Neuraxial Procedure Note',
    'Procedure: epidural catheter placement',
    'Indication: labor analgesia',
    'Preprocedure check: patient identified and consent verified',
    'Performing provider: Example Clinician, MD',
    'Authorizing provider: Example Supervisor, MD',
  ].join('\n');
  const main = {
    innerText: visibleText,
    textContent: deepText,
    querySelectorAll() {
      return [];
    },
  };
  const documentRef = {
    title: 'MyChart - Note from Care Team',
    body: { innerText: visibleText, textContent: deepText },
    documentElement: { innerText: visibleText, textContent: deepText },
    querySelector(selector) {
      return selector.includes('main') || selector.includes('[role="main"]') ? main : null;
    },
    querySelectorAll() {
      return [];
    },
    location: { href },
  };
  const extraction = extractRecordsFromDocument(documentRef, {
    href,
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.records[0].recordType, 'visit-note');
  assert.equal(extraction.records[0].title, 'Anesthesia Procedure Notes');
  assert.match(extraction.records[0].rawText, /Performing provider/);
  assert.ok(extraction.records[0].rawText.length > visibleText.length);
});

test('visit-note unit rejects MyChart scheduling shell text', () => {
  const records = extractMyChartRecordsFromText([
    'MyChart - Note from Care Team',
    '$$WP.Strings.getNamespace("scheduling").addString("SidebarPretext", "Emergency copy");',
    'if (self === top) var else top.location = "/mychart/Home/LogOut";',
    'if (typeof WP === "undefined") {',
    'Notes from Care Team',
    'April 30, 2026',
    'x'.repeat(60000),
  ].join('\n'), {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/app/visits/note?csn=abc&hnoID=def',
  });

  assert.equal(records.length, 0);
});

test('visit-note unit extracts one note from a single open document', () => {
  const href = 'https://mychart.example.org/mychart/app/visits/note?csn=abc&hnoID=def';
  const noteText = [
    'MyChart - Note from Care Team',
    'Notes from Care Team',
    'Telephone Encounter',
    'Signed Apr 13, 2026',
    'Telephone Encounter by Nurse Example, RN at 04/13/26 1104',
    'Patient called the answering service with a clinical concern.',
    'Patient states symptoms are ongoing after virtual urgent care.',
    'Nurse spoke with patient and reviewed instructions.',
  ].join('\n');
  const extraction = extractRecordsFromDocument(makeDocumentFromMainText(noteText, href), {
    href,
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.indexCards.length, 1);
  assert.equal(extraction.records[0].recordType, 'visit-note');
});

test('visit-note unit strips MyChart page chrome from loaded note body', () => {
  const href = 'https://mychart.example.org/mychart/app/visits/note?csn=abc&hnoID=def';
  const noteText = [
    'MyChart - Note from Care Team',
    'High Contrast',
    'Name: Example Patient | DOB: REDACTED | MRN: TEST-ID | PCP: NOT IN USE',
    'Error: Please enable JavaScript in your browser before using this site.',
    'Close the menu',
    'Community Resources Safety Plan Digital Health Billing Estimates Billing Support Payment and Billing FAQs Insurance Insurance Summary Sharing',
    'Notes from Care Team',
    'Telephone Encounter',
    'Signed Apr 13, 2026',
    'Telephone Encounter by Nurse Example, RN at 04/13/26 1104',
    'Patient states symptoms are improving.',
    'Nurse spoke with patient and reviewed instructions.',
  ].join('\n');
  const extraction = extractRecordsFromDocument(makeDocumentFromMainText(noteText, href), {
    href,
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.records[0].recordType, 'visit-note');
  assert.doesNotMatch(extraction.records[0].rawText, /enable JavaScript|MRN|Community Resources/i);
  assert.match(extraction.records[0].rawText, /Telephone Encounter by/);
});

test('visit-note unit strips collapsed MyChart page chrome from loaded note body', () => {
  const href = 'https://mychart.example.org/mychart/app/visits/note?csn=abc&hnoID=def';
  const noteText = [
    'MyChart - Note from Care Team High Contrast Name: Example Patient | DOB: REDACTED | MRN: TEST-ID | PCP: NOT IN USE Error: Please enable JavaScript in your browser before using this site. Close the menu Community Resources Safety Plan Digital Health Billing Estimates Billing Support Payment and Billing FAQs Insurance Insurance Summary Sharing',
    'Share My Record Link My Accounts Settings Personal Information Back to the Home Page',
    'Notes from Care Team',
    'Telephone Encounter',
    'Signed Apr 13, 2026',
    'Print this page in a printer-friendly format',
    'Telephone Encounter by Nurse Example, RN at 04/13/26 1104',
    'Patient states symptoms are improving.',
    'Nurse spoke with patient and reviewed instructions.',
  ].join('\n');
  const extraction = extractRecordsFromDocument(makeDocumentFromMainText(noteText, href), {
    href,
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.records[0].recordType, 'visit-note');
  assert.doesNotMatch(extraction.records[0].rawText, /High Contrast|enable JavaScript|MRN|Community Resources|Share My Record|Print this page/i);
  assert.match(extraction.records[0].rawText, /Telephone Encounter by/);
});
