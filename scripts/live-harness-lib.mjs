export const DEFAULT_LIVE_HARNESS_PORT = '9223';

export function createLiveHarnessEndpoint(port = DEFAULT_LIVE_HARNESS_PORT) {
  return `http://127.0.0.1:${port}`;
}

export async function getJson(endpoint, path) {
  const response = await fetch(`${endpoint}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response.json();
}

export function getVisibleTabs(tabs) {
  return tabs.filter((tab) => tab.type === 'page');
}

export function getMyChartTabs(tabs) {
  return getVisibleTabs(tabs).filter((tab) => {
    const url = String(tab.url || '');
    return /^https:\/\/[^/]*mychart/i.test(url)
      || /^https:\/\/[^/]+\/.*mychart/i.test(url);
  });
}

export function validateLiveHarnessState({ tabs, requireAuth = false }) {
  const visibleTabs = getVisibleTabs(tabs);
  const mychartTabs = getMyChartTabs(tabs);
  const errors = [];

  if (mychartTabs.length === 0) {
    errors.push('No visible MyChart tab was found. Launch the live harness and log into MyChart in that window.');
  }

  return {
    ok: errors.length === 0 && !requireAuth,
    browserOk: true,
    mychartOpen: mychartTabs.length > 0,
    authStatus: mychartTabs.length ? 'not_checked' : 'not_open',
    patientContext: null,
    needsMfa: false,
    errors,
    visibleTabs,
    mychartTabs,
  };
}
