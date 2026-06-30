#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_LIVE_HARNESS_PORT,
  createLiveHarnessEndpoint,
} from './live-harness-lib.mjs';
import {
  DEFAULT_MYCHART_URL,
  createHarnessSession,
  createPuppeteerLaunchOptions,
  resolveHarnessPaths,
} from './puppeteer-live-harness-lib.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function getSessionFile(profileDir) {
  return path.join(profileDir, 'awesome-mychart-live-session.json');
}

async function endpointIsReachable(endpoint) {
  try {
    const response = await fetch(`${endpoint}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

async function importPuppeteer() {
  try {
    return await import('puppeteer-core');
  } catch (error) {
    throw new Error(
      `Puppeteer Core is not installed. Run npm install in ${rootDir}, then retry. Original error: ${error.message}`,
    );
  }
}

export async function openMyChartPage(browser, mychartUrl) {
  const pages = await browser.pages();
  const page = pages.find((candidate) => candidate.url() === 'about:blank') || pages[0] || await browser.newPage();
  await page.goto(mychartUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((error) => {
    if (page.url() === 'about:blank') throw error;
    console.warn(`MyChart page navigation did not reach domcontentloaded before timeout; continuing at ${page.url()}`);
  });
  await page.bringToFront();
  return page;
}

function printSession(session) {
  console.log('mychart-cli live harness is running.');
  console.log(`  Profile:       ${session.profileDir}`);
  console.log(`  CDP endpoint:  ${session.endpoint}`);
  console.log(`  MyChart:       ${session.mychartUrl}`);
  console.log('');
  console.log('Log into MyChart in this visible browser window. Press Ctrl+C here to close the harness.');
}

export async function launchLiveHarness({
  debugPort = process.env.AWESOME_MYCHART_DEBUG_PORT || DEFAULT_LIVE_HARNESS_PORT,
  mychartUrl = process.env.AWESOME_MYCHART_URL || DEFAULT_MYCHART_URL,
  executablePath = process.env.CHROME_BIN,
  headless = false,
  pipe = true,
} = {}) {
  const { profileDir } = resolveHarnessPaths({ rootDir });
  const endpoint = createLiveHarnessEndpoint(debugPort);

  if (await endpointIsReachable(endpoint)) {
    throw new Error(`A browser is already exposing CDP at ${endpoint}. Run scripts/stop-live-harness.sh first.`);
  }

  await mkdir(profileDir, { recursive: true });

  const puppeteer = await importPuppeteer();
  const launchOptions = createPuppeteerLaunchOptions({
    profileDir,
    debugPort,
    executablePath,
    headless,
    pipe,
  });

  const browser = await puppeteer.default.launch(launchOptions);

  await openMyChartPage(browser, mychartUrl);

  const processHandle = browser.process?.();
  const session = createHarnessSession({
    endpoint,
    mychartUrl,
    profileDir,
    browserPid: processHandle?.pid,
  });

  await writeFile(getSessionFile(profileDir), `${JSON.stringify(session, null, 2)}\n`, 'utf8');

  return { browser, session };
}

async function main() {
  let browser;
  try {
    const result = await launchLiveHarness();
    browser = result.browser;
    printSession(result.session);

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

const invokedUrl = process.argv[1] ? new URL(process.argv[1], 'file:').href : null;

if (import.meta.url === invokedUrl) {
  await main();
}
