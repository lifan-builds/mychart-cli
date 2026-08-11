import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getMyChartTabs,
  validateLiveHarnessState,
} from '../scripts/live-harness-lib.mjs';

test('getMyChartTabs detects visible MyChart tabs by URL only', () => {
  const tabs = [
    { type: 'page', title: 'Inbox', url: 'https://example.test/' },
    { type: 'page', title: 'MyChart - Home', url: 'https://example.test/home' },
    { type: 'page', title: 'Alternate MyChart', url: 'https://mychart.example.org/mychart/Home' },
    { type: 'service_worker', title: 'MyChart worker', url: 'https://mychart.example/sw.js' },
  ];

  assert.deepEqual(getMyChartTabs(tabs), [tabs[2]]);
});

test('validateLiveHarnessState passes with a MyChart target', () => {
  const state = validateLiveHarnessState({
    tabs: [
      { type: 'page', title: 'MyChart - Home', url: 'https://mychart.example.org/mychart/Home' },
    ],
  });

  assert.equal(state.ok, true);
  assert.equal(state.browserOk, true);
  assert.equal(state.mychartOpen, true);
  assert.equal(state.authStatus, 'not_checked');
  assert.deepEqual(state.errors, []);
  assert.equal(state.mychartTabs.length, 1);
});

test('validateLiveHarnessState reports missing MyChart target', () => {
  const state = validateLiveHarnessState({
    tabs: [
      { type: 'page', title: 'Example', url: 'https://example.test/' },
    ],
  });

  assert.equal(state.ok, false);
  assert.equal(state.errors.length, 1);
  assert.match(state.errors[0], /No visible MyChart tab/);
});
