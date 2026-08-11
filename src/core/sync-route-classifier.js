import { createHash } from 'node:crypto';

import { isPriorityDetailLink } from './deep-sync-links.js';

const CLINICAL_ID_KEYS = new Set([
  'component', 'eorderid', 'orderid', 'resultid', 'csn', 'noteid', 'hnoid', 'hnodat', 'lrpid', 'dcsid',
]);
const PRESENTATION_KEYS = new Set([
  'pagmode', 'pagemode', 'tracking', 'utm_source', 'utm_medium', 'utm_campaign', 'from', 'view', 'tab',
]);

export function normalizeSyncCategories(categories = []) {
  const supported = new Set(['visits', 'test-results', 'medications', 'letters', 'health-summary']);
  const normalized = [...new Set((categories || [])
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean))].sort();
  const unsupported = normalized.filter((value) => !supported.has(value));
  if (unsupported.length) throw new Error(`Unsupported sync categories: ${unsupported.join(', ')}.`);
  return normalized;
}

export function classifySyncLink(link = {}, {
  category = '',
  sourceUrl = '',
  expectedOrigin = '',
} = {}) {
  let url;
  try {
    url = new URL(link.href || '', sourceUrl || undefined);
  } catch {
    return { routeClass: 'invalid', admission: 'rejected', reason: 'invalid_url' };
  }
  if (expectedOrigin && url.origin !== expectedOrigin) {
    return { routeClass: 'off-origin', admission: 'rejected', reason: 'off_origin' };
  }
  const path = url.pathname.toLowerCase();
  const text = String(link.text || '').toLowerCase();
  const haystack = `${path} ${text}`;
  const mode = String(url.searchParams.get('mode') || '').toLowerCase();
  const action = String(url.searchParams.get('action') || '').toLowerCase();

  if (mode === 'proxyswitch' && action === 'switchcontext') {
    return { routeClass: 'proxy-switch', admission: 'strict', reason: 'proxy_switch' };
  }
  if (path.includes('past-result-details') || /compare result trends|view trends/.test(text)) {
    return { routeClass: 'trend', admission: 'rejected', reason: 'trend' };
  }
  if (/authentication|login|forgot|signup|help|billing|payment/.test(haystack)) {
    return { routeClass: 'auth-help-billing', admission: 'rejected', reason: 'nonclinical' };
  }
  if (mode === 'stdfile' || /contentredirect|\/application(?:\/|$)|inside\.asp/.test(path)
    || /terms|privacy|language|non-discrimination|accessibility/.test(text)) {
    return { routeClass: 'static-content', admission: 'rejected', reason: 'static_content' };
  }
  if (isPriorityDetailLink({ ...link, href: url.href }, category)) {
    return {
      routeClass: category === 'visits' ? 'visit-detail' : 'result-detail',
      admission: 'strict',
      reason: 'recognized_detail',
    };
  }
  const keys = [...url.searchParams.keys()].map((key) => key.toLowerCase());
  const hasClinicalId = keys.some((key) => CLINICAL_ID_KEYS.has(key));
  const clinicalFamily = category === 'test-results'
    ? /test|result|clinical/.test(path)
    : category === 'visits' ? /visit|note|clinical/.test(path) : false;
  if (hasClinicalId && clinicalFamily) {
    return { routeClass: 'unknown-clinical', admission: 'exhaustive', reason: 'credible_unrecognized_clinical_route' };
  }
  return { routeClass: 'unrelated', admission: 'rejected', reason: 'unrelated' };
}

export function canonicalClinicalRouteIdentity(urlValue = '', {
  category = '',
  patientContextToken = '',
} = {}) {
  let url;
  try {
    url = new URL(urlValue);
  } catch {
    return '';
  }
  const path = url.pathname.replace(/\/+$/, '').toLowerCase();
  const identifiers = [...url.searchParams.entries()]
    .map(([key, value]) => [key.toLowerCase(), value])
    .filter(([key]) => CLINICAL_ID_KEYS.has(key) || (!PRESENTATION_KEYS.has(key) && key === 'action'))
    .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  if (!identifiers.length) return `${url.origin.toLowerCase()}|${patientContextToken}|${category}|${path}`;
  return [url.origin.toLowerCase(), patientContextToken, category, path,
    ...identifiers.map(([key, value]) => `${key}=${value}`)].join('|');
}

export function hashCanonicalIdentity(identity = '') {
  return createHash('sha256').update(String(identity)).digest('hex');
}
