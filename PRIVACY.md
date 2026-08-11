# Privacy

mychart-cli handles medical records and authenticated browser state. Treat its
data directory and every export as sensitive.

## Local-first boundary

The project has no hosted backend, account system, telemetry, cloud sync, or
built-in LLM provider. It does not send records to the project maintainer.

## Credentials and browser state

- Credentials come from environment variables or a local `.env` file.
- The CLI reads them only when `--login` is explicitly requested.
- Manual login is preferred when MFA or device verification is involved.
- The dedicated Chrome profile contains cookies and authenticated session state.
  Anyone who can read it may be able to access the signed-in portal.
- Do not back up the data directory to a shared or unencrypted cloud folder.

## Records and exports

- New installs use the operating system's per-user application-data directory.
- Existing source checkouts keep using an existing repo-local store or profile.
- Store files, attachments, exports, pull state, and harness metadata use mode
  `0600`; their directories use `0700` on POSIX systems.
- `--store`, `--profile`, `--env-file`, `--data-dir`, and
  `MYCHART_CLI_HOME` can place data elsewhere. You are responsible for the
  permissions and backup policy of that location.
- Terminal commands and shell history can reveal paths, patient filters, or
  other context. Avoid putting medical text directly on a command line.

## Downstream tools

Markdown and JSONL exports are private medical data. If you open or upload them
with another application, including an AI service, that application's privacy
and data-retention terms apply. mychart-cli cannot enforce those terms.

## Public support

Never attach records, screenshots, cookies, credentials, portal URLs, patient
names, dates of birth, or clinical excerpts to a public issue. Reproduce bugs
with synthetic values such as `Demo Patient`, `example.org`, and invented dates.
