# mychart-cli public beta release

## Goal

Ship a privacy-safe, installable macOS public beta as
`@lifan-builds/mychart-cli`, with stable local storage, a synthetic demo, clear
limitations, and release-quality GitHub packaging.

## Background

- The public repository passes 203 tests but has no CI, release, tag, branch
  protection, or npm-ready package contract.
- The unscoped npm name belongs to another project.
- Current defaults resolve medical data inside the installed package.
- Public files and history contain identifiers that must be removed.

## Requirements

- The package is `@lifan-builds/mychart-cli`, the executable remains
  `mychart-cli`, and the minimum Node version is 20.
- Runtime dependencies and the npm allowlist support an installed tarball
  without shipping Trellis, agent adapters, tests, or private state.
- New installs use an OS application-data directory. `--data-dir` and
  `MYCHART_CLI_HOME` configure it; explicit paths take precedence; existing
  repo-local state remains usable without automatic moves.
- `mychart-cli demo` is offline, synthetic, and does not write patient data.
- Records, attachments, exports, pull state, and session metadata use private
  POSIX permissions where supported.
- Safe summaries omit patient names, raw portal text, clinical content, and
  identifying portal URLs.
- Documentation states macOS/Chrome beta scope, portal variance, optional PDF
  dependencies, unofficial status, and no medical advice or built-in AI.
- Public issues prohibit PHI and security reports use private advisories.
- Identifiers are replaced by synthetic examples in the final tree and removed
  from reachable public history before release.
- No live patient portal is used for release validation.

## Acceptance Criteria

- [x] Existing and new tests pass on Node 20 and 22.
- [x] A packed tarball installs in an empty directory; help and demo succeed.
- [x] The tarball contains only the production allowlist.
- [x] Tests cover path precedence, legacy compatibility, private permissions,
  demo output, and safe-summary redaction.
- [x] CI covers Node 20/22 on macOS and Ubuntu with package/privacy checks.
- [x] The tree, tarball, promotion inputs, and release history pass privacy scans.
- [x] GitHub `v0.1.0`, npm `0.1.0`, topics, security flow, and branch protection
  are verified after action-time approval.

## Out of Scope

- Hosted services, telemetry, cloud sync, diagnosis, treatment recommendations,
  and built-in LLM integrations.
- Broad Epic MyChart compatibility or non-macOS production support claims.
- Live browser, authentication, sync, export, or screenshot validation.
