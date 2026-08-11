#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowedTopLevel = new Set([
  '.env.example',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'PRIVACY.md',
  'README.md',
  'SECURITY.md',
  'docs',
  'package.json',
  'scripts',
  'src',
]);

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert(packageJson.name === '@lifan-builds/mychart-cli', 'unexpected package name');
assert(packageJson.bin?.['mychart-cli'] === 'src/cli.mjs', 'missing mychart-cli bin mapping');
assert(Number(String(packageJson.engines?.node || '').match(/\d+/)?.[0] || 0) >= 20, 'Node 20+ engine is required');
assert(packageJson.dependencies?.['puppeteer-core'], 'puppeteer-core must be a runtime dependency');

const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json'], { cwd: root });
const pack = JSON.parse(stdout)[0];
for (const file of pack.files || []) {
  const topLevel = file.path.split('/', 1)[0];
  assert(allowedTopLevel.has(topLevel), `package contains non-release path: ${file.path}`);
  assert(!/(?:^|\/)(?:\.trellis|\.agents|\.claude|\.codex|tests|browser_profiles|\.awesome-mychart)(?:\/|$)/.test(file.path),
    `package contains private/development path: ${file.path}`);
}

const denylist = String(process.env.MYCHART_CLI_PUBLIC_DENYLIST || '')
  .split('||')
  .map((value) => value.trim())
  .filter(Boolean);
const secretPatterns = [
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
  /^(?:[A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET|API_KEY)[A-Z0-9_]*)[ \t]*=[ \t]*[^\r\n.\s]+/m,
  /Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/i,
];
const { stdout: repositoryFileOutput } = await execFileAsync(
  'git',
  ['ls-files', '-co', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'buffer' },
);
const repositoryFiles = repositoryFileOutput.toString('utf8').split('\0').filter(Boolean);
for (const filePath of repositoryFiles) {
  const content = await readFile(path.join(root, filePath), 'utf8').catch(() => '');
  for (const value of denylist) {
    assert(!content.toLowerCase().includes(value.toLowerCase()), `denylisted public text found in ${filePath}`);
  }
}
for (const file of pack.files || []) {
  const absolutePath = path.join(root, file.path);
  const content = await readFile(absolutePath, 'utf8').catch(() => '');
  for (const pattern of secretPatterns) assert(!pattern.test(content), `credential-like content found in ${file.path}`);
}

console.log(`Release package check passed: ${pack.entryCount} files, ${pack.unpackedSize} unpacked bytes.`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
