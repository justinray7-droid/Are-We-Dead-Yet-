# Notes for Claude Code

The full spec is `docs/requirements-v1.1.md`. Read it before changing behavior.

## Status

- **Phase 1 (foundation): done.** Schema, roles, row-level security, audit log, seed data, magic-link auth, and a status page.
- **Phase 2 (engine): done.** `lib/engine/` with 31 tests covering every worked example in spec Section 3.8.
- **Next: Phase 3 (evidence flow).** Submit form, pending queue, arbiter review, approval triggering recompute.

The Next.js app was written in a sandbox without npm access, so it has **not yet been installed, typechecked or built**. First step: `npm install`, `npm run typecheck`, `npm run build`, and fix anything that turns up. The engine and the database rules were verified there.

## Rules of the codebase

- The engine (`lib/engine/`) is pure TypeScript with no dependencies. Keep it that way. Probability history is never stored; it is recomputed from config, approved evidence, arbiter actions and today's date.
- Engine files use explicit `.ts` import extensions and erasable-only syntax (no enums, no parameter properties) so `node --test` runs them directly.
- Database rules live in the database (RLS policies and triggers in `supabase/migrations/`), not only in the UI. Any new rule gets a case in `supabase/tests/policies_test.sql`.
- Nothing is deleted from the UI. The audit log and arbiter actions are append-only.
- Shaun's final ruling decides the bet; the UI must say so wherever the headline appears.

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
