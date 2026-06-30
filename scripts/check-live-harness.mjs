#!/usr/bin/env node

import {
  DEFAULT_LIVE_HARNESS_PORT,
  createLiveHarnessEndpoint,
  getJson,
  getMyChartTabs,
  getVisibleTabs,
} from './live-harness-lib.mjs';

const port = process.env.AWESOME_MYCHART_DEBUG_PORT || DEFAULT_LIVE_HARNESS_PORT;
const endpoint = createLiveHarnessEndpoint(port);

try {
  const version = await getJson(endpoint, "/json/version");
  const tabs = await getJson(endpoint, "/json/list");
  const visibleTabs = getVisibleTabs(tabs);
  const mychartTabs = getMyChartTabs(tabs);

  console.log(`CDP endpoint: ${endpoint}`);
  console.log(`Browser: ${version.Browser || "unknown"}`);
  console.log(`User agent: ${version["User-Agent"] || "unknown"}`);
  console.log(`Page tabs: ${visibleTabs.length}`);
  console.log(`MyChart tabs: ${mychartTabs.length}`);

  for (const tab of visibleTabs) {
    console.log(`- ${tab.title || "(untitled)"} :: ${tab.url}`);
  }
} catch (error) {
  console.error(`Unable to reach mychart-cli live harness at ${endpoint}.`);
  console.error(error.message);
  process.exit(1);
}
