# Verification

## Native check

Run only:

```bash
npm test
npm run check:release
```

This is the repository's deterministic native test command.

Before a package release, also install the packed tarball into an empty
temporary prefix and execute `mychart-cli --help` plus `mychart-cli demo` through
the generated npm bin link. Directly running `node src/cli.mjs` is not a
substitute because it does not exercise symlinked invocation.

## Cross-platform determinism

- Run the full suite on Node 20 and 22 with `TZ=UTC` before release. Clinical
  date-only values must be normalized before sorting; mixed display and ISO
  formats must not inherit the runner's local timezone.
- Records on the same normalized clinical day preserve source order unless an
  explicit product contract defines another tie-breaker.
- Tests for macOS-only Vision OCR inject `platform: 'darwin'` when using a stub.
  Production behavior continues to default to `process.platform` and must not
  enable Vision OCR on Linux.
- Do not enable the `setup-python` pip cache unless the repository contains a
  supported Python dependency manifest such as `requirements.txt` or
  `pyproject.toml`.

## Trellis and workflow checks

Trellis metadata, configuration, adapters, parsers, hash ledgers, and hooks may be validated with local metadata and empty or synthetic fixtures only.

## Prohibited validation

Do not run live initialization, launch, readiness, authentication, MyChart CLI, synchronization, export, screenshot, browser, CDP, or portal checks during workflow-only validation. Do not access patient data, credential values, local stores, browser profiles, sessions, authenticated page state, screenshots, exports, or ignored runtime bodies.

An unsupported or intentionally prohibited live probe is a skipped check, not a passing check.
