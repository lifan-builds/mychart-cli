# Scope exports to required active patient

## Goal

Make `mychart-cli export` patient-safe by carrying an exact `--require-active-patient` assertion through stored-record filtering and pull-state scope, while keeping freshness claims explicitly limited to the requested categories.

## Background

- Baby's routine workflow validated the live chart-owner context with `--require-active-patient`, but the export layer filtered the shared local store only when a separate patient filter was supplied.
- As a result, records from another stored patient could enter the date window/export or influence incremental pull state even after the live context was validated.
- `mychart-cli` already reports requested sync categories and per-category completion; the remaining documentation gap is that `freshnessSafe` can be mistaken for coverage of unsupported portal surfaces.

## Requirements

- When `requireActivePatient` is non-empty and no non-empty `patient`, `patientLabelExact`, or `patientKey` filter is supplied, derive `patientLabelExact` from the normalized required label before stored-record filtering, date-window selection, summary creation, and pull-state key construction.
- Preserve an explicit non-empty patient filter without adding or replacing it with the derived label.
- Treat empty patient-filter values as absent so they cannot suppress the safe default.
- Keep the derived label out of machine-readable safe summaries; expose only the existing `hasPatientFilter` boolean.
- Add deterministic mixed-patient tests proving the implicit filter excludes other patients and affects the pull-state scope.
- Update user documentation to state the implicit-filter behavior and that freshness applies only to requested categories/surfaces.
- Do not add messages/documents categories or new portal traversal without real route evidence and fixtures.
- Do not run the live harness, access private stores/exports, or modify Baby.

## Acceptance Criteria

- [x] A synthetic export with `requireActivePatient: 'Demo Child'` and no patient filter exports only exact `Demo Child` records.
- [x] The resulting safe summary reports `hasPatientFilter: true` without exposing the patient label.
- [x] The derived exact label participates in the pull-state scope key and date-window calculation.
- [x] Explicit non-empty patient filters retain their existing behavior; empty filters do not disable derivation.
- [x] README usage text defines both implicit patient scoping and category-scoped freshness limits.
- [x] `npm test` and `npm run check:release` pass without live browser or private-data access.

## Out of Scope

- New extraction support for messages, general documents, or unknown discharge-summary routes.
- Live MyChart verification or inspection of Baby's ignored imports.
- Further Baby repository changes beyond the already-pushed revert.
