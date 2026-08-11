# mychart-cli Project Guidelines

These guidelines capture the repository's documented privacy, browser, and verification boundaries for agent work.

## Pre-Development Checklist

1. Read [Privacy and Data](privacy-and-data.md) before changing credential, storage, export, or service behavior.
2. Read [Browser Boundary](browser-boundary.md) before changing the live harness or browser integration.
3. Read [Verification](verification.md) before selecting checks.
4. Keep patient data, credentials, browser profiles, authenticated state, screenshots, exports, and runtime files out of tracked changes and agent context.

## Topics

- [Privacy and Data](privacy-and-data.md) — local-first operation, credential inputs, local storage, requested exports, and absent hosted features.
- [Browser Boundary](browser-boundary.md) — isolation of the repository harness from personal Chrome and constraints on live use.
- [Verification](verification.md) — the permitted native test and privacy-safe validation boundaries.

## Quality Check

- Confirm changes preserve the documented local-first and private-data boundaries.
- Confirm no credential, patient, profile, session, screenshot, export, or runtime content entered the diff.
- Run `npm test` as the repository-native check.
- Do not substitute a live, browser, authentication, sync, export, screenshot, or portal check for deterministic tests.
