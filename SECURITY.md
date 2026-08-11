# Security policy

## Supported version

Security fixes target the latest published `0.1.x` beta.

## Reporting a vulnerability

Use a private [GitHub security advisory](https://github.com/lifan-builds/mychart-cli/security/advisories/new).
Do not open a public issue for a vulnerability.

Do not include patient records, credentials, cookies, authenticated URLs,
screenshots, browser profiles, or real exports. Use a minimal synthetic
reproduction. If the problem cannot be explained without sensitive data, first
describe the shape of the issue and wait for a safe exchange method.

## Security model

- The dedicated Chrome profile is a bearer of authenticated session state.
- The local record store and exports are not encrypted by mychart-cli.
- POSIX permissions reduce accidental local disclosure but do not protect a
  compromised user account or device.
- The tool reads records the signed-in user can already access. It does not
  bypass MyChart authorization.
- Downstream programs that receive an export are outside this project's trust
  boundary.
