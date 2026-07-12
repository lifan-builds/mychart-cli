# mychart-cli

mychart-cli is a local-first CLI for extracting patient-owned
MyChart records through a dedicated Chrome/Puppeteer harness. It is designed for
local agents and downstream repos that need reliable access to records the user
can already view in MyChart.

It is no longer a Chrome extension. The old popup/dashboard/Manifest V3 product
path has been deprecated and removed.

## What Stays Local

- Credentials are read from a gitignored `.env` only when `--login` is used.
- Raw records are stored in `.awesome-mychart/store.json`, which is gitignored.
- Exports are written only when requested.
- There is no built-in Ask AI or LLM provider path; use exports with your own
  local agent workflow.

## Setup

```bash
npm install
```

Optional `.env` keys:

```bash
AWESOME_MYCHART_USERNAME=...
AWESOME_MYCHART_PASSWORD=...
AWESOME_MYCHART_URL=https://mychart.example.org/mychart/Home

# Optional alternate portal credentials for a second MyChart site.
PROVIDENCE_MYCHART_USERNAME=...
PROVIDENCE_MYCHART_PASSWORD=...
```

The legacy `MYCHART_USERNAME` and `MYCHART_PASSWORD` names are still accepted as
fallbacks. Alternate portal credentials are preferred only when the configured
MyChart URL matches that portal.

## Live Harness

Start a visible Chrome harness when MFA, CAPTCHA, or device verification may be
needed:

```bash
npm run init:live
```

Start a headless harness for unattended runs when the dedicated profile is
already trusted:

```bash
npm run init:live:headless
```

Check readiness:

```bash
npm run check:live
npm run validate:live
npm run mychart -- browser ensure --headless --validate --wait
```

The default MyChart URL is a placeholder. Set `AWESOME_MYCHART_URL` to the
portal you can already access in a browser before running live sync commands.

## CLI

```bash
npm run mychart -- --help
npm run mychart -- browser ensure --headless --validate --wait
npm run mychart -- browser validate
npm run mychart -- sync --login --categories visits,test-results --require-active-patient Felix --timeout-seconds 600
npm run mychart -- records list --category test-results
npm run mychart -- export jsonl --latest-day --output /tmp/mychart.jsonl
npm run mychart -- export jsonl --sync --since-last-pull --pull-state /tmp/mychart-state.json --output-dir /tmp --json-summary
npm run mychart -- export inspect /tmp/mychart.jsonl
npm run mychart -- export markdown --latest-day --output /tmp/mychart.md
```

Sync defaults to strict adaptive traversal: requested discovery pages refresh,
recognized visit/result details are traversed, and trend/static/auth/language
routes are rejected. Credible unrecognized clinical routes trigger bounded
fallback in the same run. `--exhaustive` starts that bounded mode directly and
`--max-broad-pages` changes its default 25-page budget. Summaries expose
completion reason, truncation, freshness safety, effective mode, sanitized route
and timing counts, and inserted/updated/unchanged/deleted deltas.

`--require-active-patient` validates the exact active browser context before any
crawl/store mutation. Checkpointed partial output remains usable after caps or
interruptions, but pull state and last-safe-sync metadata advance only after a
freshness-safe exact category/context scope. `--categories` also filters export
records. Seattle Children's result-shaped legacy `health-summary` records are
read-normalized to `test-results`.

Use `export jsonl` for agent ingestion. The JSONL file starts with a manifest
line, then emits record metadata lines and deterministic text chunk lines.
`export inspect` counts record and chunk lines separately and summarizes
categories, clinical dates, source hosts, duplicate record keys, and top titles.
Use Markdown only for human review or legacy workflows.

Use `--json-summary` when another agent or script needs safe metadata on stdout:
output path, record and chunk counts, selected clinical date range, category and
source-host counts, sync status counts, pull-state status, and export-friendly
safe summary fields such as latest clinical date, visit-note titles, key test
names, and likely downstream files to update. The summary does not include raw record
text or chunk text.

`--latest-day` chooses the newest non-future clinical date from the current
filters. Use explicit `--start-date`/`--end-date` when you intentionally need
future-dated or upcoming records.

The compatibility wrapper remains available:

```bash
npm run export:recent -- --login --sync --latest-day --categories test-results
```

`npm run export:recent` and the CLI both default to the agent JSONL format;
pass `--format markdown` only for a legacy human-readable export.

## Agent Library

Downstream repos should keep using `scripts/mychart-cli-lib.mjs`.
It now drives the CLI/Puppeteer modules and JSON store instead of a Chrome
extension dashboard.

## Project Structure

```text
src/cli.mjs                    agent-facing CLI
src/browser/                   Puppeteer sync runner
src/extraction/                MyChart DOM parser injected into pages
src/core/                      identity, quality, JSONL/Markdown export, record filtering
src/storage/                   atomic JSON local store
scripts/                       live harness and compatibility wrappers
tests/                         node:test regression coverage
docs/live-harness.md           operational harness notes
```

## Development

```bash
npm test
node --check src/cli.mjs
node --check scripts/mychart-cli-lib.mjs
```
