import path from 'node:path';

import { DEFAULT_LIVE_HARNESS_PORT } from './live-harness-lib.mjs';

export const DEFAULT_MYCHART_URL = 'https://mychart.example.org/mychart/Home';
export const DEFAULT_PROFILE_RELATIVE_PATH = 'browser_profiles/awesome-mychart-live';
export const DEFAULT_WINDOW_SIZE = { width: 1280, height: 900 };

export function resolveHarnessPaths({
  rootDir,
  profileDir = process.env.AWESOME_MYCHART_PROFILE_DIR,
} = {}) {
  if (!rootDir) {
    throw new Error('rootDir is required');
  }

  return {
    rootDir,
    profileDir: path.resolve(rootDir, profileDir || DEFAULT_PROFILE_RELATIVE_PATH),
  };
}

export function createPuppeteerLaunchOptions({
  profileDir,
  debugPort = DEFAULT_LIVE_HARNESS_PORT,
  executablePath,
  channel = 'chrome',
  headless = false,
  windowSize = DEFAULT_WINDOW_SIZE,
  pipe = true,
} = {}) {
  if (!profileDir) {
    throw new Error('profileDir is required');
  }

  const args = [
    ...(pipe ? ['--remote-debugging-pipe'] : []),
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debugPort}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=${windowSize.width},${windowSize.height}`,
  ];

  const normalizedHeadless = headless === true ? 'new' : headless;

  return {
    headless: normalizedHeadless,
    userDataDir: profileDir,
    pipe,
    ...(pipe ? {} : { detached: true }),
    defaultViewport: null,
    ...(executablePath ? { executablePath } : {}),
    ...(!executablePath && channel ? { channel } : {}),
    args,
  };
}

export function createHarnessSession({
  endpoint,
  mychartUrl = DEFAULT_MYCHART_URL,
  profileDir,
  browserPid,
  startedAt = new Date().toISOString(),
} = {}) {
  if (!endpoint) {
    throw new Error('endpoint is required');
  }

  return {
    startedAt,
    endpoint,
    browserPid: browserPid || null,
    mychartUrl,
    profileDir,
  };
}
