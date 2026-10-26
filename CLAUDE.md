# Notes for Claude Code

The full spec is `docs/requirements-v1.1.md`. Read it before changing behavior.

## Status

- **Phase 1 (foundation): done.** Schema, roles, row-level security, audit log, seed data, magic-link auth, and a status page.
- **Phase 2 (engine): done.** `lib/engine/` with 31 tests covering every worked example in spec Section 3.8.
- **Phase 3 (evidence flow): done.** Submit form (`/evidence/new`), pending/arbiter queue (`/queue`), evidence log (`/evidence`), detail page with the exact math, discussion and the arbiter review panel (`/evidence/[id]`), and edit/resubmit for the submitter (`/evidence/[id]/edit`). Migration `0002_evidence_flow.sql` adds the RPCs `submit_evidence`, `resubmit_evidence` and `review_evidence` so an item and its claim tags change in one transaction.
- **Phase 4 (dashboard): done.** `/` shows the headline with a B-loose/B-strict toggle (`?view=strict`) and the ruling line, per-claim cards (A with a Satisfied badge, both B views, C as a separate "tracked only" card), the history chart, a countdown and the pending count. The chart (`app/(app)/HistoryChart.tsx`) is hand-drawn SVG with no chart library: a step line by event date, one marker per date that moved the headline (▲ YES, ▼ NO, hollow = added late, ◆ decay, ■ Claim A satisfied), crosshair and tooltip on hover and arrow keys, and a table view. `lib/dashboard/chart.ts` shapes engine history into chart data (pure, tested).
- **Phase 5 (governance): done.**
  - `/rules`: current definitions, version history, change requests with each member's approval, forms to propose definition or prior changes, the settings and strength scale, and Shaun's recalibration form.
  - `/queue`: adds Shaun's controls to waive or revoke a month's decay step and to mark or reverse Claim A satisfied.
  - `/audit`: the audit log in plain sentences, filterable by kind.
  - `/evidence`: now the full Evidence Log, with decay steps as system entries and filters for type, status, claim, direction, strength, submitter and date.
  - `/export/{wager-export.json,evidence.csv,history.csv}`: one-click exports.
  - Migration `0003_governance.sql` holds the rules.
- **Next: Phase 6 (polish).** Mobile layout pass, activity feed, resolution mode (Shaun's final ruling).

The app has been installed, typechecked, built and driven end to end (submit → request changes → resubmit → approve → headline recomputes) against Postgres with RLS on.

## Rules of the codebase

- The engine (`lib/engine/`) is pure TypeScript with no dependencies. Keep it that way. Probability history is never stored; it is recomputed from config, approved evidence, arbiter actions and today's date.
- Engine files use explicit `.ts` import extensions and erasable-only syntax (no enums, no parameter properties) so `node --test` runs them directly.
- Database rules live in the database (RLS policies and triggers in `supabase/migrations/`), not only in the UI. Any new rule gets a case in `supabase/tests/policies_test.sql`.
- Nothing is deleted from the UI. The audit log and arbiter actions are append-only.
- Shaun's final ruling decides the bet; the UI must say so wherever the headline appears.
- Write paths that touch more than one table go through a database function (see `0002_evidence_flow.sql`), not several client calls. Functions are `security invoker` so RLS and guard triggers still apply.
- Form parsing and validation live in `lib/evidence/form.ts` and `lib/governance/forms.ts` (pure, unit-tested); the database repeats the important rules.
- Forms whose action can fail use `ActionForm` (`app/(app)/ActionForm.tsx`), which submits without React's automatic form reset so typed text survives an error.

## Commands

- `npm test`: engine and data-mapping unit tests (Node's built-in runner).
- `scripts/test-db.sh`: runs migration, seed and database rule tests against a throwaway Postgres (set PGHOST/PGPORT/PGUSER).
- `npm run dev`, `npm run build`, `npm run typecheck`.

## Decisions already made (from the spec review)

- Correlation discount is set per claim tag, not per item.
- Decay steps fall at month end in America/Chicago. The partial month of October 2026 gets no step; the first is 2026-11-30. With default dates that's 59 steps, ending near 36.6% for Claim A with no qualifying YES evidence.
- Only YES evidence tagged to Claim A, at final strength 3 or higher, skips a month's decay step.
- Evidence dated before the bet start (2026-10-21) is excluded from the chain.
- Sign-in is email magic links via Supabase; the database rejects any email not in `members`.
- Priors change only through a change request approved by both bettors and the arbiter. Other config (LRs, decay) the arbiter can change directly. Definitions need all three approvals.
- When the arbiter removes a claim tag on review, the row is kept with `dropped = true` and never reaches the engine. Tags he adds have null proposed values.
- Event dates can't be in the future (checked in the database against the config time zone). Only the arbiter can mark an item as expert-forecast evidence.
- The arbiter can re-review an approved item (change final values, links, note); each change is audited and the chain recomputes on the next page load.
- Chart markers count only steps that moved the selected headline view: Claim A or that view's B claim, applied, with a real effect. Skipped/waived decay and Claim C never get a marker.
- Chart colours: YES blue, NO red (validated for colour-vision deficiency in light and dark), always paired with a shape, so colour is never the only cue.
- Every config version is validated in the database (`validate_config`), because a bad config would break every page. Direct changes need a note. Priors, start and resolution dates, time zone and combination rule can't change directly; dates have no change-request path yet.
- A change request is opened with `propose_change`, which records the proposer's approval in the same transaction. Any rejection closes it.
- Decay waivers can be revoked (`decay_waiver_revoked`); the latest waiver or revocation per month wins. Claim A can only be marked satisfied when it isn't already, must link approved evidence, and must be dated between the bet start and today; it can only be reversed while satisfied.
- CSV exports prefix text cells that start with `=`, `+`, `-` or `@` with `'` so a spreadsheet won't run them as formulas.
