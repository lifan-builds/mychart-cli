import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import puppeteer from 'puppeteer-core';

import { collectPriorityDetailLinks } from '../core/deep-sync-links.js';
import {
  DEFAULT_LIVE_PROFILE_DIR,
  DEFAULT_STORE_PATH,
  DEFAULT_TIMEOUT_SECONDS,
} from '../core/paths.js';
import { JsonMedicalStore } from '../storage/json-store.js';
import { enrichExternalScanAttachments } from './document-attachments.js';

const require = createRequire(import.meta.url);
const { buildExtractorInjectionSource } = require('../extraction/extractor-core.js');

export async function readLiveHarnessSession({
  profileDir = DEFAULT_LIVE_PROFILE_DIR,
} = {}) {
  const sessionPath = path.join(profileDir, 'awesome-mychart-live-session.json');
  try {
    return JSON.parse(await readFile(sessionPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Could not read mychart-cli live harness session at ${sessionPath}. Start the harness with npm run init:live first. ${error.message}`,
    );
  }
}

export async function openBrowserSession({
  profileDir = DEFAULT_LIVE_PROFILE_DIR,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
} = {}) {
  const session = await readLiveHarnessSession({ profileDir });
  const browser = await puppeteer.connect({ browserURL: session.endpoint });
  const page = await findMyChartPage(browser, session);
  page.setDefaultTimeout(timeoutSeconds * 1000);
  return { browser, page, session };
}

export async function closeBrowserSession({ browser } = {}) {
  await browser?.disconnect();
}

export async function findMyChartPage(browser, session = {}) {
  const pages = await browser.pages();
  const mychart = pages.find((candidate) => /mychart/i.test(candidate.url()));
  if (mychart) return mychart;
  if (session.mychartUrl) {
    const page = await browser.newPage();
    await page.goto(session.mychartUrl, { waitUntil: 'domcontentloaded' });
    return page;
  }
  throw new Error('No MyChart page is available in the live harness.');
}

export async function activateAuthenticatedMyChartTab(browser, {
  session = {},
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
} = {}) {
  const pages = await browser.pages();
  const candidates = pages.filter((candidate) => /mychart/i.test(candidate.url()));
  if (!candidates.length && session.mychartUrl) {
    const page = await browser.newPage();
    page.setDefaultTimeout(timeoutSeconds * 1000);
    await page.goto(session.mychartUrl, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    return { status: 'opened', url: page.url() };
  }

  const inspected = [];
  for (const candidate of candidates) {
    candidate.setDefaultTimeout(timeoutSeconds * 1000);
    const state = await inspectMyChartLoginState(candidate).catch((error) => ({
      url: candidate.url(),
      loggedIn: false,
      loginVisible: false,
      needsMfa: false,
      error: error.message,
    }));
    inspected.push({ page: candidate, state });
  }

  const authenticated = inspected.find((item) => item.state.loggedIn)
    || inspected.find((item) => !/\/Authentication\/Login/i.test(item.page.url()));
  if (!authenticated) {
    throw new Error('No authenticated MyChart tab is available for sync.');
  }

  await authenticated.page.bringToFront();
  return {
    status: authenticated.state.loggedIn ? 'activated_authenticated' : 'activated_mychart',
    url: authenticated.page.url(),
    candidates: inspected.map((item) => ({
      url: item.page.url(),
      loggedIn: Boolean(item.state.loggedIn),
      loginVisible: Boolean(item.state.loginVisible),
      needsMfa: Boolean(item.state.needsMfa),
    })),
  };
}

export async function inspectMyChartLoginState(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText || '';
    const url = location.href;
    const path = location.pathname || '';
    const hasPasswordField = Boolean(document.querySelector('input[type="password"]'));
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const visibleInputs = [...document.querySelectorAll('input')]
      .filter((input) => !input.disabled && !input.readOnly && visible(input));
    const hasVisiblePasswordField = visibleInputs.some((input) => input.type === 'password');
    const hasVisibleUsernameField = visibleInputs.some((input) => {
      if (input.type === 'password') return false;
      const haystack = [
        input.id,
        input.name,
        input.autocomplete,
        input.placeholder,
        input.getAttribute('aria-label'),
        input.labels ? [...input.labels].map((label) => label.innerText).join(' ') : '',
      ].join(' ');
      return /(?:user|login|email|account|id)/i.test(haystack)
        || ['email', 'text'].includes(input.type || 'text');
    });
    const hasCredentialFields = hasVisibleUsernameField && hasVisiblePasswordField;
    const isLoginRoute = /Authentication\/Login/i.test(path);
    const loginVisible = Boolean(document.querySelector('input[type="password"]'))
      || isLoginRoute
      || /\b(?:username|email|password|sign in|log in)\b/i.test(text);
    const needsMfa = /\b(?:verification code|security code|two-step|two factor|2-step|2fa|multi-factor|authenticator|captcha)\b/i
      .test(text);
    const loggedIn = !isLoginRoute && !hasPasswordField && (/\/Home\b/i.test(path)
      || /\b(?:Visits|Test Results|Messages|Menu|Appointments|Health Summary)\b/i.test(text)
    );
    return { url, loginVisible, needsMfa, loggedIn, hasCredentialFields };
  });
}

export async function extractPage(page) {
  const source = buildExtractorInjectionSource();
  const extraction = await page.evaluate((extractorSource) => {
    if (!globalThis.MyChartExtractorCore) {
      Function(extractorSource)();
    }
    return globalThis.MyChartExtractorCore.extractRecordsFromDocument(document, location);
  }, source);
  if (extraction?.page?.category !== 'visits') return extraction;

  const noteHeader = await extractTopVisitNoteHeader(page).catch(() => '');
  const frameExtractions = await extractVisitFrames(page, {
    extractorSource: source,
    sourceUrl: extraction.page?.sourceUrl || page.url(),
    patient: extraction.page?.patient || null,
    noteHeader,
  });
  if (!frameExtractions.length && !noteHeader) return extraction;

  return mergeVisitFrameExtractions({
    extraction,
    frameExtractions,
    noteHeader,
  });
}

async function extractTopVisitNoteHeader(page) {
  return page.evaluate(() => {
    const lines = (document.body?.innerText || '')
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const start = lines.findIndex((line) => /^Notes from Care Team$/i.test(line));
    const headerLines = (start >= 0 ? lines.slice(start, start + 10) : lines.slice(0, 10))
      .filter((line) => (
        /^Notes from Care Team$/i.test(line)
        || /\b(?:Daily Progress Note|Consulting Provider Notes?|Progress Notes?|Provider Notes?|Procedure Notes?|Plan of Care|Lactation Note|History and Physical|H&P)\b/i.test(line)
        || /^Signed\s+/i.test(line)
        || /^Filed\s+/i.test(line)
      ));
    return headerLines.join('\n').trim();
  });
}

async function extractVisitFrames(page, {
  extractorSource,
  sourceUrl,
  patient,
  noteHeader = '',
} = {}) {
  const frames = page.frames().filter((frame) => frame !== page.mainFrame());
  const extractions = [];
  for (const frame of frames) {
    const result = await frame.evaluate((source, topSourceUrl, topPatient, topNoteHeader) => {
      if (!globalThis.MyChartExtractorCore) {
        Function(source)();
      }
      const collectDeepText = (rootNode) => {
        const pieces = [];
        const visit = (node) => {
          if (!node) return;
          if (node.nodeType === 3) {
            pieces.push(node.nodeValue || '');
            return;
          }
          if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
          if (node.nodeType === 1) {
            const tagName = String(node.tagName || '').toLowerCase();
            if (['script', 'style', 'noscript'].includes(tagName)) return;
            pieces.push(node.getAttribute?.('aria-label') || '');
            pieces.push(node.getAttribute?.('title') || '');
          }
          if (node.shadowRoot) visit(node.shadowRoot);
          [...(node.childNodes || [])].forEach(visit);
        };
        visit(rootNode);
        return pieces.join('\n');
      };
      const text = [
        topNoteHeader,
        document.querySelector('main, #main, [role="main"]')?.innerText,
        document.body?.innerText,
        document.documentElement?.innerText,
        collectDeepText(document),
      ].filter(Boolean).join('\n');
      const normalizedText = globalThis.MyChartExtractorCore.normalizeText(text);
      const records = globalThis.MyChartExtractorCore.extractMyChartRecordsFromText(normalizedText, {
        category: 'visits',
        sourceUrl: topSourceUrl || location.href,
        patient: topPatient,
      });
      return {
        frameUrl: location.href,
        textLength: normalizedText.length,
        records,
        indexCards: records.map(globalThis.MyChartExtractorCore.createIndexCard),
      };
    }, extractorSource, sourceUrl, patient, noteHeader).catch(() => null);
    if (result?.records?.length) extractions.push(result);
  }
  return extractions;
}

function extractSignedHeaderDate(header = '') {
  const match = String(header || '').match(/\bSigned\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4})\b/i);
  return match?.[1] || '';
}

function extractSignedHeaderTitle(header = '') {
  const lines = String(header || '')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const title = lines.find((line) => (
    /\b(?:Daily Progress Note|Consulting Provider Notes?|Progress Notes?|Provider Notes?|Procedure Notes?|Plan of Care|Lactation Note|History and Physical|H&P)\b/i.test(line)
    && !/^Notes from Care Team$/i.test(line)
  ));
  return String(title || '')
    .replace(/\(Demo Child\)\s*$/i, '')
    .trim();
}

function isGenericVisitNoteTitle(title = '') {
  return /^(?:Visit|Chief Complaint:?|Chief Complaint\/Reason for Admission|History of Present Illness:?|Hospital course in brief:?|,)/i
    .test(String(title || '').trim());
}

function replaceRecordIdDate(id = '', date = '') {
  if (!id || !date) return id;
  if (String(id).includes(':undated:')) return String(id).replace(':undated:', `:${date}:`);
  return String(id).replace(/(:visits:)[^:]+(:)/, `$1${date}$2`);
}

function createIndexCard(record) {
  return {
    id: record.id,
    category: record.category,
    recordType: record.recordType,
    title: record.title,
    date: record.date,
    snippet: record.summary || '',
    patient: record.patient || null,
    sourceUrl: record.sourceUrl,
    extractedAt: record.extractedAt,
  };
}

export function enrichVisitNoteFromHeader(record = {}, noteHeader = '') {
  const headerDate = extractSignedHeaderDate(noteHeader);
  const headerTitle = extractSignedHeaderTitle(noteHeader);
  if (record.recordType !== 'visit-note' || (!headerDate && !headerTitle)) return record;
  const shouldUseHeaderDate = Boolean(headerDate)
    && (!record.date || isGenericVisitNoteTitle(record.title));
  const shouldUseHeaderTitle = Boolean(headerTitle)
    && (!record.title || isGenericVisitNoteTitle(record.title));

  if (!shouldUseHeaderDate && !shouldUseHeaderTitle) return record;

  const nextDate = shouldUseHeaderDate ? headerDate : record.date;
  return {
    ...record,
    id: shouldUseHeaderDate ? replaceRecordIdDate(record.id, nextDate) : record.id,
    title: shouldUseHeaderTitle ? headerTitle : record.title,
    date: nextDate,
    rawText: [noteHeader, record.rawText].filter(Boolean).join('\n'),
  };
}

function scoreVisitNoteRecord(record = {}) {
  let score = String(record.rawText || '').length;
  if (record.date) score += 2500;
  if (/\bby\s+(?:Nurse|Dr\.?|Doctor|[A-Z][A-Za-z'.-]+)/i.test(record.title || '')) score += 2000;
  if (/\b(?:reason for consult|assessment and plan|history of present illness|hospital course)\b/i.test(record.rawText || '')) score += 1200;
  return score;
}

function mergeVisitFrameExtractions({ extraction, frameExtractions = [], noteHeader = '' } = {}) {
  const records = [
    ...(extraction.records || []),
    ...frameExtractions.flatMap((entry) => entry.records || []),
  ].map((record) => enrichVisitNoteFromHeader(record, noteHeader));
  const visitNotes = records.filter((record) => record.recordType === 'visit-note');
  const nonVisitNotes = records.filter((record) => record.recordType !== 'visit-note');
  const bestVisitNote = visitNotes.length > 1
    ? [...visitNotes].sort((a, b) => scoreVisitNoteRecord(b) - scoreVisitNoteRecord(a))[0]
    : visitNotes[0];
  const mergedRecords = [
    ...(bestVisitNote ? [bestVisitNote] : []),
    ...nonVisitNotes,
  ];
  const recordsById = new Map(mergedRecords.filter((record) => record.id).map((record) => [record.id, record]));
  const indexCards = [...recordsById.values()].map(createIndexCard);

  return {
    ...extraction,
    records: [...recordsById.values()],
    indexCards,
    count: recordsById.size,
    page: {
      ...extraction.page,
      debug: {
        ...(extraction.page?.debug || {}),
        frameRecordEvents: frameExtractions.length,
        topHeaderDate: extractSignedHeaderDate(noteHeader),
      },
    },
  };
}

async function gotoWithFallback(page, target) {
  const urls = [target.url, target.fallbackUrl].filter(Boolean);
  let lastError = null;
  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
      return url;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Could not navigate to ${target.url}`);
}

async function openVisitClinicalNotesIfPresent(page) {
  const clicked = await page.evaluate(() => {
    const candidate = [...document.querySelectorAll('a, button, [role="link"], [role="button"]')]
      .find((element) => /view clinical notes/i.test(
        element.innerText || element.textContent || element.getAttribute('aria-label') || '',
      ));
    if (!candidate) return false;
    candidate.scrollIntoView({ block: 'center' });
    candidate.click();
    return true;
  }).catch(() => false);
  if (!clicked) return false;
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
  return true;
}

function normalizeUrlKey(url = '') {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return String(url || '');
  }
}

function getPriorityDetailCoverageKey(url = '', category = '') {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }

  if (category === 'visits') {
    const csn = parsed.searchParams.get('csn') || '';
    const hnoId = parsed.searchParams.get('hnoID') || '';
    const hnoDat = parsed.searchParams.get('hnoDAT') || '';
    if (!hnoId && !hnoDat) return '';
    return ['visits', csn, hnoId, hnoDat].join('|');
  }

  if (category === 'test-results') return normalizeUrlKey(url);

  return '';
}

export function buildPriorityDetailCoverage(records = []) {
  const coverage = new Set();
  for (const record of records || []) {
    if (record?.category === 'visits'
      && (record?.recordType !== 'visit-note' || isGenericVisitNoteTitle(record?.title || ''))) {
      continue;
    }
    if (record?.category === 'test-results'
      && /\bexternal\s+scan\b/i.test(`${record?.title || ''}\n${record?.rawText || ''}`)
      && !recordHasDownloadedAttachment(record)) {
      continue;
    }
    const key = getPriorityDetailCoverageKey(record?.sourceUrl || '', record?.category || '');
    if (key) coverage.add(key);
  }
  return coverage;
}

function recordHasDownloadedAttachment(record = {}) {
  return (record.documentAttachments || record.attachments || [])
    .some((attachment) => attachment.status === 'downloaded' && attachment.filePath);
}

function shouldEnqueueLink(link = {}, target = {}) {
  const haystack = `${link.text || ''} ${link.href || ''}`;
  if (target.category === 'test-results') {
    return /\b(?:detail|result|component|eorderid|orderid|resultid|view)\b/i.test(haystack);
  }
  if (target.category === 'visits') {
    return /\b(?:visit|notes?|after visit|summary|clinical|past-details|csn|hnoID)\b/i.test(haystack);
  }
  return /\b(?:view|details?|summary)\b/i.test(haystack);
}

function isSelfHashLink(href = '', sourceUrl = '') {
  if (!href || !sourceUrl) return false;
  return normalizeUrlKey(href) === normalizeUrlKey(sourceUrl)
    && /#$/.test(String(href));
}

function normalizeEnqueuedUrl(href = '', category = '') {
  if (category !== 'visits') return href;
  try {
    const parsed = new URL(href);
    if (parsed.pathname.toLowerCase().includes('/app/visits/past-details')
      && parsed.searchParams.has('csn')
      && !parsed.searchParams.has('pageMode')) {
      parsed.searchParams.set('pageMode', 'notesfirst');
      parsed.hash = '';
      return parsed.href;
    }
  } catch {
    return href;
  }
  return href;
}

function enqueueExtractionLinks({
  queue,
  seen,
  extraction,
  target,
  priorityDetailCoverage = new Set(),
}) {
  const category = target.category || extraction.page?.category || '';
  const priorityLinks = collectPriorityDetailLinks(extraction, { ...target, category })
    .map((href) => ({
      text: category === 'visits' ? 'Visit note' : 'Result detail',
      href,
      priorityDetail: true,
    }));
  const links = [...priorityLinks, ...(extraction.links || [])];
  for (const link of links) {
    if (!link.href || isSelfHashLink(link.href, extraction.page?.sourceUrl)) continue;
    if (!link.priorityDetail && !shouldEnqueueLink(link, { ...target, category })) continue;
    const url = normalizeEnqueuedUrl(link.href, category);
    const key = normalizeUrlKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    const coverageKey = link.priorityDetail
      ? getPriorityDetailCoverageKey(url, category)
      : '';
    queue.push({
      category,
      label: link.text || target.label || target.category,
      url,
      priorityDetail: Boolean(link.priorityDetail),
      hasStoredRecord: coverageKey ? priorityDetailCoverage.has(coverageKey) : false,
      priority: target.priority || 10,
    });
  }
}

function markIncrementalRefreshTargets(targets = []) {
  return targets.map((target) => ({
    ...target,
    // MyChart category/proxy landing pages use stable URLs while their child
    // note/result links change over time. Revisit these discovery pages during
    // routine syncs so new records are found without forcing every old detail.
    refreshOnIncremental: true,
  }));
}

function inferSyncCategoryFromUrl(url = '') {
  const value = String(url || '').toLowerCase();
  if (value.includes('test-results') || value.includes('testresults')) return 'test-results';
  if (value.includes('visit')) return 'visits';
  if (value.includes('medication')) return 'medications';
  if (value.includes('letter')) return 'letters';
  if (value.includes('health-summary') || value.includes('healthsummary')) return 'health-summary';
  return 'general';
}

function createSeedSyncTargets(seedUrls = [], {
  categories,
  priorityDetailCoverage = new Set(),
} = {}) {
  const categorySet = new Set((categories || []).map((item) => String(item || '').trim()).filter(Boolean));
  return [...new Set((seedUrls || []).map((item) => String(item || '').trim()).filter(Boolean))]
    .map((url) => {
      const category = inferSyncCategoryFromUrl(url);
      if (categorySet.size && !categorySet.has(category)) return null;
      const coverageKey = getPriorityDetailCoverageKey(url, category);
      return {
        category,
        label: `Seed URL: ${category}`,
        url,
        priority: 0,
        priorityDetail: Boolean(coverageKey),
        hasStoredRecord: coverageKey ? priorityDetailCoverage.has(coverageKey) : false,
      };
    })
    .filter(Boolean);
}

export function shouldVisitSyncTarget(target = {}, {
  force = false,
  visitedUrls = {},
} = {}) {
  if (force) return true;
  const key = normalizeUrlKey(target.url);
  if (!visitedUrls[key]) return true;
  if (target.priorityDetail && !target.hasStoredRecord) return true;
  return Boolean(target.refreshOnIncremental);
}

export async function getDeepSyncTargetsFromPage(page, { categories } = {}) {
  const source = buildExtractorInjectionSource();
  const targets = await page.evaluate((extractorSource) => {
    if (!globalThis.MyChartExtractorCore) {
      Function(extractorSource)();
    }
    return globalThis.MyChartExtractorCore.getDeepSyncTargets(location.href, document);
  }, source);
  const categorySet = new Set((categories || []).map((item) => String(item || '').trim()).filter(Boolean));
  return targets.filter((target) => !categorySet.size || categorySet.has(target.category));
}

export async function runPuppeteerDeepSync({
  browser,
  session = {},
  categories,
  seedUrls,
  maxRecords,
  maxPages,
  storePath = DEFAULT_STORE_PATH,
  force = false,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  onProgress = () => {},
} = {}) {
  if (!browser) throw new Error('browser is required.');
  await activateAuthenticatedMyChartTab(browser, { session, timeoutSeconds });
  const mychartPage = await findMyChartPage(browser, session);
  const discoveryTargets = await getDeepSyncTargetsFromPage(mychartPage, { categories });
  const store = new JsonMedicalStore({ storePath });
  const metadata = await store.getSyncMetadata();
  const priorityDetailCoverage = buildPriorityDetailCoverage(await store.getAllRecords());
  const visitedUrls = force ? {} : { ...(metadata.visitedUrls || {}) };
  const seen = new Set();
  const seedTargets = createSeedSyncTargets(seedUrls, { categories, priorityDetailCoverage });
  const queue = [
    ...seedTargets,
    ...markIncrementalRefreshTargets(discoveryTargets),
  ]
    .sort((a, b) => (a.priority || 10) - (b.priority || 10));
  queue.forEach((target) => seen.add(normalizeUrlKey(target.url)));
  const worker = await browser.newPage();
  worker.setDefaultTimeout(timeoutSeconds * 1000);
  const status = {
    success: true,
    running: true,
    status: 'running',
    current: 'starting',
    pagesPlanned: queue.length,
    pagesVisited: 0,
    recordsSaved: 0,
    errors: [],
    startedAt: new Date().toISOString(),
  };

  try {
    while (queue.length) {
      if (Number.isFinite(Number(maxPages)) && status.pagesVisited >= Number(maxPages)) break;
      if (Number.isFinite(Number(maxRecords)) && status.recordsSaved >= Number(maxRecords)) break;
      const target = queue.shift();
      const key = normalizeUrlKey(target.url);
      if (!shouldVisitSyncTarget(target, { force, visitedUrls })) continue;
      status.current = target.label || target.category || target.url;
      onProgress({ ...status, running: true });
      try {
        await gotoWithFallback(worker, target);
        if (target.category === 'visits') {
          await openVisitClinicalNotesIfPresent(worker);
        }
        const extraction = await enrichExternalScanAttachments(worker, await extractPage(worker));
        const saveResult = await store.saveExtractedPage(extraction);
        status.pagesVisited += 1;
        status.recordsSaved += saveResult.recordCount;
        visitedUrls[key] = new Date().toISOString();
        enqueueExtractionLinks({
          queue,
          seen,
          extraction,
          target,
          priorityDetailCoverage,
        });
        status.pagesPlanned = Math.max(status.pagesPlanned, status.pagesVisited + queue.length);
      } catch (error) {
        status.errors.push(`${target.url}: ${error.message}`);
        visitedUrls[key] = new Date().toISOString();
      }
    }

    status.running = false;
    status.status = status.errors.length ? 'success_with_errors' : 'success';
    status.finishedAt = new Date().toISOString();
    await store.saveSyncMetadata({
      ...metadata,
      lastDeepSyncAt: status.finishedAt,
      visitedUrls,
    });
    return status;
  } finally {
    await worker.close().catch(() => {});
  }
}
