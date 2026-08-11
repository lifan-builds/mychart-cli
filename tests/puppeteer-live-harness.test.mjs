import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_MYCHART_URL,
  createHarnessSession,
  createPuppeteerLaunchOptions,
  resolveHarnessPaths,
} from '../scripts/puppeteer-live-harness-lib.mjs';
import {
  createComputerUseAlignmentChecklist,
} from '../scripts/init-live-harness.mjs';

test('default MyChart harness target is Example Children\'s', () => {
  assert.equal(DEFAULT_MYCHART_URL, 'https://mychart.example.org/mychart/Home');
});

test('resolveHarnessPaths creates repo-local profile path', () => {
  const paths = resolveHarnessPaths({ rootDir: '/repo/mychart-cli' });

  assert.equal(paths.profileDir, '/repo/mychart-cli/browser_profiles/awesome-mychart-live');
  assert.equal(paths.extensionDir, undefined);
});

test('createPuppeteerLaunchOptions starts Chrome with a repo-local CDP profile', () => {
  const options = createPuppeteerLaunchOptions({
    profileDir: '/repo/mychart-cli/browser_profiles/live',
    debugPort: '9333',
  });

  assert.equal(options.headless, false);
  assert.equal(options.userDataDir, '/repo/mychart-cli/browser_profiles/live');
  assert.equal(options.pipe, true);
  assert.equal(options.enableExtensions, undefined);
  assert.equal(options.defaultViewport, null);
  assert.equal(options.channel, 'chrome');
  assert.ok(options.args.includes('--remote-debugging-pipe'));
  assert.ok(options.args.includes('--remote-debugging-address=127.0.0.1'));
  assert.ok(options.args.includes('--remote-debugging-port=9333'));
  assert.ok(options.args.includes('--window-size=1280,900'));
  assert.ok(!options.args.some((arg) => arg.startsWith('--load-extension')));
});

test('createPuppeteerLaunchOptions supports headless harness mode', () => {
  const options = createPuppeteerLaunchOptions({
    profileDir: '/repo/mychart-cli/browser_profiles/live',
    debugPort: '9333',
    headless: true,
  });

  assert.equal(options.headless, 'new');
  assert.equal(options.enableExtensions, undefined);
  assert.ok(options.args.includes('--remote-debugging-port=9333'));
});

test('createPuppeteerLaunchOptions supports detached CDP-port harness mode', () => {
  const options = createPuppeteerLaunchOptions({
    profileDir: '/repo/mychart-cli/browser_profiles/live',
    debugPort: '9333',
    pipe: false,
  });

  assert.equal(options.pipe, false);
  assert.equal(options.detached, true);
  assert.ok(!options.args.includes('--remote-debugging-pipe'));
  assert.ok(options.args.includes('--remote-debugging-port=9333'));
});

test('createHarnessSession records CLI harness metadata', () => {
  const session = createHarnessSession({
    endpoint: 'http://127.0.0.1:9223',
    mychartUrl: 'https://mychart.example/Home',
    profileDir: '/repo/profile',
    browserPid: 42,
    startedAt: '2026-05-08T00:00:00.000Z',
  });

  assert.equal(session.endpoint, 'http://127.0.0.1:9223');
  assert.equal(session.browserPid, 42);
  assert.equal(session.profileDir, '/repo/profile');
  assert.equal(session.mychartUrl, 'https://mychart.example/Home');
});

test('Computer Use alignment checklist names the exact Chrome PID and login gate', () => {
  const lines = createComputerUseAlignmentChecklist({ browserPid: 42 });

  assert.ok(lines.some((line) => line.includes('get_app_state("com.google.Chrome")')));
  assert.ok(lines.some((line) => line.includes('PID 42')));
  assert.ok(lines.some((line) => line.includes('Only ask the user to log in')));
});
