import assert from 'node:assert/strict';
import test from 'node:test';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildExtractorInjectionSource,
  createIndexCard,
  detectCategoryFromUrl,
  detectPatientContext,
  getDeepSyncTargets,
  inferRecordTypeFromText,
  collectMeaningfulLinks,
  extractMyChartRecordsFromText,
  extractRecordsFromDocument,
  normalizePatient,
  normalizeText,
} = require('../src/extraction/extractor-core.js');

test('extractor injection source installs the browser API without a build step', () => {
  const previous = globalThis.MyChartExtractorCore;
  try {
    delete globalThis.MyChartExtractorCore;
    Function(buildExtractorInjectionSource())();
    assert.equal(typeof globalThis.MyChartExtractorCore.extractRecordsFromDocument, 'function');
    assert.equal(typeof globalThis.MyChartExtractorCore.extractMyChartRecordsFromText, 'function');
    assert.equal(typeof globalThis.MyChartExtractorCore.getDeepSyncTargets, 'function');
  } finally {
    if (previous) globalThis.MyChartExtractorCore = previous;
    else delete globalThis.MyChartExtractorCore;
  }
});

function makeElement({ innerText = '', attrs = {}, children = [] } = {}) {
  const element = {
    innerText,
    parentElement: null,
    getAttribute(name) {
      return attrs[name] || '';
    },
    querySelectorAll(selector) {
      const selectors = selector.split(',').map((item) => item.trim());
      const descendants = [];
      const visit = (node) => {
        node.children.forEach((child) => {
          descendants.push(child);
          visit(child);
        });
      };
      visit(element);
      return descendants.filter((child) => selectors.some((item) => {
        if (item === 'a' || item.startsWith('a[')) return child.tagName === 'A';
        if (item === 'button') return child.tagName === 'BUTTON';
        if (item === '[aria-label]') return Boolean(child.attrs?.['aria-label']);
        if (item === '[title]') return Boolean(child.attrs?.title);
        return false;
      }));
    },
    children,
  };
  children.forEach((child) => {
    child.parentElement = element;
  });
  return element;
}

function makeLink({
  ariaLabel = '',
  innerText = '',
  textContent = '',
  href = 'https://mychart.example.org/mychart/app/test-results/details',
} = {}) {
  return {
    tagName: 'A',
    innerText,
    textContent,
    href,
    parentElement: null,
    attrs: { 'aria-label': ariaLabel },
    getAttribute(name) {
      if (name === 'href') return this.href;
      return this.attrs[name] || '';
    },
    querySelectorAll() {
      return [];
    },
    children: [],
  };
}

test('detectCategoryFromUrl maps Alternate MyChart MyChart clinical routes', () => {
  assert.equal(
    detectCategoryFromUrl('https://mychart.example.org/mychart/app/test-results'),
    'test-results',
  );
  assert.equal(
    detectCategoryFromUrl('https://mychart.example.org/mychart/Clinical/Medications'),
    'medications',
  );
  assert.equal(
    detectCategoryFromUrl('https://mychart.example.org/mychart/Visits'),
    'visits',
  );
  assert.equal(
    detectCategoryFromUrl('https://mychart.example.org/mychart/app/health-summary?mode=snapshot'),
    'health-summary',
  );
  assert.equal(
    detectCategoryFromUrl('https://mychart.example.org/mychart/app/radiology/results/123'),
    'imaging',
  );
});

test('normalizeText collapses whitespace without losing line boundaries', () => {
  assert.equal(normalizeText('  A\n\n   B\t C  '), 'A\nB C');
});

test('content patient normalization matches stored no-relationship keys', () => {
  assert.equal(
    normalizePatient({ name: 'Demo Child', label: 'Demo Child' }).key,
    normalizePatient('Demo Child').key,
  );
});

test('detectPatientContext prefers MyChart home patient names over generic settings text', () => {
  const documentRef = {
    title: 'MyChart - Home',
    querySelectorAll(selector) {
      const elements = [
        {
          matches: ['[class*="patient" i]'],
          innerText: 'patient settings',
          getAttribute() {
            return '';
          },
        },
        {
          matches: ['h1, h2, h3, [role="heading"]'],
          innerText: 'Welcome, Demo Patient!',
          getAttribute() {
            return '';
          },
        },
        {
          matches: ['h1, h2, h3, [role="heading"]'],
          innerText: 'There are 3 notifications for Demo Patient.',
          getAttribute() {
            return '';
          },
        },
      ];
      return elements.filter((element) => element.matches.includes(selector));
    },
  };

  assert.equal(detectPatientContext(documentRef).name, 'Demo Patient');
});

test('detectPatientContext reads current chart owner from MyChart body copy', () => {
  const documentRef = {
    title: 'MyChart - Change Your Shortcuts',
    querySelectorAll(selector) {
      const elements = [
        {
          matches: ['main, #main, [role="main"]'],
          innerText: "To change the shortcuts you see on your home page when viewing Demo Patient's chart:",
          getAttribute() {
            return '';
          },
        },
      ];
      return elements.filter((element) => element.matches.includes(selector));
    },
  };

  assert.equal(detectPatientContext(documentRef).name, 'Demo Patient');
});

test('detectPatientContext prefers explicit proxy context for baby charts', () => {
  const documentRef = {
    title: 'MyChart - Home',
    body: {
      innerText: [
        "Welcome! You're viewing Baby Demo.",
        'Today\'s Visits (Baby Demo)',
        'There are 3 notifications for Demo Patient.',
      ].join('\n'),
    },
    querySelectorAll(selector) {
      const elements = [
        {
          matches: ['.currentContext'],
          innerText: 'BBaby Demo',
          getAttribute() {
            return '';
          },
        },
      ];
      return elements.filter((element) => element.matches.includes(selector));
    },
  };

  assert.equal(detectPatientContext(documentRef).name, 'Baby Demo');
});

test('detectPatientContext reads patient suffixes on baby result records', () => {
  const documentRef = {
    title: 'DIC PANEL(Demo Child)',
    body: {
      innerText: 'DIC PANEL(Demo Child)\nWelcome, Demo Patient!',
    },
    querySelectorAll(selector) {
      const elements = [];
      return elements.filter((element) => element.matches.includes(selector));
    },
  };

  assert.equal(detectPatientContext(documentRef).name, 'Demo Child');
});

test('detectPatientContext ignores lab and medication suffixes as patients', () => {
  const documentRef = {
    title: 'POC BEDSIDE GLUCOSE (NON ORD)',
    body: {
      innerText: 'POC BEDSIDE GLUCOSE (NON ORD)\nWelcome, Demo Patient!',
    },
    querySelectorAll() {
      return [];
    },
  };

  assert.equal(detectPatientContext(documentRef).name, 'Demo Patient');
});

test('detectPatientContext falls back to MyChart assistant greeting', () => {
  const documentRef = {
    title: 'MyChart - Test Results',
    body: {
      innerText: "Test Results\nHi Demo Patient! I'm Grace\nHow can I help you?",
    },
    querySelectorAll(selector) {
      const elements = [];
      return elements.filter((element) => element.matches.includes(selector));
    },
  };

  assert.equal(detectPatientContext(documentRef).name, 'Demo Patient');
});

test('detectPatientContext ignores visit cards that mention patient visit type and provider', () => {
  const documentRef = {
    title: 'MyChart - Appointments and Visits',
    body: {
      innerText: [
        'Appointments and Visits',
        'New Patient Clinic Visit',
        'Friday May 08, 2026',
        'With Example Provider, MD',
      ].join('\n'),
    },
    querySelectorAll(selector) {
      const elements = [
        {
          matches: ['main, #main, [role="main"]'],
          innerText: this.body.innerText,
          getAttribute() {
            return '';
          },
        },
      ];
      return elements.filter((element) => element.matches.includes(selector));
    },
  };

  assert.equal(detectPatientContext(documentRef), null);
});

test('extractMyChartRecordsFromText creates bounded records from visible card text', () => {
  const text = `
    Test Results

    Comprehensive Metabolic Panel
    Apr 24, 2026
    Final result
    Sodium 140 mmol/L
    Potassium 4.0 mmol/L

    Complete Blood Count
    Apr 22, 2026
    Final result
    WBC 5.1 K/uL
  `;

  const records = extractMyChartRecordsFromText(text, {
    category: 'test-results',
    sourceUrl: 'https://mychart.example.org/mychart/app/test-results',
  });

  assert.equal(records.length, 2);
  assert.equal(records[0].title, 'Comprehensive Metabolic Panel');
  assert.equal(records[0].date, 'Apr 24, 2026');
  assert.equal(records[0].category, 'test-results');
  assert.match(records[0].rawText, /Sodium 140/);
  assert.equal(records[1].title, 'Complete Blood Count');
});

test('extractMyChartRecordsFromText cleans MyChart result link titles', () => {
  const records = extractMyChartRecordsFromText(`
    Lab POCT PERFORM URINE DIPSTICK Abnormal
    Apr 13, 2026
    Collected on Apr 13, 2026 4:45 PM
    Leukocytes
    Normal value: Negative
    Value Negative
  `, {
    category: 'test-results',
    sourceUrl: 'https://mychart.example.org/mychart/app/test-results',
  });

  assert.equal(records[0].title, 'POCT PERFORM URINE DIPSTICK');
});

test('extractMyChartRecordsFromText keeps visit notes with hidden no-js fallback text', () => {
  const records = extractMyChartRecordsFromText(`
    MyChart - Past Visit Details
    <meta http-equiv="refresh" content="0;url=/mychart/nojs.asp" />
    if (self === top) var InitialBodyClass = document.getElementById("initialBodyClass");

    Clinical Support - Apr 13, 2026
    with Nurse Example, RN at Example Clinic
    Notes from Care Team
    Progress Notes by Nurse Example, RN at 04/13/26 1600
    Patient here for UTI symptoms. Instructions given on how to collect the urine sample.
    UTI symptoms: Dysurea
    Urine dip: + for trace blood and leukocytes
    VS: 106/72, 84, 96.8, 99%
    Flank pain: Negative
    Reviewed that it takes 3-4 days to get the results back and to call the clinic with worsening symptoms.
    Example Nurse, RN
    04/13/26
    4:13 PM PDT
  `, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/app/visits/past-details?csn=abc&pageMode=notesfirst',
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].recordType, 'visit-note');
  assert.match(records[0].rawText, /UTI symptoms: Dysurea/);
  assert.doesNotMatch(records[0].rawText, /nojs\.asp|InitialBodyClass/);
});

test('extractMyChartRecordsFromText keeps telephone encounter note details', () => {
  const records = extractMyChartRecordsFromText(`
    MyChart - Note from Care Team
    Notes from Care Team
    Telephone Encounter
    Signed Apr 13, 2026
    Telephone Encounter by Nurse Example, RN at 04/13/26 1104
    Patient called the answering service with a clinical concern.
    Patient states symptoms are ongoing after virtual urgent care.
    Nurse spoke with patient, confirmed DOB, reviewed instructions, and advised follow-up.
    Patient states understanding, agreeable to plan, and denies further questions.
  `, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/app/visits/note?csn=abc&hnoID=def',
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].recordType, 'visit-note');
  assert.equal(records[0].title, 'Telephone Encounter by Nurse Example, RN at 04/13/26 1104');
  assert.match(records[0].rawText, /Telephone Encounter by Nurse Example/);
});

test('extractMyChartRecordsFromText rejects oversized visit note shells without note substance', () => {
  const shellText = [
    'MyChart - Note from Care Team',
    'Notes from Care Team',
    'April 30, 2026',
    '$$WP.Strings.getNamespace("scheduling").addString("SidebarPretext", "Emergency copy");',
    'if (self === top) var else top.location = "/mychart/Home/LogOut";',
    'if (typeof WP === "undefined") {',
    'Appointments and Visits List',
    'Loading...',
    'x'.repeat(60000),
  ].join('\n');
  const records = extractMyChartRecordsFromText(shellText, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/app/visits/note?csn=abc&hnoID=def',
  });

  assert.equal(records.length, 0);
});

test('extractMyChartRecordsFromText keeps oversized visit notes with note substance', () => {
  const noteText = [
    'MyChart - Note from Care Team',
    'Notes from Care Team',
    'Telephone Encounter',
    'Signed Apr 13, 2026',
    'Telephone Encounter by Nurse Example, RN at 04/13/26 1104',
    'Patient called the answering service with a clinical concern.',
    'Patient states symptoms are ongoing after virtual urgent care.',
    'Nurse spoke with patient and reviewed instructions.',
    'x'.repeat(60000),
  ].join('\n');
  const records = extractMyChartRecordsFromText(noteText, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/app/visits/note?csn=abc&hnoID=def',
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].recordType, 'visit-note');
});

test('extractRecordsFromDocument keeps telephone encounter note detail pages', () => {
  const noteText = [
    'MyChart - Note from Care Team',
    'Notes from Care Team',
    'Telephone Encounter',
    'Signed Apr 13, 2026',
    'Telephone Encounter by Nurse Example, RN at 04/13/26 1104',
    'Patient called the answering service with a clinical concern.',
    'Patient states symptoms are ongoing after virtual urgent care.',
    'Nurse spoke with patient, confirmed DOB, reviewed instructions, and advised follow-up.',
    'Patient states understanding, agreeable to plan, and denies further questions.',
  ].join('\n');
  const main = makeElement({ innerText: noteText });
  const documentRef = {
    title: 'MyChart - Note from Care Team',
    body: { innerText: noteText, textContent: noteText },
    documentElement: { innerText: noteText, textContent: noteText },
    querySelector(selector) {
      return selector.includes('main') || selector.includes('[role="main"]') ? main : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('h1') || selector.includes('[role="main"]')) return [];
      return main.querySelectorAll(selector);
    },
  };

  const extraction = extractRecordsFromDocument(documentRef, {
    href: 'https://mychart.example.org/mychart/app/visits/note?csn=abc&hnoID=def',
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.records[0].recordType, 'visit-note');
  assert.match(extraction.records[0].rawText, /Telephone Encounter by Nurse Example/);
});

test('extractMyChartRecordsFromText rejects trend-control fragments without clinical substance', () => {
  const records = extractMyChartRecordsFromText(`
    ResultsCompare result trends
    Results
    Compare result trends
    Compare COMPREHENSIVE METABOLIC PANEL result trends
    Compare result trends
  `, {
    category: 'test-results',
    sourceUrl: 'https://mychart.example.org/mychart/app/test-results/details',
  });

  assert.equal(records.length, 0);
});

test('extractMyChartRecordsFromText cleans duplicated MyChart lab row titles', () => {
  const records = extractMyChartRecordsFromText(`
    LabCBC NO DIFFERENTIALAbnormalCBC NO DIFFERENTIALAbnormal
    Mar 31, 2026
    Collected on Mar 31, 2026 4:47 AM
    White Blood Cells
    Normal value: 3.40 - 10.80 K/uL
    Value 21.35High
  `, {
    category: 'test-results',
    sourceUrl: 'https://mychart.example.org/mychart/app/test-results',
  });

  assert.equal(records[0].title, 'CBC NO DIFFERENTIAL');
  assert.match(records[0].rawText, /White Blood Cells/);
});

test('extractMyChartRecordsFromText rejects sparse test-result list rows without values', () => {
  const records = extractMyChartRecordsFromText(`
    CBC NO DIFFERENTIAL
    Mar 31, 2026
    Kelsey A Kairis, DO
  `, {
    category: 'test-results',
    sourceUrl: 'https://mychart.example.org/mychart/app/test-results',
  });

  assert.equal(records.length, 0);
});

test('extractMyChartRecordsFromText rejects empty after-visit-summary action blocks', () => {
  const records = extractMyChartRecordsFromText(`
    View After Visit Summary®
    Clinical Notes
    Details
  `, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/Visits',
  });

  assert.equal(records.length, 0);
});

test('extractMyChartRecordsFromText rejects repeated after-visit-summary tab labels', () => {
  const records = extractMyChartRecordsFromText(`
    After Visit Summary®After Visit Summary®
    After Visit Summary®
    After Visit Summary®
  `, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/app/visits/past-details',
  });

  assert.equal(records.length, 0);
});

test('extractMyChartRecordsFromText removes medication refill controls but keeps medication facts', () => {
  const records = extractMyChartRecordsFromText(`
    acetaminophen 500 mg tablet
    You cannot request a refill for this medication.
    You cannot request a refill for this medication.
    Commonly known as: TYLENOL
    Learn more
    Take 2 tablets by mouth every 6 hours.
    Additional information
    Prescription Details
    Prescribed
    April 2, 2026
    Approved by
    Dr. Example, MD
    Refill Details
    Request a refill
    Remove
  `, {
    category: 'medications',
    sourceUrl: 'https://mychart.example.org/mychart/Clinical/Medications',
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].title, 'acetaminophen 500 mg tablet');
  assert.match(records[0].rawText, /Commonly known as: TYLENOL/);
  assert.match(records[0].rawText, /Take 2 tablets by mouth every 6 hours/);
  assert.doesNotMatch(records[0].rawText, /cannot request a refill|Learn more|Remove|Refill Details/i);
});

test('extractMyChartRecordsFromText removes compact medication action copy', () => {
  const records = extractMyChartRecordsFromText(`
    Prenatal Vit-Fe Fumarate-FA (PRENATAL VITAMIN PO)
    Prenatal Vit-Fe Fumarate-FA (PRENATAL VITAMIN PO)Learn moreThis prescription cannot be refilled through MyChart. Contact your pharmacy for a refill.Additional informationDetailsDocumented byMA Michelle C, Medical AssistantRemove More details about MA Michelle C, Medical Assistant
  `, {
    category: 'medications',
    sourceUrl: 'https://mychart.example.org/mychart/Clinical/Medications',
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].title, 'Prenatal Vit-Fe Fumarate-FA (PRENATAL VITAMIN PO)');
  assert.doesNotMatch(records[0].rawText, /Learn more|cannot be refilled|Additional information|Remove/i);
  assert.match(records[0].rawText, /Documented by MA Michelle C, Medical Assistant/);
  assert.doesNotMatch(records[0].rawText, /about Prenatal/);
});

test('extractMyChartRecordsFromText removes compact medication details and duplicate title', () => {
  const records = extractMyChartRecordsFromText(`
    Cetirizine HCl (ZYRTEC ALLERGY PO)
    Cetirizine HCl (ZYRTEC ALLERGY PO) Details Documented by MA Morgan S, Medical Assistant Cetirizine HCl (ZYRTEC ALLERGY PO) Documented by MA Morgan S, Medical Assistant
  `, {
    category: 'medications',
    sourceUrl: 'https://mychart.example.org/mychart/Clinical/Medications',
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].title, 'Cetirizine HCl (ZYRTEC ALLERGY PO)');
  assert.equal(
    records[0].rawText,
    'Cetirizine HCl (ZYRTEC ALLERGY PO)\nDocumented by MA Morgan S, Medical Assistant',
  );
});

test('extractMyChartRecordsFromText splits separate medication cards', () => {
  const records = extractMyChartRecordsFromText(`
    acetaminophen 500 mg tablet
    Commonly known as: TYLENOL
    Take 2 tablets by mouth every 6 hours.
    Documented by Nurse Michele P, RN

    Cetirizine HCl (ZYRTEC ALLERGY PO)
    Documented by MA Morgan S, Medical Assistant
  `, {
    category: 'medications',
    sourceUrl: 'https://mychart.example.org/mychart/Clinical/Medications',
  });

  assert.equal(records.length, 2);
  assert.equal(records[0].title, 'acetaminophen 500 mg tablet');
  assert.match(records[0].rawText, /Commonly known as: TYLENOL/);
  assert.equal(records[1].title, 'Cetirizine HCl (ZYRTEC ALLERGY PO)');
  assert.doesNotMatch(records[0].rawText, /Cetirizine/);
});

test('extractMyChartRecordsFromText skips test-result navigation titles', () => {
  const pageRecords = extractMyChartRecordsFromText(`
    Test Results List
    CBC W/DIFFERENTIAL
    Collected on Apr 01, 2026 5:13 AM
    Results
    White Blood Cells
    Normal value: 3.40 - 10.80 K/uL
  `, {
    category: 'test-results',
    sourceUrl: 'https://mychart.example.org/mychart/app/test-results/details',
  });
  const componentRecords = extractMyChartRecordsFromText(`
    Results
    Collected on Apr 01, 2026 5:13 AM
    Magnesium
    Normal range: 1.6 - 2.3 mg/dL
    Your value is 6.3 mg/dL
  `, {
    category: 'test-results',
    sourceUrl: 'https://mychart.example.org/mychart/app/test-results/details',
  });

  assert.equal(pageRecords[0].title, 'CBC W/DIFFERENTIAL');
  assert.doesNotMatch(pageRecords[0].rawText, /Test Results List|Results White Blood Cells/);
  assert.match(pageRecords[0].rawText, /White Blood Cells/);
  assert.equal(componentRecords[0].title, 'Magnesium');
  assert.doesNotMatch(componentRecords[0].rawText, /^Results\b/);
});

test('extractMyChartRecordsFromText promotes trend analyte titles and structured blood gas values', () => {
  const trendRecords = extractMyChartRecordsFromText(`
    Date Value Normal Range
    Base Excess
    Jun 10, 2026 -2 -2 - 2
    Normal range: -2 - 2
    Value -2
  `, {
    category: 'test-results',
    sourceUrl: 'https://mychart.example.org/mychart/app/test-results/details',
  });
  const gasRecords = extractMyChartRecordsFromText(`
    Blood Gas, Capillary
    Collected on Jun 10, 2026 7:42 AM
    pH, Capillary
    Normal value: 7.32 - 7.42
    Value 7.42
    pCO2 Capillary
    Normal value: 35 - 45 mmHg
    Value 36
    Bicarbonate Capillary
    Value 23
    Base Excess
    Value -2 Low
  `, {
    category: 'test-results',
    sourceUrl: 'https://mychart.example.org/mychart/app/test-results/details',
  });

  assert.equal(trendRecords[0].title, 'Base Excess');
  assert.equal(gasRecords[0].metadata.specimenType, 'capillary');
  assert.equal(gasRecords[0].metadata.collectedTime, '7:42 AM');
  assert.deepEqual(gasRecords[0].metadata.labValues, {
    pH: 7.42,
    pCO2: 36,
    HCO3: 23,
    baseExcess: -2,
  });
  assert.deepEqual(gasRecords[0].metadata.abnormalFlags, ['low']);
});

test('extractMyChartRecordsFromText rejects value-only test-result fragments', () => {
  const records = extractMyChartRecordsFromText(`
    Normal value: Negative
    Value Negative
  `, {
    category: 'test-results',
    sourceUrl: 'https://mychart.example.org/mychart/app/test-results/details',
  });

  assert.equal(records.length, 0);
});

test('extractMyChartRecordsFromText rejects compressed value-only test-result fragments', () => {
  const records = extractMyChartRecordsFromText(`
    Value
    Value 1.5High
    Your value is 1.5 per 100 WBCs
    This value is High
    Normal value: 0.0 per 100 WBCs
    Value1.5HighYour value is 1.5 per 100 WBCsThis value is HighNormal value: 0.0 per 100 WBCs
  `, {
    category: 'test-results',
    sourceUrl: 'https://mychart.example.org/mychart/app/test-results/details',
  });

  assert.equal(records.length, 0);
});

test('extractMyChartRecordsFromText rejects undated test-result component rows', () => {
  const records = extractMyChartRecordsFromText(`
    Magnesium
    Normal range: 1.6 - 2.3 mg/dL
    Your value is 6.3 mg/dL
  `, {
    category: 'test-results',
    sourceUrl: 'https://mychart.example.org/mychart/app/test-results/details',
  });

  assert.equal(records.length, 0);
});

test('extractMyChartRecordsFromText removes spinner tails and redundant patient suffixes from test results', () => {
  const records = extractMyChartRecordsFromText(`
    CBC W/DIFFERENTIAL(Demo Child)
    Collected on May 09, 2026 4:00 PM
    White Blood Cells
    Normal value: 4.40 - 13.10 K/uL
    Value 11.95
    )
    Waiting to start...
  `, {
    category: 'test-results',
    sourceUrl: 'https://mychart.example.org/mychart/app/test-results/details',
    patient: { name: 'Demo Child', label: 'Demo Child' },
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].title, 'CBC W/DIFFERENTIAL');
  assert.match(records[0].rawText, /^CBC W\/DIFFERENTIAL\nCollected/m);
  assert.doesNotMatch(records[0].rawText, /Waiting to start|\n\)\n?/i);
});

test('extractRecordsFromDocument keeps dated test-result detail pages together', () => {
  const component = makeElement({
    innerText: [
      'White Blood Cells',
      'Normal value: 3.40 - 10.80 K/uL',
      'Value 21.35High',
    ].join('\n'),
  });
  const main = makeElement({
    innerText: [
      'CBC W/DIFFERENTIAL',
      'Collected on Apr 01, 2026 5:13 AM',
      'White Blood Cells',
      'Normal value: 3.40 - 10.80 K/uL',
      'Value 21.35High',
      'Red Blood Cells',
      'Normal value: 3.77 - 5.28 M/uL',
      'Value 3.58Low',
    ].join('\n'),
    children: [component],
  });
  const documentRef = {
    title: 'MyChart - Test Details',
    body: { innerText: "Hi Demo Patient! I'm Grace" },
    querySelector(selector) {
      return selector.includes('main') ? main : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('h1') || selector.includes('[role="main"]')) return [];
      return main.querySelectorAll(selector);
    },
  };

  const extraction = extractRecordsFromDocument(documentRef, {
    href: 'https://mychart.example.org/mychart/app/test-results/details?component=abc',
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.records[0].title, 'CBC W/DIFFERENTIAL');
  assert.equal(extraction.records[0].date, 'Apr 01, 2026');
  assert.match(extraction.records[0].rawText, /White Blood Cells/);
  assert.match(extraction.records[0].rawText, /Red Blood Cells/);
});

test('extractRecordsFromDocument keeps legacy Clinical TestResults component pages together', () => {
  const main = makeElement({
    innerText: [
      'Bilirubin Total',
      'Collected on May 28, 2026 6:10 AM',
      'Bilirubin Total',
      'Normal range: 0.2 - 1.0 mg/dL',
      'Value 7.8High',
    ].join('\n'),
  });
  const documentRef = {
    title: 'MyChart - Test Details',
    body: { innerText: "Hi Demo Patient! I'm Grace" },
    querySelector(selector) {
      return selector.includes('main') ? main : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('h1') || selector.includes('[role="main"]')) return [];
      return main.querySelectorAll(selector);
    },
  };

  const extraction = extractRecordsFromDocument(documentRef, {
    href: 'https://mychart.example.org/mychart/Clinical/TestResults?component=bilirubin',
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.records[0].category, 'test-results');
  assert.equal(extraction.records[0].date, 'May 28, 2026');
  assert.match(extraction.records[0].rawText, /Value 7.8High/);
});

test('extractRecordsFromDocument treats same-route test-results URLs with eorderid as details', () => {
  const main = makeElement({
    innerText: [
      'Blood Gas, Capillary',
      'Collected on May 28, 2026 7:42 AM',
      'pH, Capillary',
      'Normal value: 7.32 - 7.42',
      'Value 7.28Low',
    ].join('\n'),
  });
  const documentRef = {
    title: 'MyChart - Test Details',
    body: { innerText: "Hi Demo Patient! I'm Grace" },
    querySelector(selector) {
      return selector.includes('main') ? main : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('h1') || selector.includes('[role="main"]')) return [];
      return main.querySelectorAll(selector);
    },
  };

  const extraction = extractRecordsFromDocument(documentRef, {
    href: 'https://mychart.example.org/mychart/app/test-results?pageMode=1&eorderid=abc',
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.records[0].category, 'test-results');
  assert.equal(extraction.records[0].date, 'May 28, 2026');
  assert.match(extraction.records[0].rawText, /pH, Capillary/);
});

test('extractRecordsFromDocument keeps external scan test-result details without value rows', () => {
  const main = makeElement({
    innerText: [
      'Test Results List',
      'LABS - EXTERNAL SCAN(Demo Child)',
      'Results',
      'Ordered by an unspecified provider.',
      'Scan 1',
      'Learn more about LABS - EXTERNAL SCAN',
      'Additional information',
      'Waiting to start...',
    ].join('\n'),
  });
  const documentRef = {
    title: 'MyChart - Test Details',
    body: { innerText: "You're viewing Demo Child." },
    querySelector(selector) {
      return selector.includes('main') ? main : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('h1') || selector.includes('[role="main"]')) return [];
      return main.querySelectorAll(selector);
    },
  };

  const extraction = extractRecordsFromDocument(documentRef, {
    href: 'https://mychart.example.org/mychart/app/test-results/details?pageMode=1&eorderid=external-scan',
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.records[0].title, 'LABS - EXTERNAL SCAN');
  assert.equal(extraction.records[0].date, '');
  assert.match(extraction.records[0].rawText, /Scan 1/);
});

test('extractRecordsFromDocument keeps long test-result detail pages together', () => {
  const repeatedComponents = Array.from({ length: 180 }, (_, index) => ([
    `Component ${index + 1}`,
    'Normal value: 1.0 - 9.9 mg/dL',
    `Value ${(index + 1) / 10} mg/dL`,
  ].join('\n'))).join('\n');
  const component = makeElement({
    innerText: [
      'Component 1',
      'Normal value: 1.0 - 9.9 mg/dL',
      'Value 0.1 mg/dL',
    ].join('\n'),
  });
  const main = makeElement({
    innerText: [
      'Comprehensive Metabolic Panel',
      'Collected on Apr 01, 2026 5:13 AM',
      repeatedComponents,
    ].join('\n'),
    children: [component],
  });
  const documentRef = {
    title: 'MyChart - Test Details',
    body: { innerText: "Hi Demo Patient! I'm Grace" },
    querySelector(selector) {
      return selector.includes('main') ? main : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('h1') || selector.includes('[role="main"]')) return [];
      return main.querySelectorAll(selector);
    },
  };

  const extraction = extractRecordsFromDocument(documentRef, {
    href: 'https://mychart.example.org/mychart/app/test-results/details?component=abc',
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.records[0].title, 'Comprehensive Metabolic Panel');
  assert.equal(extraction.records[0].date, 'Apr 01, 2026');
  assert.match(extraction.records[0].rawText, /Component 180/);
});

test('extractMyChartRecordsFromText removes visit-list action controls', () => {
  const records = extractMyChartRecordsFromText(`
    Appointments and Visits List
    Office Visit - Apr 22, 2026
    with Example Provider, MD at Example Health Heart And Vascular Issaquah
    Not yet viewed
    View After Visit Summary®
    Not yet viewed
    View clinical notes
  `, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/Visits',
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].title, 'Office Visit - Apr 22, 2026');
  assert.doesNotMatch(records[0].rawText, /Appointments and Visits List|Not yet viewed|View After Visit|View clinical/i);
  assert.match(records[0].rawText, /Example Provider/);
});

test('extractMyChartRecordsFromText removes empty visit-detail action labels', () => {
  const records = extractMyChartRecordsFromText(`
    Office Visit - Apr 22, 2026
    with Example Provider, MD at Example Health Heart And Vascular Issaquah
    After Visit Summary® After Visit Summary®
    Notes from Care Team Notes from Care Team
    Notes from Care Team
    Download this file
    Some of this information might have changed since your visit.
    This is what your chart included on the day of your visit.
  `, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/app/visits/past-details',
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].title, 'Office Visit - Apr 22, 2026');
  assert.doesNotMatch(records[0].rawText, /After Visit Summary|Notes from Care Team Notes from Care Team|Download this file|changed since your visit/);
  assert.match(records[0].rawText, /Example Health Heart And Vascular Issaquah/);
});

test('extractMyChartRecordsFromText reads comma-less MyChart visit dates and removes loading labels', () => {
  const records = extractMyChartRecordsFromText(`
    July 16 2026
    Jul 16 2026
    New Patient Clinic Visit
    Tina Xu, DO
    Loading...
  `, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/Visits',
    extractedAt: '2026-04-28T00:00:00.000Z',
  });

  assert.equal(records.length, 0);
});

test('extractMyChartRecordsFromText keeps past visit metadata after trimming', () => {
  const records = extractMyChartRecordsFromText(`
    April 22 2026
    Apr 22 2026
    Office Visit
    Example Provider, MD
    Loading...
  `, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/Visits',
    extractedAt: '2026-04-28T00:00:00.000Z',
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].date, 'April 22 2026');
  assert.equal(records[0].title, 'Office Visit');
  assert.doesNotMatch(records[0].rawText, /Loading|Apr 22 2026/);
});

test('extractMyChartRecordsFromText collapses duplicated telephone encounter metadata', () => {
  const records = extractMyChartRecordsFromText(`
    Telephone Encounter
    Signed Apr 13, 2026, 11:11 AM
    Nurse Michele P, RN
    Telephone EncounterSigned Apr 13, 2026, 11:11 AMNurse Michele P, RN
    Telephone Encounter, Signed Apr 13, 2026, 11:11 AM, Nurse Michele P, RN
    Photo of Nurse Michele P, RN
  `, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/Visits',
  });

  assert.equal(records.length, 1);
  assert.equal(
    records[0].rawText,
    'Telephone Encounter\nSigned Apr 13, 2026, 11:11 AM\nNurse Michele P, RN',
  );
});

test('extractMyChartRecordsFromText dedupes identical clinical content across source urls', () => {
  const text = `
    Office Visit - Apr 22, 2026
    with Example Provider, MD at Example Health Heart And Vascular Issaquah
  `;
  const first = extractMyChartRecordsFromText(text, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/Visits',
  });
  const second = extractMyChartRecordsFromText(text, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/app/visits/past-details?csn=abc',
  });

  assert.equal(first[0].id, second[0].id);
});

test('extractRecordsFromDocument prefers linked MyChart test-result rows over status chips', () => {
  const resultLink = makeLink({
    ariaLabel: 'Lab',
    textContent: 'POCT PERFORM URINE DIPSTICK',
  });
  const row = makeElement({
    innerText: 'Abnormal\nApr 13, 2026\nNurse Example, RN\nMessages from Care Team',
    children: [resultLink],
  });
  const main = makeElement({ children: [row] });
  const documentRef = {
    title: 'MyChart - Test Results',
    body: { innerText: "Hi Demo Patient! I'm Grace" },
    querySelector(selector) {
      return selector.includes('main') ? main : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('h1') || selector.includes('[role="main"]')) return [];
      return main.querySelectorAll(selector);
    },
  };

  const extraction = extractRecordsFromDocument(documentRef, {
    href: 'https://mychart.example.org/mychart/app/test-results',
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 0);
});

test('extractRecordsFromDocument exposes legacy test-result links from list rows for deep sync', () => {
  const resultLink = makeLink({
    ariaLabel: 'Lab',
    textContent: 'CBC W/DIFFERENTIAL',
    href: 'https://mychart.example.org/mychart/Clinical/TestResults?component=cbc',
  });
  const row = makeElement({
    innerText: 'Final result\nMay 28, 2026\nCBC W/DIFFERENTIAL',
    children: [resultLink],
  });
  const main = makeElement({ children: [row] });
  const documentRef = {
    title: 'MyChart - Test Results',
    body: { innerText: "Hi Demo Patient! I'm Grace" },
    querySelector(selector) {
      return selector.includes('main') ? main : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('h1') || selector.includes('[role="main"]')) return [];
      return main.querySelectorAll(selector);
    },
  };

  const extraction = extractRecordsFromDocument(documentRef, {
    href: 'https://mychart.example.org/mychart/Clinical/TestResults',
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 0);
  assert.deepEqual(extraction.links, [{
    text: 'CBC W/DIFFERENTIAL',
    href: 'https://mychart.example.org/mychart/Clinical/TestResults?component=cbc',
  }]);
});

test('extractRecordsFromDocument captures full MyChart visit note body over shell cards', () => {
  const noteText = [
    'Office Visit - Apr 22, 2026',
    'with Example Provider, MD at Example Health Heart And Vascular Issaquah',
    'Notes from Care Team',
    'Progress Notes by Example Provider, MD at 04/22/26 1130',
    'Example Health Heart and Vascular - Issaquah',
    'Initial Evaluation',
    'Date: 4/22/2026',
    'Patient: Demo Patient',
    'Chief Complaint:',
    'Evaluation for shortness of breath and possible arrhythmias.',
    'History of Present Illness:',
    'I am asked to see this pleasant 30-year-old woman who is 3 weeks postpartum.',
    'She had intermittent episodes of shortness of breath during pregnancy.',
    'Assessment and Plan:',
    'Postpartum shortness of breath evaluation.',
  ].join('\n');
  const shell = makeElement({
    innerText: 'Office Visit - Apr 22, 2026\nwith Example Provider, MD at Example Health Heart And Vascular Issaquah\nNotes from Care Team',
  });
  const main = makeElement({
    innerText: noteText,
    children: [shell],
  });
  const documentRef = {
    title: 'MyChart - Past Visit Details',
    body: { innerText: `${noteText}\nHi Demo Patient! I'm Grace` },
    querySelector(selector) {
      return selector.includes('main') ? main : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('h1') || selector.includes('[role="main"]')) return [];
      return main.querySelectorAll(selector);
    },
  };

  const extraction = extractRecordsFromDocument(documentRef, {
    href: 'https://mychart.example.org/mychart/app/visits/past-details?csn=abc',
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.records[0].recordType, 'visit-note');
  assert.match(extraction.records[0].rawText, /History of Present Illness/);
  assert.match(extraction.records[0].rawText, /shortness of breath during pregnancy/);
});

test('extractRecordsFromDocument falls back to body text for embedded MyChart visit notes', () => {
  const noteText = [
    'Office Visit - Apr 22, 2026',
    'Notes from Care Team',
    'Progress Notes by Example Provider, MD at 04/22/26 1130',
    'Example Health Heart and Vascular - Issaquah',
    'Initial Evaluation',
    'Date: 4/22/2026',
    'Patient: Demo Patient',
    'Chief Complaint:',
    'Evaluation for shortness of breath and possible arrhythmias.',
    'History of Present Illness:',
    'The patient had intermittent episodes of shortness of breath.',
  ].join('\n');
  const main = makeElement({
    innerText: 'Office Visit - Apr 22, 2026\nwith Example Provider, MD at Example Health Heart And Vascular Issaquah\nNotes from Care Team',
  });
  const documentRef = {
    title: 'MyChart - Past Visit Details',
    body: { textContent: noteText },
    documentElement: { textContent: noteText },
    querySelector(selector) {
      return selector.includes('main') ? main : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('h1') || selector.includes('[role="main"]')) return [];
      return main.querySelectorAll(selector);
    },
  };

  const extraction = extractRecordsFromDocument(documentRef, {
    href: 'https://mychart.example.org/mychart/app/visits/past-details?csn=abc',
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.records[0].recordType, 'visit-note');
  assert.match(extraction.records[0].summary, /shortness of breath/);
  assert.match(extraction.records[0].rawText, /intermittent episodes of shortness of breath/);
});

test('extractRecordsFromDocument preserves example consult note header date over blood-gas values', () => {
  const noteBody = [
    'HISTORY OF PRESENT ILLNESS:',
    'Demo Child had intermittent acute decompensation associated with metabolic acidosis.',
    'Blood gases/BG at times of acute decompensation BG 7.365/27.8/48/15.9/-8 Glucose 189.',
    'OBJECTIVE:',
    'Physical Exam: central hypotonia noted with supported pull to sit.',
    'RESULTS REVIEW: Preliminary cEEG results (6/8): Background is mostly continuous and symmetric. No interictal abnormalities or seizures.',
    'ASSESSMENT:',
    'Prior episodes of apnea precipitating transfer could theoretically be associated with seizure; will assess further with cEEG.',
    'RECOMMENDATIONS:',
    'Will review MRI brain with neuroradiology.',
    'Example Clinician, M.D., PGY-4 Child Neurology, Example Children\'s Hospital',
  ].join('\n');
  const pageText = [
    'Notes from Care Team',
    'Consulting Provider Notes(Demo Child)',
    'Signed Jun 8, 2026',
    'Consulting Provider Notes by Example Clinician, MD at 6/8/2026 4:15 PM',
  ].join('\n');
  const main = makeElement({ innerText: noteBody });
  const documentRef = {
    title: 'MyChart - Note from Care Team',
    body: { innerText: pageText, textContent: pageText },
    documentElement: { innerText: pageText, textContent: pageText },
    querySelector(selector) {
      return selector.includes('main') ? main : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('h1') || selector.includes('[role="main"]')) return [];
      return main.querySelectorAll(selector);
    },
  };

  const extraction = extractRecordsFromDocument(documentRef, {
    href: 'https://mychart.example.org/mychart/app/visits/note?csn=abc&hnoID=neurology',
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.records[0].recordType, 'visit-note');
  assert.equal(extraction.records[0].date, 'Jun 8, 2026');
  assert.equal(extraction.records[0].title, 'Consulting Provider Notes by Example Clinician, MD at 6/8/2026 4:15 PM');
  assert.notEqual(extraction.records[0].date, '8/48/15');
});

test('extractRecordsFromDocument removes assistant and footer labels from visit notes', () => {
  const noteText = [
    'Virtual Office Visit - Apr 09, 2026',
    'with Nurse Morgan B, RN at Example Clinic',
    'Notes from Care Team',
    'Progress Notes by Nurse Morgan B, RN at 04/09/26 0930',
    'Demo Patient',
    '01/01/1990',
    '04/09/26',
    'RN TELEPHONIC VISIT FOR BP CHECK',
    'ASSESSMENT:',
    'SUBJECTIVE:',
    'Headache: C/O H/A Monday and yesterday.',
    'OBJECTIVE:',
    'Vitals: BP',
    'PLAN:',
    'Reviewed with Dr. Example.',
    'Morgan Clinician, BSN/RN',
    '04/09/26 9:26 AM PDT',
  ].join('\n');
  const footerText = [
    'Interoperability Guide',
    'Terms and Conditions',
    'Questions? Contact the MyChart Help Desk',
    "Hi Demo Patient! I'm Grace",
    'How can I help you?',
    'Schedule an appointment',
    'Pay my bill',
    'More options',
    'Grace',
  ].join('\n');
  const main = makeElement({
    innerText: `${noteText}\n${footerText}`,
  });
  const documentRef = {
    title: 'MyChart - Past Visit Details',
    body: { innerText: `${noteText}\n${footerText}` },
    querySelector(selector) {
      return selector.includes('main') ? main : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('h1') || selector.includes('[role="main"]')) return [];
      return main.querySelectorAll(selector);
    },
  };

  const extraction = extractRecordsFromDocument(documentRef, {
    href: 'https://mychart.example.org/mychart/app/visits/past-details?csn=abc&pageMode=notesfirst',
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.records[0].recordType, 'visit-note');
  assert.match(extraction.records[0].rawText, /RN TELEPHONIC VISIT FOR BP CHECK/);
  assert.doesNotMatch(extraction.records[0].rawText, /Pay my bill|More options|How can I help you|Interoperability Guide/i);
});

test('extractRecordsFromDocument strips collapsed MyChart menu prefix from visit notes', () => {
  const collapsedText = [
    'Your Menu Search the menu Clear search field Main menu Find Care Schedule an Appointment',
    'Communication Messages Send A Message My Record COVID-19 To Do Medications & Rx Refill',
    'Settings Personal Information Account Settings Back to the Home Page Currently accessing your record',
    'Switch patients or choose from other account options Change language\nNotes from Care Team',
    'Progress Notes Updated Mar 26, 2026 Progress Notes by Demo Clinician, MD at 03/26/26 0930',
    'Example Health Antepartum Admission Note',
    'Assessment and Plan G1P0 admitted for monitoring.',
    'History of Present Illness: Patient states symptoms are improved.',
    'Physical Exam Vital signs stable.',
    'Plan: Continue follow-up instructions.',
  ].join(' ');
  const main = makeElement({ innerText: collapsedText });
  const documentRef = {
    title: 'MyChart - Note from Care Team',
    body: { innerText: collapsedText },
    documentElement: { innerText: collapsedText },
    querySelector(selector) {
      return selector.includes('main') ? main : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('h1') || selector.includes('[role="main"]')) return [];
      return main.querySelectorAll(selector);
    },
  };

  const extraction = extractRecordsFromDocument(documentRef, {
    href: 'https://mychart.example.org/mychart/app/visits/note?csn=abc',
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.records[0].recordType, 'visit-note');
  assert.doesNotMatch(extraction.records[0].rawText, /Your Menu|Search the menu|Switch patients/i);
  assert.match(extraction.records[0].rawText, /^Notes from Care Team\nProgress Notes Updated/m);
  assert.match(extraction.records[0].rawText, /\nAssessment and Plan /);
  assert.match(extraction.records[0].rawText, /\nHistory of Present Illness:/);
});

test('extractRecordsFromDocument captures NICU plan of care notes as visit notes', () => {
  const text = [
    "Demo Child's Menu Search the menu Clear search field Main menu",
    'Plan of Care by Nurse B, RN at 05/03/26 1955',
    'Vital signs are stable on room air.',
    'Infant remains sleepy but comfortable.',
    'Mother and father visited and ask appropriate questions.',
  ].join(' ');
  const main = makeElement({ innerText: text });
  const documentRef = {
    title: 'MyChart - Note from Care Team',
    body: { innerText: text },
    documentElement: { innerText: text },
    querySelector(selector) {
      return selector.includes('main') ? main : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('h1') || selector.includes('[role="main"]')) return [];
      return main.querySelectorAll(selector);
    },
  };

  const extraction = extractRecordsFromDocument(documentRef, {
    href: 'https://mychart.example.org/mychart/app/visits/note?csn=baby',
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.records[0].recordType, 'visit-note');
  assert.doesNotMatch(extraction.records[0].rawText, /Search the menu|Clear search field|Main menu/i);
  assert.match(extraction.records[0].rawText, /^Plan of Care by Nurse B/);
  assert.match(extraction.records[0].rawText, /Vital signs are stable on room air/);
});

test('extractRecordsFromDocument prefers open shadow report text over script-heavy textContent', () => {
  const textNode = (value) => ({ nodeType: 3, nodeValue: value });
  const elementNode = ({ tagName = 'DIV', innerText = '', textContent = '', childNodes = [], shadowRoot = null } = {}) => ({
    nodeType: 1,
    tagName,
    innerText,
    textContent,
    childNodes,
    children: [],
    shadowRoot,
    getAttribute() {
      return '';
    },
    querySelectorAll() {
      return [];
    },
  });
  const shadowNote = [
    'Lactation Note by Nurse Dana S, RN at 05/08/26 1452',
    'Lactation consult follow up:',
    'Gestational Age: 33w2d, DOL: 39 days, Post Menstrual Age: 38.9 weeks.',
    'Reason for consult: Transferred from Issaquah for higher level of care',
    'Maternal Hx: GDM diet controlled, PPH, thrombocytopenia, preeclampsia',
    'Lactation note: Met with parents at bedside to introduce lactation services.',
    'Parents shared feeding goals and the care team reviewed pumping suppression and formula transition options.',
    'Parents know they can have lactation paged for questions or concerns.',
    'This plan was communicated to lactation staff for continuity during the admission.',
  ].join('\n');
  const shadowRoot = { nodeType: 11, childNodes: [textNode(shadowNote)] };
  const reportWrapper = elementNode({ shadowRoot });
  const main = elementNode({
    tagName: 'MAIN',
    innerText: [
      "Demo Child's Menu Search the menu Clear search field Main menu",
      'Find Care Communication My Record Billing Sharing Settings',
      'Notes from Care Team Lactation Note Signed May 8, 2026',
      'Lactation Note by Nurse Dana S, RN at 05/08/26 1452',
      'Reason for consult: Transferred from Issaquah for higher level of care',
    ].join(' '),
    textContent: 'Notes from Care Team Lactation Note(Demo Child) Signed May 8, 2026',
    childNodes: [reportWrapper],
  });
  const documentRef = {
    nodeType: 9,
    title: 'MyChart - Note from Care Team',
    body: { innerText: main.innerText, textContent: main.textContent },
    documentElement: {
      innerText: main.innerText,
      textContent: "if (path.includes('visit')) return 'visits'; procedure notes by authorizing provider signed",
    },
    childNodes: [main],
    querySelector(selector) {
      return selector.includes('main') ? main : null;
    },
    querySelectorAll() {
      return [];
    },
  };

  const extraction = extractRecordsFromDocument(documentRef, {
    href: 'https://mychart.example.org/mychart/app/visits/note?csn=lactation',
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 1);
  assert.equal(extraction.records[0].recordType, 'visit-note');
  assert.equal(extraction.records[0].title, 'Lactation Note by Nurse Dana S, RN at 05/08/26 1452');
  assert.match(extraction.records[0].rawText, /^Lactation Note by Nurse Dana S/);
  assert.match(extraction.records[0].rawText, /Reason for consult: Transferred/);
  assert.doesNotMatch(extraction.records[0].rawText, /Search the menu|Main menu|Find Care/);
  assert.doesNotMatch(extraction.records[0].rawText, /path\.includes/);
});

test('extractRecordsFromDocument skips low-value MyChart home dashboard cards', () => {
  const main = makeElement({
    innerText: [
      'Welcome, Demo Patient!',
      'New Patient Clinic Visit on Friday May 08, 2026. Arrive at 10:20 AM PDT with Example Provider, MD at Example Health Primary Care Klahanie.',
      'Amount due of $61.43 for guarantor #00000000 at Example Health Health Services physicians services.',
      'Hepatitis B vaccine is overdue.',
    ].join('\n'),
    children: [
      makeElement({
        innerText: 'New Patient Clinic Visit on Friday May 08, 2026. Arrive at 10:20 AM PDT with Example Provider, MD at Example Health Primary Care Klahanie.',
      }),
      makeElement({
        innerText: 'Amount due of $61.43 for guarantor #00000000 at Example Health Health Services physicians services.',
      }),
      makeElement({
        innerText: 'Hepatitis B vaccine is overdue.',
      }),
    ],
  });
  const documentRef = {
    title: 'MyChart - Home',
    body: { innerText: "Welcome, Demo Patient!\nHi Demo Patient! I'm Grace" },
    querySelector(selector) {
      return selector.includes('main') ? main : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('h1') || selector.includes('[role="main"]')) return [];
      return main.querySelectorAll(selector);
    },
  };

  const extraction = extractRecordsFromDocument(documentRef, {
    href: 'https://mychart.example.org/mychart/Home',
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 0);
});

test('extractRecordsFromDocument skips standalone vaccine due reminders outside home dashboard', () => {
  const main = makeElement({
    innerText: 'Hepatitis B vaccine is overdue.',
    children: [
      makeElement({
        innerText: 'Hepatitis B vaccine is overdue.',
      }),
    ],
  });
  const documentRef = {
    title: 'MyChart - Health Summary',
    body: { innerText: 'Hepatitis B vaccine is overdue.' },
    querySelector(selector) {
      return selector.includes('main') ? main : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('h1') || selector.includes('[role="main"]')) return [];
      return main.querySelectorAll(selector);
    },
  };

  const extraction = extractRecordsFromDocument(documentRef, {
    href: 'https://mychart.example.org/mychart/HealthSummary',
    origin: 'https://mychart.example.org',
  });

  assert.equal(extraction.records.length, 0);
});

test('extractMyChartRecordsFromText rejects visit note shells without clinical text', () => {
  const records = extractMyChartRecordsFromText(`
    Notes from Care Team
    Telephone Encounter
    Signed Mar 31, 2026
  `, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/app/visits/note?csn=abc',
  });

  assert.equal(records.length, 0);
});

test('extractMyChartRecordsFromText rejects MyChart no-js visit shells', () => {
  const records = extractMyChartRecordsFromText(`
    MyChart - Past Visit Details
    <meta http-equiv="refresh" content="0;url=/mychart/nojs.asp" />
    if (self === top) var InitialBodyClass = document.getElementById("initialBodyClass");
    :root {
      --cnp-primary-main: #00338E;
      --primary-dark: #002363;
    }
    After Visit Summary
    Patient: Demo Patient
    Date: 4/13/2026
    Clinical Notes
    Signed by Nurse A
    Notes from Care Team
    Telephone Encounter
    Signed Apr 13, 2026
  `, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/app/visits/past-details?csn=abc&pageMode=notesfirst',
  });

  assert.equal(records.length, 0);
});

test('extractMyChartRecordsFromText rejects MyChart visit note app-shell script dumps', () => {
  const scriptDump = Array.from({ length: 90 }, (_, index) => ([
    `EpicPx.ReactContext.platform.bundle${index} = "visit-notes"`,
    `EpicPx.ReactContext.system.licensedFeatures.push("Instructions${index}")`,
    `--primary-main: #00338E;`,
  ].join('\n'))).join('\n');
  const records = extractMyChartRecordsFromText(`
    MyChart - Note from Care Team
    if (self === top)
    else
    top.location = "/mychart/Home/LogOut";
    :root {
      --primary-main: #00338E;
    }
    ${scriptDump}
    Instructions
    Assessment and Plan
    Office Visit - April 30, 2026
    with Demo Clinician, MD at Demo Clinic
    Notes from Care Team
    Interoperability Guide
    Terms and Conditions
  `, {
    category: 'visits',
    sourceUrl: 'https://mychart.example.org/mychart/app/visits/note?csn=abc',
    extractedAt: '2026-04-30T12:00:00.000Z',
  });

  assert.equal(records.length, 0);
});

test('extractMyChartRecordsFromText keeps same-account patients separate', () => {
  const text = `
    Complete Blood Count
    Apr 22, 2026
    Final result
    WBC 5.1 K/uL
  `;

  const parentRecords = extractMyChartRecordsFromText(text, {
    category: 'test-results',
    sourceUrl: 'https://mychart.example.org/mychart/app/test-results',
    patient: { name: 'Demo Adult', label: 'Demo Adult' },
  });
  const babyRecords = extractMyChartRecordsFromText(text, {
    category: 'test-results',
    sourceUrl: 'https://mychart.example.org/mychart/app/test-results',
    patient: { name: 'Demo Child', label: 'Demo Child' },
  });

  assert.equal(parentRecords[0].patient.name, 'Demo Adult');
  assert.equal(babyRecords[0].patient.name, 'Demo Child');
  assert.notEqual(parentRecords[0].id, babyRecords[0].id);
});

test('extractMyChartRecordsFromText trims navigation and legal boilerplate', () => {
  const records = extractMyChartRecordsFromText(`
    Menu
    Search
    Messaging
    Test Results
    Terms and Conditions
    Non-discrimination

    Comprehensive Metabolic Panel
    Apr 24, 2026
    Final result
    Sodium 140 mmol/L
    Potassium 4.0 mmol/L

    Download
    Print
    Back to top
  `, {
    category: 'test-results',
    sourceUrl: 'https://mychart.example.org/mychart/app/test-results',
  });

  assert.equal(records.length, 1);
  assert.match(records[0].rawText, /Comprehensive Metabolic Panel/);
  assert.doesNotMatch(records[0].rawText, /Terms and Conditions|Non-discrimination|Back to top/);
});

test('collectMeaningfulLinks ignores MyChart shell print and hash links', () => {
  const printLink = makeLink({
    innerText: 'Print this page in a printer-friendly format',
    href: 'https://mychart.example.org/mychart/Visits#',
  });
  const highContrastLink = makeLink({
    innerText: 'High Contrast Theme',
    href: 'https://mychart.example.org/mychart/Visits#',
  });
  const noteLink = makeLink({
    innerText: 'View clinical notes',
    href: 'https://mychart.example.org/mychart/app/visits/past-details?csn=abc&pageMode=notesfirst',
  });
  const documentRef = {
    querySelectorAll() {
      return [printLink, highContrastLink, noteLink];
    },
  };

  const links = collectMeaningfulLinks(documentRef, {
    href: 'https://mychart.example.org/mychart/Visits',
    origin: 'https://mychart.example.org',
  });

  assert.deepEqual(links, [{
    text: 'View clinical notes',
    href: 'https://mychart.example.org/mychart/app/visits/past-details?csn=abc&pageMode=notesfirst',
  }]);
});

test('createIndexCard excludes raw record bodies from lightweight context', () => {
  const card = createIndexCard({
    id: 'abc',
    category: 'test-results',
    title: 'Complete Blood Count',
    date: 'Apr 22, 2026',
    summary: 'Final result WBC 5.1 K/uL',
    rawText: 'very long full body',
    sourceUrl: 'https://example.test',
    extractedAt: '2026-04-27T00:00:00.000Z',
  });

  assert.deepEqual(Object.keys(card).sort(), [
    'category',
    'date',
    'extractedAt',
    'id',
    'patient',
    'recordType',
    'snippet',
    'sourceUrl',
    'title',
  ]);
  assert.equal(card.snippet, 'Final result WBC 5.1 K/uL');
});

test('getDeepSyncTargets prioritizes test results and visit notes', () => {
  const targets = getDeepSyncTargets('https://mychart.example.org/mychart/Home');

  assert.deepEqual(targets.map((target) => target.category), [
    'test-results',
    'imaging',
    'visits',
    'medications',
    'letters',
    'health-summary',
  ]);
  assert.equal(targets[0].url, 'https://mychart.example.org/mychart/app/test-results');
  assert.equal(targets[1].url, 'https://mychart.example.org/mychart/app/test-results?category=imaging');
  assert.equal(targets[2].url, 'https://mychart.example.org/mychart/Visits');
});

test('getDeepSyncTargets includes proxy switch links for baby chart contexts', () => {
  const documentRef = makeElement({
    children: [
      makeLink({
        innerText: 'View hospital stay',
        href: 'https://mychart.example.org/mychart/inside.asp?mode=proxyswitch&action=switchcontext&redirecturl=MyChartNow/Home&eid=proxy',
      }),
      makeLink({
        innerText: 'View results',
        href: 'https://mychart.example.org/mychart/inside.asp?mode=proxyswitch&action=switchcontext&redirecturl=TestResults/Detail&paramName1=orderId&paramVal1=abc&eid=proxy',
      }),
      makeLink({
        innerText: 'View all (2)',
        href: 'https://mychart.example.org/mychart/inside.asp?mode=proxyswitch&action=switchcontext&redirecturl=Clinical/TestResults&eid=proxy',
      }),
      makeLink({
        innerText: 'View all (2)',
        href: 'https://mychart.example.org/mychart/inside.asp?mode=proxyswitch&action=switchcontext&redirecturl=Visits&eid=proxy',
      }),
    ],
  });

  const targets = getDeepSyncTargets('https://mychart.example.org/mychart/Home', documentRef);
  assert.equal(targets[0].category, 'visits');
  assert.match(targets[0].url, /redirecturl=MyChartNow%2FHome|redirecturl=MyChartNow\/Home/);
  assert.equal(targets[1].category, 'test-results');
  assert.match(targets[1].url, /redirecturl=TestResults%2FDetail|redirecturl=TestResults\/Detail/);
  assert.equal(targets[2].category, 'test-results');
  assert.equal(targets[3].category, 'visits');
  assert.ok(targets.some((target) => target.category === 'imaging'));
  assert.equal(targets.at(-1).url, 'https://mychart.example.org/mychart/HealthSummary');
});

test('getDeepSyncTargets never emits null-origin MyChart URLs', () => {
  const targets = getDeepSyncTargets('about:blank');

  assert.equal(targets[2].url, 'https://mychart.example.org/mychart/Visits');
  assert.doesNotMatch(targets.map((target) => target.url).join('\n'), /^null\/mychart/m);
});

test('inferRecordTypeFromText separates visit notes from visit summaries', () => {
  assert.equal(inferRecordTypeFromText('Clinical Notes\nAssessment and Plan', 'visits'), 'visit-note');
  assert.equal(inferRecordTypeFromText('After Visit Summary\nInstructions', 'visits'), 'visit-note');
  assert.equal(inferRecordTypeFromText('Office Visit\nMay 1, 2026', 'visits'), 'visit');
  assert.equal(inferRecordTypeFromText('Comprehensive Metabolic Panel\nFinal result', 'test-results'), 'test-result');
});
