# Bug analysis: public-beta CI determinism

## 1. Root cause category

- Category E, implicit assumption, with a Category D test-coverage gap.
- Mixed clinical date formats inherited the host timezone during sorting. The
  OCR fallback test also assumed the host was macOS. Local macOS checks did not
  exercise GitHub's UTC Linux environment.

## 2. Why the first fixes failed

1. Removing the invalid pip cache fixed workflow setup but exposed the latent
   test assumptions.
2. Adding an ID tie-breaker made ordering deterministic but changed the existing
   same-day source-order contract. UTC normalization without that tie-breaker is
   the correct fix.

## 3. Prevention mechanisms

| Priority | Mechanism | Specific action | Status |
| --- | --- | --- | --- |
| P0 | Test coverage | Run Node 20 and 22 suites with `TZ=UTC` | Done |
| P0 | Architecture | Normalize clinical date-only values before sorting | Done |
| P0 | Testability | Inject the platform for the synthetic Vision OCR stub | Done |
| P1 | Documentation | Record the contracts in `verification.md` | Done |

## 4. Systematic expansion

- Date-only comparisons elsewhere should use `normalizeClinicalDateForRange`
  instead of host-local `Date.parse` behavior.
- Optional platform features need injectable environment boundaries in tests.
- CI action cache options must match dependency manifests actually present in
  the repository.

## 5. Knowledge capture

- [x] Updated `.trellis/spec/mychart-cli/verification.md`.
- [x] Added UTC Node 20 and 22 release validation.
- [x] Added platform injection to the OCR fallback test.
- [x] Confirmed there is no generated spec-template mirror in this repository.
