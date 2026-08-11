# Implementation

1. Add path and private-file helpers with tests.
2. Update storage, export, attachment, pull-state, and harness writers.
3. Add package metadata, production allowlist, and the demo command.
4. Replace identifying documentation, comments, and fixtures.
5. Rewrite release/privacy docs and add PHI-safe issue templates.
6. Add CI and local package/privacy validation.
7. Run Node 20/22 tests, audit, tarball install, scans, and diff review.
8. Commit owned files and stop before force-push, npm publish, GitHub release,
   settings changes, or public promotion.

## Validation

- `npm test`
- Node 20 and 22 test runs
- `npm audit --omit=dev`
- `npm pack --dry-run --json`
- packed-tarball help/demo smoke test
- tracked-file and reachable-history privacy scans
- `git diff --check`
