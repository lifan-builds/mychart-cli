# REA workflow for MyChart extraction

This repository uses [REA](https://github.com/morluto/rea) 6.4.0 as an
optional, local analysis tool. The shared Codex-managed installation lives
under `/Users/lfan/.agents/rea`; project wrappers prefer it so every trusted
project uses one version. A project-local `.tools/` copy remains only as a
compatibility fallback, and the wrapper can fall back to the official
`rea-agents` package:

```sh
npm run rea -- --help
```

The shared Codex registration is managed with:

```sh
/Users/lfan/.agents/rea/bin/rea doctor --json
```

REA requires Node.js 22.19+, 24.11+, or a later supported release. The normal
mychart-cli runtime does not depend on REA.

## Safe source analysis

Build a source-only fixture before static analysis. It copies `src/` and the
browser/sync scripts, while excluding local stores, browser profiles,
attachments, screenshots, exports, and environment files:

```sh
npm run rea:fixture
npm run rea -- analyze-javascript-application .tools/rea-fixture \
  --artifact-format directory --json
```

Keep the JSON result under `.tools/`; it is analysis output and may contain
source paths. Do not run the analyzer against the repository root because the
root can contain `.awesome-mychart/` and other private data.

## Network-first investigation plan

Use REA against one exact, already authenticated MyChart tab only after the
user has opened the tab. Keep the capture local and collect request metadata and
JSON shapes, not response bodies or screenshots:

```sh
npm run rea -- list-browser-targets http://127.0.0.1:9223 --json
npm run rea -- inspect-web-page http://127.0.0.1:9223 TARGET_ID \
  --observation-ms 10000 --include-json-body-shapes --json
```

Start the capture, perform one read-only action such as opening a single visit
or test result, then stop and inspect the evidence. The useful result is a
stable same-origin route, method, status, content type, JSON shape, and script
initiator. Redact any patient or encounter identifiers before sharing or
tracking the result. Never place records, credentials, cookies, or raw portal
payloads in Git.

## Efficiency work

The current extractor is DOM-first and already has a conservative link queue.
The first local pass now implements the low-risk DOM/browser reductions:

- Visit-note frame scans skip obvious utility frames, prioritize clinical URLs,
  restrict work to the validated MyChart origin, and inspect at most eight
  frames.
- Frame extraction tries visible text first and only performs the deep shadow DOM
  walk when the visible pass is empty or short.
- Visit-note DOM extraction avoids walking the document twice when the selected
  scope is already `body` or `documentElement`.
- The extractor source is assembled once per process and only installed when a
  same-origin page or frame lacks it, instead of retransferring six module files
  for every extraction.
- Patient-context selector results and page body text are deduplicated before
  parsing.
- Navigation waits for a route/content sentinel, then uses a short network-idle
  settle rather than a fixed five-second tail.
- Imaging is now an explicit sync category; its test-result detail routes are
  admitted through the same strict route checks while the extractor keeps the
  imaging category for filtering.

The remaining REA investigation should validate these changes and then consider
the higher-impact network path:

1. **Network-first detail reads.** If a read-only action consistently exposes a
   same-origin JSON endpoint, add a category-specific request reader that uses
   the existing authenticated page context and keeps the DOM parser as a
   fallback. This should reduce page navigations and repeated shell parsing.

The network endpoint remains unverified until a local capture proves its request
shape. Add it only with a synthetic response test and the existing DOM fallback.

## Repeatable checks

Run the readiness check before an analysis pass:

```sh
npm run rea:doctor
npm run rea:fixture
npm run rea -- analyze-javascript-application .tools/rea-fixture \
  --artifact-format directory --json
```

REA supports Node.js 22.19+, 24.11+, or 26+. If `rea:doctor` reports an
unsupported Node version or a provider setup problem, treat the analysis as
unavailable/partial and do not promote its unknowns into extraction changes.
