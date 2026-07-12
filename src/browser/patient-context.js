import { createHmac, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const METADATA_FILE = 'mychart-private-context.json';

function normalize(value = '') {
  return String(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

export function inspectRequiredActivePatientContext(expectedLabel, root = globalThis.document) {
  const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const canonical = (value) => compact(value).toLowerCase();
  const expected = canonical(expectedLabel);
  if (!expected) return { status: 'missing' };

  // Restrict inspection to explicit patient/proxy context controls. Generic
  // aria-current navigation (for example the current menu page) is not patient evidence.
  const selector = [
    '.currentContext',
    '[data-patient-name]',
    '.proxySubjectLink[aria-current="page"]',
    '.proxySubjectLink[aria-current="true"]',
    '[data-proxy-context][aria-current="page"]',
    '[data-proxy-context][aria-current="true"]',
  ].join(', ');
  const elements = [...(root?.querySelectorAll?.(selector) || [])];
  const uniqueElements = [...new Set(elements)];

  const unwrap = (rawValue) => {
    let value = compact(rawValue);
    if (!value) return '';
    value = value
      .replace(/^(?:current\s+(?:patient|context|chart)|you(?:'|’)re\s+viewing)\s*[:\-]?\s*/i, '')
      .replace(/\s*\((?:current|selected)\)\s*$/i, '')
      .trim();
    const normalized = canonical(value);
    // SCH can concatenate a one-letter avatar with the patient label ("FFelix").
    // Strip only that exact expected-dependent shape; never strip arbitrary initials.
    if (expected.length > 1
      && normalized === `${expected[0]}${expected}`
      && normalized[0] === normalized[1]) {
      return expected;
    }
    return normalized;
  };

  const candidates = uniqueElements.map((element) => {
    // Attribute values are intentional labels and outrank rendered text, which can
    // include an adjacent avatar initial. Each source is still parsed independently.
    const sources = [
      element.getAttribute?.('data-patient-name'),
      element.getAttribute?.('aria-label'),
      element.getAttribute?.('title'),
      element.innerText,
    ].map(unwrap).filter(Boolean);
    if (!sources.length) return 'missing';
    return sources.includes(expected) ? 'match' : 'mismatch';
  }).filter((status) => status !== 'missing');

  if (!candidates.length) return { status: 'missing' };
  if (candidates.length > 1) return { status: 'ambiguous' };
  return { status: candidates[0] === 'match' ? 'validated' : 'mismatch' };
}

export async function assertActivePatientContext(page, expectedLabel) {
  const expected = normalize(expectedLabel);
  if (!expected) return { status: 'missing', normalizedLabel: '' };
  // The page callback returns status only. Raw labels remain inside the browser context.
  const result = await page.evaluate(inspectRequiredActivePatientContext, expected);
  if (result?.status !== 'validated') throw patientContextError(result?.status || 'missing');
  return { status: 'validated', normalizedLabel: expected };
}

function patientContextError(status) {
  const error = new Error(`Required active patient context validation failed: ${status}.`);
  error.code = 'ACTIVE_PATIENT_CONTEXT';
  error.contextStatus = status;
  return error;
}

export async function bindPatientContext({ profileDir, origin, normalizedLabel, validated = false } = {}) {
  if (!profileDir || !origin || !normalizedLabel) return { token: '', bound: false };
  const metadataPath = path.join(profileDir, METADATA_FILE);
  let metadata = {};
  try {
    metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!metadata.secret && !validated) return { token: '', bound: false };
  const secret = metadata.secret || randomBytes(32).toString('hex');
  const token = createHmac('sha256', secret).update(`${normalize(origin)}|${normalize(normalizedLabel)}`).digest('hex');
  const bindings = { ...(metadata.bindings || {}) };
  const legacyBindingKey = `${normalize(origin)}|${normalize(normalizedLabel)}`;
  const bound = Boolean(bindings[token] || bindings[legacyBindingKey]);
  if (!validated) return { token, bound };
  // Binding keys are nonreversible tokens. Migrate the brief pre-token-key
  // format without retaining a raw expected label in profile metadata.
  delete bindings[legacyBindingKey];
  bindings[token] = { validatedAt: new Date().toISOString() };
  await mkdir(profileDir, { recursive: true });
  const tmp = `${metadataPath}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ version: 1, secret, bindings }, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, metadataPath);
  return { token, bound: true };
}
