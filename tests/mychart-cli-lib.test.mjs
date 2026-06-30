import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertFreshDeepSync,
  buildRecordsAgentJsonlExport,
  buildRecordsMarkdownExport,
  exportLatestDay,
  exportRecordsMarkdown,
  filterRecordCards,
  inspectMyChartLoginState,
  getMyChartCredentialsFromEnv,
  getLatestClinicalDateFromCards,
  getRecentClinicalDateRange,
  isTransientBrowserFrameError,
  loadEnvironmentFile,
  normalizeClinicalDateForRange,
  openMyChartAccessLoginIfNeeded,
  switchMyChartProxyContext,
  syncRecords,
  waitForMyChartCredentialFields,
} from '../scripts/mychart-cli-lib.mjs';

test('getRecentClinicalDateRange creates an inclusive recent clinical window', () => {
  assert.deepEqual(
    getRecentClinicalDateRange({
      days: 3,
      now: new Date('2026-05-25T10:00:00'),
    }),
    {
      startDate: '2026-05-23',
      endDate: '2026-05-25',
    },
  );
});

test('getMyChartCredentialsFromEnv reads primary names and reports missing values', () => {
  assert.deepEqual(
    getMyChartCredentialsFromEnv({
      AWESOME_MYCHART_USERNAME: 'account@example.test',
      AWESOME_MYCHART_PASSWORD: 'secret',
    }),
    {
      username: 'account@example.test',
      password: 'secret',
      available: true,
      missing: [],
    },
  );

  const missing = getMyChartCredentialsFromEnv({
    MYCHART_USERNAME: 'account@example.test',
  });
  assert.equal(missing.available, false);
  assert.deepEqual(missing.missing, ['AWESOME_MYCHART_PASSWORD or MYCHART_PASSWORD']);
});

test('getMyChartCredentialsFromEnv prefers alternate portal credentials for Example Health MyChart URLs', () => {
  assert.deepEqual(
    getMyChartCredentialsFromEnv({
      AWESOME_MYCHART_USERNAME: 'seattle@example.test',
      AWESOME_MYCHART_PASSWORD: 's1',
      PROVIDENCE_MYCHART_USERNAME: 'swedish@example.test',
      PROVIDENCE_MYCHART_PASSWORD: 'a1',
    }, {
      mychartUrl: 'https://patientportal.spi.example.test/mychart/Home',
    }),
    {
      username: 'swedish@example.test',
      password: 'a1',
      available: true,
      missing: [],
    },
  );
});

test('getLatestClinicalDateFromCards returns the newest dated card', () => {
  assert.equal(
    getLatestClinicalDateFromCards([
      { date: '05/26/26' },
      { date: '2026-05-25T10:15:00' },
      { title: 'undated' },
      { recordDate: '2026-05-24' },
    ]),
    '2026-05-26',
  );
  assert.equal(getLatestClinicalDateFromCards([{ title: 'undated' }]), '');
});

test('getLatestClinicalDateFromCards ignores future-dated records by default', () => {
  const cards = [
    { date: '2026-06-29' },
    { date: '2026-06-11' },
    { date: '2026-06-10' },
  ];

  assert.equal(
    getLatestClinicalDateFromCards(cards, {
      now: new Date('2026-06-11T12:00:00'),
    }),
    '2026-06-11',
  );
  assert.equal(
    getLatestClinicalDateFromCards(cards, {
      includeFuture: true,
      now: new Date('2026-06-11T12:00:00'),
    }),
    '2026-06-29',
  );
});

test('normalizeClinicalDateForRange converts MyChart display dates to ISO dates', () => {
  assert.equal(normalizeClinicalDateForRange('05/08/26'), '2026-05-08');
  assert.equal(normalizeClinicalDateForRange('5/8/2026 3:15 PM'), '2026-05-08');
  assert.equal(normalizeClinicalDateForRange('May 24, 2026'), '2026-05-24');
  assert.equal(normalizeClinicalDateForRange('2026-05-25T10:15:00'), '2026-05-25');
  assert.equal(normalizeClinicalDateForRange('13/08/26'), '');
  assert.equal(normalizeClinicalDateForRange('not a date'), '');
});

test('assertFreshDeepSync rejects missing or stale sync metadata', () => {
  assert.deepEqual(
    assertFreshDeepSync({
      syncMetadata: { lastDeepSyncAt: '2026-05-25T17:00:00.000Z' },
      maxAgeMinutes: 90,
      now: new Date('2026-05-25T18:00:00.000Z'),
    }),
    {
      lastDeepSyncAt: '2026-05-25T17:00:00.000Z',
      ageMinutes: 60,
      maxAgeMinutes: 90,
    },
  );
  assert.throws(
    () => assertFreshDeepSync({
      syncMetadata: { lastDeepSyncAt: '2026-05-25T10:00:00.000Z' },
      maxAgeMinutes: 60,
      now: new Date('2026-05-25T18:00:00.000Z'),
    }),
    /stale/,
  );
  assert.throws(() => assertFreshDeepSync({ syncMetadata: {} }), /No previous/);
});

test('isTransientBrowserFrameError detects retryable browser frame failures', () => {
  assert.equal(isTransientBrowserFrameError(new Error("Attempted to use detached Frame 'abc'.")), true);
  assert.equal(isTransientBrowserFrameError(new Error('ordinary validation failure')), false);
});

test('loadEnvironmentFile loads local .env values without overriding env', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'awesome-mychart-env-'));
  const envPath = path.join(dir, '.env');
  await writeFile(envPath, [
    '# ignored',
    'AWESOME_MYCHART_USERNAME=account@example.test',
    'AWESOME_MYCHART_PASSWORD="secret"',
    'EXISTING=from-file',
  ].join('\n'));
  const env = { EXISTING: 'from-env' };

  const result = await loadEnvironmentFile({ envPath, env });

  assert.equal(result.loaded, true);
  assert.equal(env.AWESOME_MYCHART_USERNAME, 'account@example.test');
  assert.equal(env.AWESOME_MYCHART_PASSWORD, 'secret');
  assert.equal(env.EXISTING, 'from-env');
});

test('inspectMyChartLoginState does not treat postloginurl=Home as logged in', async () => {
  const page = {
    evaluate(fn) {
      const previous = {
        location: globalThis.location,
        document: globalThis.document,
        getComputedStyle: globalThis.getComputedStyle,
      };
      try {
        globalThis.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
        globalThis.location = {
          href: 'https://example.test/mychart/Authentication/Login?postloginurl=Home',
          pathname: '/mychart/Authentication/Login',
        };
        globalThis.document = {
          body: { innerText: 'Username Password Sign In' },
          querySelector(selector) {
            return selector === 'input[type="password"]' ? { type: 'password' } : null;
          },
          querySelectorAll(selector) {
            if (selector === 'input') {
              return [{
                type: 'password',
                disabled: false,
                readOnly: false,
                id: '',
                name: '',
                autocomplete: '',
                placeholder: '',
                getAttribute() {
                  return '';
                },
                getBoundingClientRect() {
                  return { width: 120, height: 32 };
                },
              }];
            }
            return [];
          },
        };
        return fn();
      } finally {
        globalThis.location = previous.location;
        globalThis.document = previous.document;
        globalThis.getComputedStyle = previous.getComputedStyle;
      }
    },
  };

  const state = await inspectMyChartLoginState(page);

  assert.equal(state.loggedIn, false);
  assert.equal(state.loginVisible, true);
});

test('waitForMyChartCredentialFields waits until SSO credential fields are visible', async () => {
  let calls = 0;
  const page = {
    url() {
      return 'https://patientportal.example.test/login';
    },
    async evaluate(fn) {
      calls += 1;
      const hasFields = calls >= 3;
      const previous = {
        location: globalThis.location,
        document: globalThis.document,
        getComputedStyle: globalThis.getComputedStyle,
      };
      try {
        globalThis.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
        globalThis.location = {
          href: 'https://patientportal.example.test/login',
          pathname: '/login',
        };
        const input = (overrides = {}) => ({
          disabled: false,
          readOnly: false,
          id: '',
          name: '',
          autocomplete: '',
          placeholder: '',
          labels: [],
          getAttribute() {
            return '';
          },
          getBoundingClientRect() {
            return { width: 120, height: 32 };
          },
          ...overrides,
        });
        globalThis.document = {
          body: { innerText: hasFields ? 'Your username Password SIGN IN' : 'Welcome loading' },
          querySelector(selector) {
            return selector === 'input[type="password"]' && hasFields
              ? input({ type: 'password', id: 'userSecretInput', placeholder: 'Password' })
              : null;
          },
          querySelectorAll(selector) {
            if (selector !== 'input' || !hasFields) return [];
            return [
              input({ type: 'text', id: 'signInName', autocomplete: 'username', placeholder: 'Your username' }),
              input({ type: 'password', id: 'userSecretInput', autocomplete: 'current-password', placeholder: 'Password' }),
            ];
          },
        };
        return fn();
      } finally {
        globalThis.location = previous.location;
        globalThis.document = previous.document;
        globalThis.getComputedStyle = previous.getComputedStyle;
      }
    },
  };

  const state = await waitForMyChartCredentialFields(page, {
    timeoutSeconds: 2,
    pollIntervalMs: 1,
  });

  assert.equal(state.hasCredentialFields, true);
  assert.equal(calls, 3);
});

test('openMyChartAccessLoginIfNeeded follows the Access MyChart link', async () => {
  let navigatedTo = '';
  const page = {
    async waitForNavigation() {},
    evaluate(fn) {
      const previous = {
        document: globalThis.document,
        location: globalThis.location,
        getComputedStyle: globalThis.getComputedStyle,
      };
      try {
        globalThis.location = {
          href: 'https://mychart.example.test/Login',
          set href(value) {
            navigatedTo = value;
          },
        };
        globalThis.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
        globalThis.document = {
          querySelector(selector) {
            if (selector === 'input[type="password"]') return null;
            return null;
          },
          querySelectorAll(selector) {
            if (selector === 'a, button, [role="button"]') {
              return [{
                innerText: 'Access MyChart',
                href: 'https://patientportal.example.test/saml-to-oidc',
                getAttribute() {
                  return '';
                },
                getBoundingClientRect() {
                  return { width: 120, height: 32 };
                },
              }];
            }
            return [];
          },
        };
        return fn();
      } finally {
        globalThis.document = previous.document;
        globalThis.location = previous.location;
        globalThis.getComputedStyle = previous.getComputedStyle;
      }
    },
  };

  const result = await openMyChartAccessLoginIfNeeded(page);

  assert.equal(result.opened, true);
  assert.equal(navigatedTo, 'https://patientportal.example.test/saml-to-oidc');
});

test('switchMyChartProxyContext follows a matching proxy switch link', async () => {
  let navigatedTo = '';
  const page = {
    url() {
      return navigatedTo || 'https://example.test/mychart/Home';
    },
    setDefaultTimeout() {},
    async waitForNavigation() {},
    async evaluate(fn, patient) {
      const previous = {
        document: globalThis.document,
        location: globalThis.location,
      };
      try {
        globalThis.location = {
          href: 'https://example.test/mychart/Home',
          set href(value) {
            navigatedTo = value;
          },
        };
        globalThis.document = {
          querySelectorAll(selector) {
            if (selector.includes('a, button')) {
              return [
                {
                  innerText: 'Demo Parent',
                  className: navigatedTo ? 'proxySubjectLink' : 'proxySubjectLink currentContext',
                  href: 'https://example.test/mychart/Home',
                  getAttribute() {
                    return '';
                  },
                },
                {
                  innerText: 'Demo Child',
                  className: navigatedTo ? 'proxySubjectLink currentContext' : 'proxySubjectLink',
                  href: 'https://example.test/mychart/Authentication/Login?mode=proxyswitch&proxy=boy',
                  getAttribute() {
                    return '';
                  },
                },
              ];
            }
            return [];
          },
        };
        return fn(patient);
      } finally {
        globalThis.document = previous.document;
        globalThis.location = previous.location;
      }
    },
  };
  const browser = {
    async pages() {
      return [page];
    },
  };

  const result = await switchMyChartProxyContext(browser, { patient: 'Demo Child' });

  assert.equal(result.status, 'switched');
  assert.equal(result.text, 'Demo Child');
  assert.equal(navigatedTo, 'https://example.test/mychart/Authentication/Login?mode=proxyswitch&proxy=boy');
});

test('switchMyChartProxyContext detects an already-current patient context', async () => {
  const page = {
    url() {
      return 'https://example.test/mychart/Home';
    },
    setDefaultTimeout() {},
    async evaluate(fn, patient) {
      const previous = { document: globalThis.document };
      try {
        globalThis.document = {
          querySelectorAll(selector) {
            if (selector.includes('a, button')) {
              return [{
                innerText: 'Demo Child',
                className: 'proxySubjectLink currentContext',
                href: 'https://example.test/mychart/Home',
                getAttribute() {
                  return '';
                },
              }];
            }
            return [];
          },
        };
        return fn(patient);
      } finally {
        globalThis.document = previous.document;
      }
    },
  };
  const browser = {
    async pages() {
      return [page];
    },
  };

  const result = await switchMyChartProxyContext(browser, { patient: 'Demo Child' });

  assert.equal(result.status, 'already_current');
  assert.equal(result.text, 'Demo Child');
});

test('agent export helpers filter records and preserve dashboard Markdown format', () => {
  const patient = { key: 'demo-child', label: 'Demo Child' };
  const otherPatient = { key: 'other', label: 'Other Patient' };
  const cards = [
    {
      id: 'recent-lab',
      patient,
      category: 'test-results',
      recordType: 'test-result',
      title: 'CMP',
      date: '2026-05-24',
      snippet: 'ALT high',
    },
    {
      id: 'old-note',
      patient,
      category: 'visits',
      recordType: 'visit-note',
      title: 'Progress Note',
      date: '2026-05-20',
      snippet: 'Old note',
    },
    {
      id: 'other-lab',
      patient: otherPatient,
      category: 'test-results',
      recordType: 'test-result',
      title: 'Other CMP',
      date: '2026-05-24',
      snippet: 'Other result',
    },
  ];
  const records = [
    {
      id: 'recent-lab',
      category: 'test-results',
      rawText: 'ALT\nYour value is 113 U/L',
    },
    {
      id: 'old-note',
      category: 'visits',
      clinicalText: 'Assessment and Plan\nOlder note.',
    },
    {
      id: 'other-lab',
      category: 'test-results',
      rawText: 'Other result',
    },
  ];

  const filtered = filterRecordCards({
    cards,
    records,
    patient: 'Demo Child',
    patientLabelExact: 'Demo Child',
    category: 'test-results',
  });
  const exportDownload = buildRecordsMarkdownExport({
    cards: filtered.cards,
    records: filtered.recordsById,
    startDate: '2026-05-23',
    endDate: '2026-05-25',
    filters: {
      patientLabel: 'Demo Child',
      category: 'test-results',
      startDate: '2026-05-23',
      endDate: '2026-05-25',
    },
    generatedAt: '2026-05-25T18:30:00.000Z',
  });

  assert.deepEqual(filtered.cards.map((card) => card.id), ['recent-lab']);
  assert.equal(exportDownload.exportedCards.length, 1);
  assert.match(exportDownload.content, /# mychart-cli Records Export/);
  assert.match(exportDownload.content, /ALT\nYour value is 113 U\/L/);
  assert.doesNotMatch(exportDownload.content, /Other CMP/);
  assert.doesNotMatch(exportDownload.content, /Progress Note/);
});

test('exportLatestDay filters exact patient and categories before building Markdown', () => {
  const patient = { key: 'demo-child', label: 'Demo Child' };
  const cards = [
    {
      id: 'visit-1',
      patient,
      category: 'visits',
      recordType: 'visit-note',
      title: 'Progress Notes',
      date: '2026-05-28',
      snippet: 'Respiratory support unchanged.',
      sourceUrl: 'https://example.test/visit',
    },
    {
      id: 'lab-1',
      patient,
      category: 'test-results',
      recordType: 'test-result',
      title: 'CBC W/DIFFERENTIAL',
      date: 'May 28, 2026',
      snippet: 'White Blood Cells high',
      sourceUrl: 'https://example.test/lab',
    },
    {
      id: 'older-lab',
      patient,
      category: 'test-results',
      recordType: 'test-result',
      title: 'Older CBC',
      date: '2026-05-27',
      snippet: 'Older result',
      sourceUrl: 'https://example.test/old-lab',
    },
    {
      id: 'other',
      patient: { key: 'other', label: 'Other Patient' },
      category: 'test-results',
      recordType: 'test-result',
      title: 'Other CBC',
      date: '2026-05-28',
      snippet: 'Other result',
      sourceUrl: 'https://example.test/other',
    },
  ];
  const records = [
    {
      id: 'visit-1',
      category: 'visits',
      clinicalText: 'Respiratory support unchanged.',
      sourceUrl: 'https://example.test/visit',
    },
    {
      id: 'lab-1',
      category: 'test-results',
      rawText: [
        'CBC W/DIFFERENTIAL',
        'Collected on May 28, 2026 5:30 AM',
        'White Blood Cells',
        'Normal range: 3.4 - 10.8 K/uL',
        'Value 12.3High K/uL',
      ].join('\n'),
      sourceUrl: 'https://example.test/lab',
    },
    {
      id: 'older-lab',
      category: 'test-results',
      rawText: 'Older result',
      sourceUrl: 'https://example.test/old-lab',
    },
    {
      id: 'other',
      category: 'test-results',
      rawText: 'Other result',
      sourceUrl: 'https://example.test/other',
    },
  ];

  const exportDownload = exportLatestDay({
    cards,
    records,
    patientLabelExact: 'Demo Child',
    categories: ['visits', 'test-results'],
    generatedAt: '2026-05-28T12:00:00.000Z',
  });

  assert.equal(exportDownload.latestDate, '2026-05-28');
  assert.deepEqual(exportDownload.exportedCards.map((card) => card.id), ['lab-1', 'visit-1']);
  assert.match(exportDownload.content, /- Category: Test Results/);
  assert.match(exportDownload.content, /### Result Data/);
  assert.match(exportDownload.content, /White Blood Cells/);
  assert.doesNotMatch(exportDownload.content, /Other CBC|Older CBC/);
});

test('exportRecordsMarkdown delegates to date-range Markdown export', async () => {
  const exportDownload = await exportRecordsMarkdown({
    cards: [{ id: 'one', category: 'visits', title: 'Visit', date: '2026-05-28' }],
    records: [{ id: 'one', category: 'visits', rawText: 'Visit details' }],
    startDate: '2026-05-28',
    endDate: '2026-05-28',
    generatedAt: '2026-05-28T12:00:00.000Z',
  });

  assert.equal(exportDownload.exportedCards.length, 1);
  assert.match(exportDownload.content, /Visit details/);
});

test('buildRecordsAgentJsonlExport exposes filtered records as agent JSONL', () => {
  const patient = { key: 'baby', label: 'Demo Child' };
  const otherPatient = { key: 'other', label: 'Other Patient' };
  const cards = [
    {
      id: 'recent-lab',
      patient,
      category: 'test-results',
      recordType: 'test-result',
      title: 'ALT',
      date: '2026-05-24',
      snippet: 'ALT 113',
    },
    {
      id: 'old-note',
      patient,
      category: 'visits',
      recordType: 'visit-note',
      title: 'Progress Note',
      date: '2026-05-20',
      snippet: 'Old note',
    },
    {
      id: 'other-lab',
      patient: otherPatient,
      category: 'test-results',
      recordType: 'test-result',
      title: 'Other CMP',
      date: '2026-05-24',
      snippet: 'Other result',
    },
  ];
  const records = [
    { id: 'recent-lab', category: 'test-results', rawText: 'ALT\nYour value is 113 U/L' },
    { id: 'old-note', category: 'visits', clinicalText: 'Older note.' },
    { id: 'other-lab', category: 'test-results', rawText: 'Other result' },
  ];
  const filtered = filterRecordCards({
    cards,
    records,
    patientLabelExact: 'Demo Child',
    category: 'test-results',
  });

  const exportDownload = buildRecordsAgentJsonlExport({
    cards: filtered.cards,
    records: filtered.recordsById,
    startDate: '2026-05-23',
    endDate: '2026-05-25',
    generatedAt: '2026-05-25T18:30:00.000Z',
  });
  const lines = exportDownload.content.trim().split('\n').map((line) => JSON.parse(line));

  assert.equal(exportDownload.filename, 'mychart-cli-records-2026-05-23-to-2026-05-25-2026-05-25T18-30-00-000Z.jsonl');
  assert.deepEqual(lines.map((line) => line.type), ['manifest', 'record', 'chunk']);
  assert.equal(lines[1].recordId, 'recent-lab');
  assert.equal(lines[2].text, 'ALT\nYour value is 113 U/L');
});

test('syncRecords requires a Puppeteer browser or page', async () => {
  await assert.rejects(() => syncRecords({ categories: ['test-results'] }), /browser or page/);
});
