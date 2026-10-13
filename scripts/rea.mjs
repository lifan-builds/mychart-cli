#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '6.4.0';
const sharedEntry = path.join(os.homedir(), '.agents', 'rea', 'rea-agents', 'scripts', 'rea.mjs');
const localEntry = path.join(root, '.tools', 'rea-agents', 'scripts', 'rea.mjs');
const args = process.argv.slice(2);

const command = existsSync(sharedEntry)
  ? { executable: path.join(os.homedir(), '.agents', 'rea', 'runtime', 'bin', 'node'), args: [sharedEntry, ...args] }
  : existsSync(localEntry)
    ? { executable: process.execPath, args: [localEntry, ...args] }
  : { executable: 'npx', args: ['--yes', '--package', `rea-agents@${version}`, 'rea', ...args] };

const child = spawn(command.executable, command.args, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`Could not start REA. Run npm run rea -- --help after installing Node.js 22.19+ or 24.11+.`);
  console.error(error.message);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
