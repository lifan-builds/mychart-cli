# Live harness

mychart-cli uses a dedicated Chrome/Puppeteer profile for authenticated MyChart
work. It never reuses the user's normal Chrome profile.

## Commands

Visible harness:

```bash
mychart-cli browser start --visible
```

Headless harness:

```bash
mychart-cli browser start --headless
```

Readiness and auth checks:

```bash
mychart-cli browser check
mychart-cli browser validate
mychart-cli browser ensure --headless --validate --wait
```

`check:live` verifies local CDP and a MyChart tab. `validate:live` and
`browser ensure --validate` also inspect the MyChart page state and separate
browser reachability from authentication with fields such as `browserOk`,
`mychartOpen`, `authStatus`, `patientContext`, and `needsMfa`.

Default profile on macOS:

```text
~/Library/Application Support/mychart-cli/browser-profile
```

Default CDP endpoint:

```text
http://127.0.0.1:9223
```

Default MyChart target:

```text
https://mychart.example.org/mychart/Home
```

Set `AWESOME_MYCHART_URL` when you need a specific MyChart portal:

```bash
AWESOME_MYCHART_URL=https://mychart.example.org/mychart/Home mychart-cli browser start --visible
```

## Agent rules

- Ask the user to log in only after the visible harness Chrome PID/window is
  confirmed.
- Reuse the prepared MyChart tab; do not switch to the user's personal Chrome
  profile.
- Use headless mode only when no MFA/CAPTCHA/device verification is expected.
- Prefer `mychart-cli browser ensure --headless --validate --wait` for
  unattended agent startup; it starts the harness if needed, validates CDP plus
  MyChart auth state, prints JSON status, and exits.
- Keep credentials, browser profiles, record stores, and exports local. The
  profile contains authenticated cookies and must be protected like a password.
- If `check:live` or `validate:live` cannot reach local CDP inside the sandbox,
  rerun with local-CDP approval.

## Sync flow

The CLI connects to the session file written under the profile directory,
injects `src/extraction/extractor-core.js` into MyChart pages, navigates
category/detail pages with Puppeteer, and writes normalized records to the JSON
store.
