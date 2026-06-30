#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import puppeteer from 'puppeteer-core';

import {
  DEFAULT_LIVE_HARNESS_PORT,
  createLiveHarnessEndpoint,
  getJson,
  validateLiveHarnessState,
} from './live-harness-lib.mjs';
import { inspectMyChartLoginState } from '../src/browser/sync-runner.js';
import { inspectMyChartProxyContext } from '../src/browser/mychart-auth.js';

export async function validateLiveHarness({
  port = process.env.AWESOME_MYCHART_DEBUG_PORT || DEFAULT_LIVE_HARNESS_PORT,
  requireAuth = false,
} = {}) {
  const endpoint = createLiveHarnessEndpoint(port);
  const version = await getJson(endpoint, '/json/version');
  const tabs = await getJson(endpoint, '/json/list');
  const state = validateLiveHarnessState({ tabs, requireAuth: false });
  const operational = await inspectOperationalMyChartState({ endpoint, mychartTabs: state.mychartTabs });
  const errors = [...state.errors];
  if (requireAuth && operational.authStatus !== 'logged_in') {
    errors.push(`MyChart auth status is ${operational.authStatus}; login or complete verification before syncing.`);
  }

  return {
    endpoint,
    version,
    tabs,
    ...state,
    ...operational,
    browserOk: true,
    mychartOpen: state.mychartTabs.length > 0,
    ok: errors.length === 0,
    errors,
  };
}

async function inspectOperationalMyChartState({ endpoint, mychartTabs = [] } = {}) {
  if (!mychartTabs.length) {
    return {
      authStatus: 'not_open',
      patientContext: null,
      needsMfa: false,
    };
  }

  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: endpoint });
    const pages = await browser.pages();
    const mychartPages = pages.filter((page) => /mychart/i.test(page.url()));
    const inspections = [];
    for (const page of mychartPages) {
      const auth = await inspectMyChartLoginState(page).catch((error) => ({
        url: page.url(),
        loggedIn: false,
        loginVisible: false,
        needsMfa: false,
        error: error.message,
      }));
      const patient = await inspectMyChartProxyContext(page).catch(() => null);
      inspections.push({ page, auth, patient });
    }
    const best = inspections.find((item) => item.auth.loggedIn)
      || inspections.find((item) => item.auth.needsMfa)
      || inspections.find((item) => item.auth.loginVisible)
      || inspections[0];
    return {
      authStatus: best?.auth?.loggedIn
        ? 'logged_in'
        : best?.auth?.needsMfa
          ? 'needs_mfa'
          : best?.auth?.loginVisible
            ? 'login_visible'
            : 'unknown',
      patientContext: best?.patient?.text || null,
      needsMfa: Boolean(best?.auth?.needsMfa),
    };
  } catch (error) {
    return {
      authStatus: 'unknown',
      patientContext: null,
      needsMfa: false,
      authError: error.message,
    };
  } finally {
    await browser?.disconnect();
  }
}

function printValidation(result) {
  console.log(`CDP endpoint: ${result.endpoint}`);
  console.log(`Browser: ${result.version.Browser || 'unknown'}`);
  console.log(`User agent: ${result.version['User-Agent'] || 'unknown'}`);
  console.log(`Page tabs: ${result.visibleTabs.length}`);
  console.log(`MyChart tabs: ${result.mychartTabs.length}`);
  console.log(`Browser reachable: ${result.browserOk ? 'yes' : 'no'}`);
  console.log(`MyChart open: ${result.mychartOpen ? 'yes' : 'no'}`);
  console.log(`Auth status: ${result.authStatus || 'unknown'}`);
  console.log(`Needs MFA: ${result.needsMfa ? 'yes' : 'no'}`);
  if (result.patientContext) console.log(`Patient context: ${result.patientContext}`);

  for (const tab of result.mychartTabs) {
    console.log(`MyChart: ${tab.title || '(untitled)'} :: ${tab.url}`);
  }

  if (!result.ok) {
    console.error('Live harness is not ready for agent validation:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    return;
  }

  console.log('Live harness is ready for agent validation.');
}

async function main() {
  try {
    const result = await validateLiveHarness({ requireAuth: true });
    printValidation(result);
    if (!result.ok) process.exit(1);
  } catch (error) {
    const port = process.env.AWESOME_MYCHART_DEBUG_PORT || DEFAULT_LIVE_HARNESS_PORT;
    const endpoint = createLiveHarnessEndpoint(port);
    console.error(`Unable to reach mychart-cli live harness at ${endpoint}.`);
    console.error('Launch it with scripts/launch-live-harness.sh, then log into MyChart in that window.');
    console.error(error.message);
    process.exit(1);
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (import.meta.url === invokedUrl) {
  await main();
}
