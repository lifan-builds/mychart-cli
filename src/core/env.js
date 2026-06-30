import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { AWESOME_MYCHART_ROOT } from './paths.js';

export async function loadEnvironmentFile({
  envPath = path.join(AWESOME_MYCHART_ROOT, '.env'),
  env = process.env,
} = {}) {
  let text = '';
  try {
    text = await readFile(envPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { loaded: false, path: envPath, keys: [] };
    throw error;
  }

  const keys = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (env[key] === undefined) {
      env[key] = value;
      keys.push(key);
    }
  }

  return { loaded: true, path: envPath, keys };
}

export function getMyChartCredentialsFromEnv(env = process.env, {
  mychartUrl = '',
} = {}) {
  const provider = detectMyChartProvider(mychartUrl);
  const providerUsername = provider === 'providence'
    ? env.PROVIDENCE_MYCHART_USERNAME || env.SWEDISH_MYCHART_USERNAME || ''
    : '';
  const providerPassword = provider === 'providence'
    ? env.PROVIDENCE_MYCHART_PASSWORD || env.SWEDISH_MYCHART_PASSWORD || ''
    : '';
  const username = providerUsername || env.AWESOME_MYCHART_USERNAME || env.MYCHART_USERNAME || '';
  const password = providerPassword || env.AWESOME_MYCHART_PASSWORD || env.MYCHART_PASSWORD || '';
  const usernameKeys = provider === 'providence'
    ? 'PROVIDENCE_MYCHART_USERNAME or SWEDISH_MYCHART_USERNAME or AWESOME_MYCHART_USERNAME or MYCHART_USERNAME'
    : 'AWESOME_MYCHART_USERNAME or MYCHART_USERNAME';
  const passwordKeys = provider === 'providence'
    ? 'PROVIDENCE_MYCHART_PASSWORD or SWEDISH_MYCHART_PASSWORD or AWESOME_MYCHART_PASSWORD or MYCHART_PASSWORD'
    : 'AWESOME_MYCHART_PASSWORD or MYCHART_PASSWORD';
  return {
    username,
    password,
    available: Boolean(username && password),
    missing: [
      username ? '' : usernameKeys,
      password ? '' : passwordKeys,
    ].filter(Boolean),
  };
}

function detectMyChartProvider(mychartUrl = '') {
  return /(?:mychartwa\.providence\.org|providenceaccounts|patientportal\.spi)/i
    .test(String(mychartUrl || ''))
    ? 'providence'
    : 'default';
}
