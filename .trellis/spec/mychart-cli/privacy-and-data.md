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
