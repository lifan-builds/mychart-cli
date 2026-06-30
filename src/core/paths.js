import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AWESOME_MYCHART_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_LIVE_PROFILE_DIR = path.join(
  AWESOME_MYCHART_ROOT,
  'browser_profiles',
  'awesome-mychart-live',
);
export const DEFAULT_STORE_PATH = path.join(AWESOME_MYCHART_ROOT, '.awesome-mychart', 'store.json');
export const DEFAULT_ATTACHMENTS_DIR = path.join(AWESOME_MYCHART_ROOT, '.awesome-mychart', 'attachments');
export const DEFAULT_TIMEOUT_SECONDS = 600;
export const DEFAULT_POLL_INTERVAL_SECONDS = 5;
export const DEFAULT_MAX_SYNC_AGE_MINUTES = 26 * 60;
