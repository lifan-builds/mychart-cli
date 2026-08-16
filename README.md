# mychart-cli

mychart-cli is an unofficial, local-first command-line tool for exporting
records that you can already view in an Epic MyChart portal. It uses a dedicated
Chrome profile, keeps credentials and records on your computer, and exports
Markdown or JSONL for workflows you control.

This is a public beta for macOS and Google Chrome. MyChart portals differ, so a
workflow that works on one hospital's portal may need adaptation on another.
The project is not affiliated with Epic Systems or any health care provider.
It does not provide medical advice.

## Try it without a MyChart account

```bash
npx @lifan-builds/mychart-cli demo
```

The demo is deterministic and synthetic. It does not start Chrome, access the
network, create a browser profile, or write a record store.

## Install

Node.js 20 or newer and Google Chrome are required.

```bash
npm install --global @lifan-builds/mychart-cli
mychart-cli --help
```

For source development:

```bash
git clone https://github.com/lifan-builds/mychart-cli.git
cd mychart-cli
npm install
npm run mychart -- demo
```

## Configure

Set the portal URL in your shell or in the default private data directory:

```bash
mkdir -p "$HOME/Library/Application Support/mychart-cli"
cp .env.example "$HOME/Library/Application Support/mychart-cli/.env"
chmod 600 "$HOME/Library/Application Support/mychart-cli/.env"
```

Then edit the file and set:

```dotenv
AWESOME_MYCHART_URL=https://mychart.example.org/mychart/Home
```

You can log in manually in the dedicated Chrome window. Username and password
variables are optional and used only when you explicitly pass `--login`.

`MYCHART_CLI_HOME` or `--data-dir PATH` changes the private data directory.
Explicit `--store`, `--profile`, and `--env-file` paths take precedence. An
existing source checkout with `.awesome-mychart/store.json` or the legacy
browser profile continues to use that location without moving anything.

## First sync

Start the visible browser harness:

```bash
mychart-cli browser start --visible
```

Log in and complete MFA or device verification yourself. Keep that terminal
open, then use another terminal:

```bash
mychart-cli browser validate
mychart-cli sync \
  --categories visits,test-results \
  --require-active-patient "Demo Child"
```

Use the exact chart-owner label shown by MyChart for
`--require-active-patient`. This validation happens before the store changes.
When an export also receives this option, it implicitly applies the same exact
patient-label filter unless `--patient`, `--patient-label-exact`, or
`--patient-key` is supplied. Empty patient filters do not disable that default,
so shared stored records and `--since-last-pull` state remain patient-scoped.

## Read and export records

```bash
mychart-cli records list --category test-results
mychart-cli export jsonl --latest-day --output ./mychart.jsonl
mychart-cli export markdown --latest-day --output ./mychart.md
mychart-cli export inspect ./mychart.jsonl
```

JSONL is the machine-facing format. It starts with a manifest and then writes
record metadata and deterministic text chunks. Markdown is intended for human
review. Both formats can contain sensitive medical information.

`--json-summary` prints metadata such as counts, date range, completion state,
and category totals. It omits patient names, clinical titles, raw portal text,
queries, and source hosts.

Freshness and completion claims apply only to the categories and portal
surfaces requested for that sync. A safe `visits,test-results` sync does not
establish coverage of messages, general documents, or other unrequested portal
surfaces.

## What stays local

- The project has no hosted backend, account service, telemetry, or cloud sync.
- Credentials come from your environment or a local `.env` only when `--login`
  is requested.
- The dedicated Chrome profile contains authenticated cookies and must be
  protected like a password.
- Records, downloaded attachments, exports, and state files are written with
  private permissions on POSIX systems.
- There is no built-in LLM or Ask AI feature. If you give an export to another
  program, that program's privacy policy and network behavior apply.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md) before using real
records.

## Beta limitations

- macOS with Google Chrome is the supported launch configuration.
- Epic changes portal markup and routes without notice. Compatibility varies.
- Headless mode may fail when MFA, CAPTCHA, or device verification is required.
- Embedded PDF text needs Python with `pypdf`. Image-only PDF OCR additionally
  needs the macOS Swift toolchain and Vision framework.
- Sync reads the chart available to the signed-in user. You are responsible for
  following the portal's terms and accessing only records you are authorized to
  view.

## Development

```bash
npm test
npm run check:release
```

The test suite uses synthetic fixtures. Release checks must never launch a live
portal, read an authenticated browser profile, or inspect a local record store.

## Project structure

```text
src/cli.mjs           command-line entrypoint
src/browser/          dedicated Chrome and MyChart sync boundary
src/extraction/       MyChart DOM extraction
src/core/             filtering, export, paths, privacy helpers
src/storage/          atomic local JSON store
scripts/              harness and release helpers
tests/                synthetic regression tests
```

MIT licensed. Bug reports and contributions are welcome, but never include
patient data, credentials, screenshots, authenticated URLs, or real exports.
