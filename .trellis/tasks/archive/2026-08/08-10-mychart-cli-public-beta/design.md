# Design

## Package and CLI

- Publish a scoped package with a `bin` mapping to the existing entrypoint.
- Add a no-network demo backed by in-memory synthetic records.
- Resolve paths through one injectable resolver. Precedence is explicit CLI
  path, `--data-dir`, `MYCHART_CLI_HOME`, existing checkout-local artifacts,
  then the platform data directory.

## Privacy

- Centralize private directory/file creation with modes `0700` and `0600`.
- Apply it to stores, exports, attachments, pull state, and harness metadata.
- Return status enums and irreversible context tokens instead of raw patient or
  portal strings in outputs documented as safe.

## Distribution and history

- Use npm `files` as the package allowlist and validate the packed manifest.
- Add deterministic CI without live-portal access.
- After review, create one parentless commit with the final tree and force-push
  public `main` with an exact lease, then remove refs to old public history.

## Compatibility

- Existing checkout-local data wins only when legacy artifacts exist.
- Existing store, profile, and environment-file options remain available.
- OCR stays optional; macOS Vision is the only OCR fallback.
