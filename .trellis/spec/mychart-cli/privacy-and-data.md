# Privacy and Data

## Local-first boundary

mychart-cli operates locally. It does not provide a hosted backend, account system, telemetry, or cloud synchronization.

## Credentials

- Credentials come from the local environment or a gitignored `.env` file.
- Credential use occurs only when the user explicitly requests login with `--login`.
- Never commit, log, copy into specifications, or otherwise expose credential values.

## Stored records

Extracted records are stored locally in the gitignored `.awesome-mychart/store.json`. Treat that store as private patient data: do not inspect, copy, stage, or include it in agent context.

## Exports

Markdown and JSONL exports are created only when requested. Treat exports as private data and keep them out of source control, specifications, examples, and migration evidence.

## Features not present

The project has no built-in Ask AI capability or LLM provider path. Do not infer or introduce hosted processing, telemetry, cloud sync, or AI data transfer without an explicit product decision and updated privacy documentation.

## Scenario: runtime data home and private writes

### 1. Scope / Trigger

- Trigger: any CLI, storage, browser, attachment, export, or state change that
  chooses a runtime path or writes medical/session data.

### 2. Signatures

- CLI: `--data-dir PATH`; existing `--store`, `--profile`, and `--env-file`.
- Environment: `MYCHART_CLI_HOME`.
- Resolver: `resolveMyChartPaths({ dataDir, env, packageRoot, platform, homeDir, pathExists })`.
- Writers: `ensurePrivateDirectory(path)` and `writePrivateFile(path, data, options)`.

### 3. Contracts

- Precedence: explicit store/profile/env path, then `--data-dir`, then
  `MYCHART_CLI_HOME`, then existing checkout-local artifacts, then the platform
  application-data directory.
- New private directories use POSIX mode `0700`; sensitive files use `0600`.
- Writing a file inside an existing caller-owned directory must not chmod that
  parent directory.
- Existing repo-local records and profiles are detected, not moved.
- Machine summaries expose counts/status only; patient labels, raw portal text,
  queries, clinical titles, and source hosts stay out of safe stdout payloads.

### 4. Validation & Error Matrix

- Missing required path argument -> throw the existing `... is required` error.
- Unsupported chmod semantics on Windows -> keep the write and skip POSIX mode enforcement.
- `ENOSYS`, `ENOTSUP`, or `EPERM` during chmod -> keep the successful write.
- Other filesystem errors -> propagate to the caller.

### 5. Good/Base/Bad Cases

- Good: a package install without prior data resolves to the OS application-data directory.
- Base: a source checkout with an existing legacy store keeps using that store.
- Bad: resolving a default store under `node_modules` or changing an existing
  export directory from `0755` to `0700`.

### 6. Tests Required

- Assert configured, legacy, macOS, and XDG path resolution.
- Assert store/export/pull-state file modes and newly created directory modes.
- Assert an existing parent directory keeps its original mode.
- Assert a JSON summary contains no patient label or source hostname.
- Smoke-test the packed npm bin, because source invocation does not exercise
  npm's symlinked executable path.

### 7. Wrong vs Correct

#### Wrong

```js
const storePath = path.join(packageRoot, '.awesome-mychart', 'store.json');
await chmod(path.dirname(userOutputPath), 0o700);
```

#### Correct

```js
const { storePath } = resolveMyChartPaths();
await writePrivateFile(userOutputPath, content);
```
