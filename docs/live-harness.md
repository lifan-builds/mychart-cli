# Live Harness

mychart-cli uses a repo-local Chrome/Puppeteer harness for authenticated
MyChart work. The harness is intentionally separate from the user's normal
Chrome profile.

## Commands

Visible harness:

```bash
npm run init:live
```

Headless harness:

```bash
npm run init:live:headless
```

Readiness and auth checks:

```bash
npm run check:live
npm run validate:live
npm run mychart -- browser ensure --headless --validate --wait
```

`check:live` verifies local CDP and a MyChart tab. `validate:live` and
`browser ensure --validate` also inspect the MyChart page state and separate
browser reachability from authentication with fields such as `browserOk`,
`mychartOpen`, `authStatus`, `patientContext`, and `needsMfa`.

Default profile:

```text
browser_profiles/awesome-mychart-live
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
AWESOME_MYCHART_URL=https://mychart.example.org/mychart/Home npm run init:live
```

## Agent Rules

- Ask the user to log in only after the visible harness Chrome PID/window is
  confirmed.
- Reuse the prepared MyChart tab; do not switch to the user's personal Chrome
  profile.
- Use headless mode only when no MFA/CAPTCHA/device verification is expected.
- Prefer `npm run mychart -- browser ensure --headless --validate --wait` for
  unattended agent startup; it starts the harness if needed, validates CDP plus
  MyChart auth state, prints JSON status, and exits.
- Keep credentials, browser profiles, and `.awesome-mychart/store.json` local
  and gitignored.
- If `check:live` or `validate:live` cannot reach local CDP inside the sandbox,
  rerun with local-CDP approval.

## Sync Flow

The CLI connects to the session file written under the profile directory,
injects `src/extraction/extractor-core.js` into MyChart pages, navigates
category/detail pages with Puppeteer, and writes normalized records to the JSON
store.
