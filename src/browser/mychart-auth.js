import { DEFAULT_TIMEOUT_SECONDS } from '../core/paths.js';
import { getMyChartCredentialsFromEnv } from '../core/env.js';
import {
  findMyChartPage,
  inspectMyChartLoginState,
} from './sync-runner.js';

export async function loginToMyChartWithEnv(browser, {
  session = {},
  env = process.env,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
} = {}) {
  const page = await findMyChartPage(browser, session);
  page.setDefaultTimeout(timeoutSeconds * 1000);
  const credentials = getMyChartCredentialsFromEnv(env, {
    mychartUrl: session.mychartUrl || page.url(),
  });
  if (!credentials.available) {
    throw new Error(`Missing MyChart credential environment variable(s): ${credentials.missing.join(', ')}`);
  }

  const before = await inspectMyChartLoginState(page);
  if (before.loggedIn) return { status: 'already_logged_in', url: page.url() };

  await openMyChartAccessLoginIfNeeded(page);
  await waitForMyChartCredentialFields(page, { timeoutSeconds });
  await fillAndSubmitMyChartLogin(page, {
    username: credentials.username,
    password: credentials.password,
  });

  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  await sleep(1500);
  const after = await inspectMyChartLoginState(page);

  if (after.loggedIn) return { status: 'logged_in', url: page.url() };
  if (after.needsMfa) return { status: 'needs_mfa', url: page.url() };
  if (after.loginVisible) return { status: 'login_failed_or_still_visible', url: page.url() };
  return { status: 'unknown_after_submit', url: page.url() };
}

export async function switchMyChartProxyContext(browser, {
  session = {},
  patient = '',
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
} = {}) {
  if (!patient) return { status: 'skipped', reason: 'no_patient' };
  const page = await findMyChartPage(browser, session);
  page.setDefaultTimeout(timeoutSeconds * 1000);
  const result = await page.evaluate((targetPatient) => {
    const normalizedTarget = String(targetPatient || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const candidates = [...document.querySelectorAll('a, button, [role="button"], [role="menuitem"]')]
      .map((element) => ({
        element,
        text: (element.innerText || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
        href: element.href || element.getAttribute('href') || '',
        current: /\bcurrentContext\b/.test(String(element.className || '')),
      }))
      .filter((item) => item.text || item.href);
    const target = candidates.find((item) => (
      item.text.toLowerCase().includes(normalizedTarget)
        && /proxyswitch|proxySubjectLink|switchcontext/i.test(`${item.href} ${item.text} ${item.element.className || ''}`)
    ));
    if (!target) return { switched: false, error: `No proxy context matched ${targetPatient}.` };
    if (target.current) return { switched: false, alreadyCurrent: true, text: target.text };
    if (target.href) {
      location.href = target.href;
      return { switched: true, text: target.text, href: target.href };
    }
    target.element.click();
    return { switched: true, text: target.text, href: '' };
  }, patient);

  if (result.switched) {
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await sleep(1500);
    const verified = await waitForMyChartProxyContext(page, patient, { timeoutSeconds: 10 });
    return { status: 'switched', ...result, verifiedText: verified.text, url: page.url() };
  }
  if (result.alreadyCurrent) {
    const verified = await waitForMyChartProxyContext(page, patient, { timeoutSeconds: 10 });
    return { status: 'already_current', ...result, verifiedText: verified.text, url: page.url() };
  }
  throw new Error(result.error || `Could not switch MyChart proxy context to ${patient}.`);
}

export async function waitForMyChartProxyContext(page, patient, {
  timeoutSeconds = 10,
  pollIntervalMs = 500,
} = {}) {
  const startedAt = Date.now();
  let lastContext = null;
  while (Date.now() - startedAt <= timeoutSeconds * 1000) {
    lastContext = await inspectMyChartProxyContext(page);
    if (doesPatientTextMatch(lastContext.text, patient)) return lastContext;
    await sleep(pollIntervalMs);
  }
  throw new Error(
    `MyChart proxy context verification failed. Expected current patient matching "${patient}", found "${lastContext?.text || 'unknown'}".`,
  );
}

export async function inspectMyChartProxyContext(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll('a, button, [role="button"], [role="menuitem"], [aria-current]')]
      .map((element) => ({
        text: normalize(element.innerText || element.getAttribute('aria-label') || ''),
        href: element.href || element.getAttribute('href') || '',
        className: String(element.className || ''),
        ariaCurrent: element.getAttribute('aria-current') || '',
      }))
      .filter((item) => item.text || item.href);
    const current = candidates.find((item) => (
      /\bcurrentContext\b/i.test(item.className)
        || /^(?:page|true)$/i.test(item.ariaCurrent)
        || (/proxySubjectLink|proxyswitch|switchcontext/i.test(`${item.href} ${item.className}`) && /\bcurrent\b/i.test(item.text))
    ));
    return current || { text: '', href: '', className: '', ariaCurrent: '' };
  });
}

export async function openMyChartAccessLoginIfNeeded(page) {
  const hasPassword = await page.evaluate(() => Boolean(document.querySelector('input[type="password"]')));
  if (hasPassword) return { opened: false, reason: 'password_visible' };

  const result = await page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const candidates = [...document.querySelectorAll('a, button, [role="button"]')]
      .filter((element) => visible(element))
      .map((element) => ({
        element,
        text: (element.innerText || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
        href: element.href || element.getAttribute('href') || '',
      }));
    const target = candidates.find((item) => /Access MyChart/i.test(item.text))
      || candidates.find((item) => /Log in to MyChart/i.test(item.text) && item.href && item.href !== '#')
      || candidates.find((item) => /saml-to-oidc|patientportal/i.test(item.href));
    if (!target) return { opened: false, reason: 'no_access_link' };
    if (target.href && target.href !== '#') {
      location.href = target.href;
      return { opened: true, by: 'href', text: target.text };
    }
    target.element.click();
    return { opened: true, by: 'click', text: target.text };
  });

  if (result.opened) {
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await sleep(1500);
  }
  return result;
}

export async function waitForMyChartCredentialFields(page, {
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  pollIntervalMs = 500,
} = {}) {
  const startedAt = Date.now();
  let lastState = null;
  while (Date.now() - startedAt <= timeoutSeconds * 1000) {
    lastState = await inspectMyChartLoginState(page).catch((error) => ({
      url: page.url(),
      loggedIn: false,
      loginVisible: false,
      needsMfa: false,
      error: error.message,
    }));
    if (lastState.loggedIn || lastState.needsMfa || lastState.hasCredentialFields) {
      return lastState;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(
    `Timed out waiting for MyChart credential fields after opening login page. Last URL: ${lastState?.url || page.url()}`,
  );
}

export async function fillAndSubmitMyChartLogin(page, { username, password } = {}) {
  if (!username || !password) {
    throw new Error('username and password are required.');
  }
  const result = await page.evaluate(({ username: account, password: secret }) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const candidates = [...document.querySelectorAll('input')]
      .filter((input) => !input.disabled && !input.readOnly && visible(input));
    const passwordInput = candidates.find((input) => input.type === 'password');
    const usernameInput = candidates.find((input) => {
      if (input === passwordInput) return false;
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

    if (!usernameInput || !passwordInput) {
      return { success: false, error: 'Could not find visible username/password fields.' };
    }

    const setValue = (input, value) => {
      input.focus();
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setValue(usernameInput, account);
    setValue(passwordInput, secret);

    const submit = [...document.querySelectorAll('button, input[type="submit"], input[type="button"]')]
      .filter((element) => !element.disabled && visible(element))
      .find((element) => /\b(?:sign in|log in|login|submit|continue)\b/i.test(
        `${element.innerText || ''} ${element.value || ''} ${element.getAttribute('aria-label') || ''}`,
      ));
    if (submit) {
      submit.click();
      return { success: true, submittedBy: 'button' };
    }

    const form = passwordInput.form || usernameInput.form;
    if (form) {
      form.requestSubmit ? form.requestSubmit() : form.submit();
      return { success: true, submittedBy: 'form' };
    }

    return { success: false, error: 'Could not find a login submit button or form.' };
  }, { username, password });

  if (!result.success) {
    throw new Error(result.error || 'MyChart login form submission failed.');
  }
  return result;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function doesPatientTextMatch(actual, expected) {
  const normalizedActual = String(actual || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const normalizedExpected = String(expected || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return Boolean(normalizedActual && normalizedExpected && normalizedActual.includes(normalizedExpected));
}
