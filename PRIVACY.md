# Privacy

mychart-cli is local-first.

- MyChart credentials are loaded only from local environment variables or a
  gitignored `.env` when `--login` is explicitly used.
- Extracted records are stored in `.awesome-mychart/store.json`, which is
  gitignored.
- Browser profiles live under `browser_profiles/`, which is gitignored.
- Markdown and JSONL exports are written only when requested.
- No hosted backend, account system, telemetry, cloud sync, built-in Ask AI, or
  LLM provider path is part of this repo.
