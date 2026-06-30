#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_LIVE_HARNESS_PORT,
  createLiveHarnessEndpoint,
} from './live-harness-lib.mjs';
import {
  DEFAULT_MYCHART_URL,
} from './puppeteer-live-harness-lib.mjs';
import {
  launchLiveHarness,
  openMyChartPage,
} from './launch-live-harness.mjs';
import { validateLiveHarness } from './validate-live-harness.mjs';

export function createComputerUseAlignmentChecklist(session) {
  return [
    'Required Computer Use alignment check for future agents:',
    '  1. Run get_app_state("com.google.Chrome").',
    `  2. Confirm the visible Chrome window is PID ${session.browserPid || '<printed above>'}.`,
    '  3. Confirm the visible title/URL is the MyChart login or the user-prepared MyChart tab.',
    '  4. Only ask the user to log in after those facts match this harness session.',
  ];
}

function printInitSummary({ session, validation }) {
  const mychartTab = validation.mychartTabs[0];
  const lines = [
    'mychart-cli live harness init is ready.',
    `  Profile:       ${session.profileDir}`,
    `  CDP endpoint:  ${session.endpoint}`,
    `  Browser PID:   ${session.browserPid || 'unknown'}`,
    `  MyChart tab:   ${mychartTab?.title || '(untitled)'} :: ${mychartTab?.url || session.mychartUrl}`,
    '',
    ...createComputerUseAlignmentChecklist(session),
    '',
    'Keep this process running. Press Ctrl+C here to close the harness.',
  ];

  console.log(lines.join('\n'));
}

function printHeadlessInitSummary({ session, validation }) {
  const mychartTab = validation.mychartTabs[0];
  const lines = [
    'mychart-cli headless live harness init is ready.',
    `  Profile:       ${session.profileDir}`,
    `  CDP endpoint:  ${session.endpoint}`,
    `  Browser PID:   ${session.browserPid || 'unknown'}`,
    `  MyChart tab:   ${mychartTab?.title || '(untitled)'} :: ${mychartTab?.url || session.mychartUrl}`,
    '',
    'No visible Chrome window is expected. If MyChart requires MFA, CAPTCHA, or device verification, stop this harness and use npm run init:live.',
    '',
    'Keep this process running. Press Ctrl+C here to close the harness.',
  ];

  console.log(lines.join('\n'));
}

export async function initLiveHarness({
  debugPort = process.env.AWESOME_MYCHART_DEBUG_PORT || DEFAULT_LIVE_HARNESS_PORT,
  mychartUrl = process.env.AWESOME_MYCHART_URL || DEFAULT_MYCHART_URL,
  headless = false,
} = {}) {
  const endpoint = createLiveHarnessEndpoint(debugPort);
  const { browser, session } = await launchLiveHarness({ debugPort, mychartUrl, headless });

  await openMyChartPage(browser, mychartUrl);

  const validation = await validateLiveHarness({ port: debugPort });
  if (!validation.ok) {
    const details = validation.errors.map((error) => `- ${error}`).join('\n');
    throw new Error(`Live harness init reached ${endpoint}, but validation failed:\n${details}`);
  }

  return { browser, session, validation };
}

async function main() {
  let browser;
  try {
    const headless = process.argv.includes('--headless');
    const result = await initLiveHarness({ headless });
    browser = result.browser;
    if (headless) printHeadlessInitSummary(result);
    else printInitSummary(result);

    const close = async () => {
      await browser?.close();
      process.exit(0);
    };

    process.once('SIGINT', close);
    process.once('SIGTERM', close);

    await new Promise((resolve) => {
      browser.on('disconnected', resolve);
    });
  } catch (error) {
    await browser?.close();
    console.error(error.message);
    process.exit(1);
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (import.meta.url === invokedUrl) {
  await main();
}
