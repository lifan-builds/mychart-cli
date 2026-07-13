# Verification

## Native check

Run only:

```bash
npm test
```

This is the repository's deterministic native test command.

## Trellis and workflow checks

Trellis metadata, configuration, adapters, parsers, hash ledgers, and hooks may be validated with local metadata and empty or synthetic fixtures only.

## Prohibited validation

Do not run live initialization, launch, readiness, authentication, MyChart CLI, synchronization, export, screenshot, browser, CDP, or portal checks during workflow-only validation. Do not access patient data, credential values, local stores, browser profiles, sessions, authenticated page state, screenshots, exports, or ignored runtime bodies.

An unsupported or intentionally prohibited live probe is a skipped check, not a passing check.
