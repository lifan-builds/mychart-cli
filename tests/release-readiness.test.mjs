import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { writePullState } from '../src/core/agent-export-workflow.js';
import { buildSyntheticDemo, formatSyntheticDemo } from '../src/core/demo.js';
import { resolveMyChartPaths } from '../src/core/paths.js';
import { writeRecordsAgentJsonlExport } from '../src/core/record-exports.js';
import { writePrivateFile } from '../src/core/private-files.js';
import { JsonMedicalStore } from '../src/storage/json-store.js';

const execFileAsync = promisify(execFile);

function permissions(stats) {
  return stats.mode & 0o777;
}

test('runtime path resolution honors configured data home', () => {
  const resolved = resolveMyChartPaths({
    dataDir: '/tmp/synthetic-mychart-home',
    packageRoot: '/package',
    homeDir: '/home/demo',
    platform: 'linux',
    env: {},
    pathExists: () => false,
  });
  assert.equal(resolved.dataHome, '/tmp/synthetic-mychart-home');
  assert.equal(resolved.storePath, '/tmp/synthetic-mychart-home/store.json');
  assert.equal(resolved.profileDir, '/tmp/synthetic-mychart-home/browser-profile');
  assert.equal(resolved.attachmentsDir, '/tmp/synthetic-mychart-home/attachments');
  assert.equal(resolved.envPath, '/tmp/synthetic-mychart-home/.env');
  assert.equal(resolved.legacy, false);
});

test('runtime path resolution preserves existing checkout-local state', () => {
  const resolved = resolveMyChartPaths({
    packageRoot: '/repo/mychart-cli',
    homeDir: '/home/demo',
    platform: 'linux',
    env: {},
    pathExists: (candidate) => candidate === '/repo/mychart-cli/.awesome-mychart/store.json',
  });
  assert.equal(resolved.storePath, '/repo/mychart-cli/.awesome-mychart/store.json');
  assert.equal(resolved.profileDir, '/repo/mychart-cli/browser_profiles/awesome-mychart-live');
  assert.equal(resolved.legacy, true);
});

test('runtime path resolution uses the platform data directory for new installs', () => {
  const mac = resolveMyChartPaths({
    packageRoot: '/package',
    homeDir: '/Users/demo',
    platform: 'darwin',
    env: {},
    pathExists: () => false,
  });
  const linux = resolveMyChartPaths({
    packageRoot: '/package',
    homeDir: '/home/demo',
    platform: 'linux',
    env: { XDG_DATA_HOME: '/data' },
    pathExists: () => false,
  });
  assert.equal(mac.dataHome, '/Users/demo/Library/Application Support/mychart-cli');
  assert.equal(linux.dataHome, '/data/mychart-cli');
});

test('medical stores, exports, and pull state use private permissions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mychart-private-files-'));
  const storePath = path.join(root, 'records', 'store.json');
  const exportPath = path.join(root, 'exports', 'records.jsonl');
  const statePath = path.join(root, 'state', 'pull.json');

  await new JsonMedicalStore({ storePath }).writeStore({ records: [], indexCards: [] });
  await writeRecordsAgentJsonlExport({ outputPath: exportPath, content: '{"kind":"synthetic"}\n' });
  await writePullState(statePath, { version: 1, scopes: {} });

  if (process.platform !== 'win32') {
    assert.equal(permissions(await stat(path.dirname(storePath))), 0o700);
    assert.equal(permissions(await stat(storePath)), 0o600);
    assert.equal(permissions(await stat(exportPath)), 0o600);
    assert.equal(permissions(await stat(statePath)), 0o600);
  }
});

test('private file writes do not narrow permissions on an existing parent directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mychart-existing-parent-'));
  const sharedDirectory = path.join(root, 'existing');
  await mkdir(sharedDirectory, { mode: 0o755 });
  if (process.platform !== 'win32') await chmod(sharedDirectory, 0o755);

  await writePrivateFile(path.join(sharedDirectory, 'private.txt'), 'synthetic\n');

  if (process.platform !== 'win32') {
    assert.equal(permissions(await stat(sharedDirectory)), 0o755);
    assert.equal(permissions(await stat(path.join(sharedDirectory, 'private.txt'))), 0o600);
  }
});

test('medical store writes do not narrow an existing caller-owned parent directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mychart-existing-store-parent-'));
  const recordsDirectory = path.join(root, 'records');
  await mkdir(recordsDirectory, { mode: 0o755 });
  if (process.platform !== 'win32') await chmod(recordsDirectory, 0o755);

  const storePath = path.join(recordsDirectory, 'store.json');
  await new JsonMedicalStore({ storePath }).writeStore({ records: [], indexCards: [] });

  if (process.platform !== 'win32') {
    assert.equal(permissions(await stat(recordsDirectory)), 0o755);
    assert.equal(permissions(await stat(storePath)), 0o600);
  }
});

test('synthetic demo is deterministic and clearly contains no real patient data', async () => {
  const demo = buildSyntheticDemo();
  const output = formatSyntheticDemo();
  assert.equal(demo.recordCount, 2);
  assert.match(output, /synthetic demo/i);
  assert.match(output, /No network, login, browser profile, or patient data is used/);
  assert.equal(output.includes('Synthetic Demo Patient'), true);

  const cli = await execFileAsync(process.execPath, ['src/cli.mjs', 'demo'], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  });
  assert.equal(cli.stderr, '');
  assert.equal(cli.stdout, `${output}\n`);
});
