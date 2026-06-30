#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import { initLiveHarness } from './init-live-harness.mjs';

function printSummary({ session, validation }) {
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

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log([
      'Usage:',
      '  node scripts/init-live-headless.mjs',
      '',
      'Starts the mychart-cli live harness in Chrome headless mode for agent CLI sync.',
      'If MyChart requires MFA, CAPTCHA, or device verification, stop this harness and use npm run init:live.',
    ].join('\n'));
    return;
  }

  let browser;
  try {
    const result = await initLiveHarness({ headless: true });
    browser = result.browser;
    printSummary(result);

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
