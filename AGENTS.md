# mychart-cli guidance

- Keep the harness local-first and preserve patient-data, credential, browser-profile, authenticated-state, screenshot, export, and runtime privacy boundaries.
- Read the relevant privacy, browser-boundary, and verification guidance before changing those areas; do not put personal data into tracked changes or agent context.
- Run `npm test` for repository changes. Deterministic tests do not authorize live browser, authentication, sync, export, screenshot, or portal checks.
