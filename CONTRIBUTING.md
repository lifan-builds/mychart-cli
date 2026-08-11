# Contributing

Open an issue before a large compatibility change. Keep pull requests focused
and include deterministic tests for new portal shapes.

## Never submit patient data

Fixtures, logs, screenshots, issue bodies, commits, and pull requests must use
synthetic information. Do not submit patient names, dates of birth, medical
record numbers, clinical dates, hospital names tied to a patient, credentials,
cookies, authenticated URLs, or copied chart text.

Use `Demo Patient`, `example.org`, invented dates, and obviously synthetic
clinical text. Search the complete diff before committing.

## Checks

```bash
npm test
npm run check:release
git diff --check
```

Do not use a live portal or authenticated browser profile to validate a pull
request. If a portal-specific problem cannot be captured safely, describe the
DOM shape with a synthetic fixture.
