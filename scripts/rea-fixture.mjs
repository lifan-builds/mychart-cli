#!/usr/bin/env node

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, '.tools', 'rea-fixture');

await rm(fixtureDir, { recursive: true, force: true });
await mkdir(fixtureDir, { recursive: true });
await cp(path.join(root, 'src'), path.join(fixtureDir, 'src'), { recursive: true });
await cp(path.join(root, 'scripts'), path.join(fixtureDir, 'scripts'), {
  recursive: true,
  filter: (source) => !source.endsWith('.env') && !source.includes('browser_profiles'),
});
await writeFile(
  path.join(fixtureDir, 'package.json'),
  `${JSON.stringify({ name: 'mychart-cli-rea-fixture', version: '0.0.0' }, null, 2)}\n`,
  'utf8',
);

console.log(fixtureDir);
