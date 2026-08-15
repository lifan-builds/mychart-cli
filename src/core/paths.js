import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AWESOME_MYCHART_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function getPlatformDataHome({
  env = process.env,
  platform = process.platform,
  homeDir = os.homedir(),
} = {}) {
  if (platform === 'darwin') return path.join(homeDir, 'Library', 'Application Support', 'mychart-cli');
  if (platform === 'win32') {
    return path.join(env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), 'mychart-cli');
  }
  return path.join(env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'), 'mychart-cli');
}

export function resolveMyChartPaths({
  dataDir = '',
  env = process.env,
  packageRoot = AWESOME_MYCHART_ROOT,
  platform = process.platform,
  homeDir = os.homedir(),
  pathExists = existsSync,
} = {}) {
  const configuredHome = dataDir || env.MYCHART_CLI_HOME || '';
  const legacyStorePath = path.join(packageRoot, '.awesome-mychart', 'store.json');
  const legacyProfileDir = path.join(packageRoot, 'browser_profiles', 'awesome-mychart-live');
  const useLegacyRoot = !configuredHome
    && (pathExists(legacyStorePath) || pathExists(legacyProfileDir));
  const dataHome = path.resolve(configuredHome || (
    useLegacyRoot ? packageRoot : getPlatformDataHome({ env, platform, homeDir })
  ));

  if (useLegacyRoot) {
    return {
      dataHome,
      storePath: legacyStorePath,
      attachmentsDir: path.join(packageRoot, '.awesome-mychart', 'attachments'),
      profileDir: legacyProfileDir,
      envPath: path.join(packageRoot, '.env'),
      legacy: true,
    };
  }

  return {
    dataHome,
    storePath: path.join(dataHome, 'store.json'),
    attachmentsDir: path.join(dataHome, 'attachments'),
    profileDir: path.join(dataHome, 'browser-profile'),
    envPath: path.join(dataHome, '.env'),
    legacy: false,
  };
}

const DEFAULT_PATHS = resolveMyChartPaths();

export const DEFAULT_DATA_HOME = DEFAULT_PATHS.dataHome;
export const DEFAULT_LIVE_PROFILE_DIR = DEFAULT_PATHS.profileDir;
export const DEFAULT_STORE_PATH = DEFAULT_PATHS.storePath;
export const DEFAULT_ATTACHMENTS_DIR = DEFAULT_PATHS.attachmentsDir;
export const DEFAULT_ENV_PATH = DEFAULT_PATHS.envPath;
export const DEFAULT_TIMEOUT_SECONDS = 600;
export const DEFAULT_POLL_INTERVAL_SECONDS = 5;
export const DEFAULT_MAX_SYNC_AGE_MINUTES = 26 * 60;
