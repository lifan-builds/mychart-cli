# Browser Boundary

## Profile isolation

The repository's Chrome/Puppeteer harness is separate from the user's personal Chrome profile. Browser profiles under `browser_profiles/` are local and gitignored.

- Never reuse or automate the personal Chrome profile.
- Keep repository browser profiles, sessions, and runtime links out of source control and agent context.
- Do not inspect authenticated page state unless a user explicitly requests an appropriately scoped live operation.

## Live harness constraints

MFA, CAPTCHA, and device verification can prevent unattended or headless operation. Headless success must not be assumed from deterministic tests.

Live harness commands interact with browser, authentication, and patient context. They are prohibited during workflow-only migrations and other privacy-safe metadata validation. Do not launch Chrome, connect to CDP, access the portal, authenticate, synchronize, export, or capture screenshots as part of those checks.
