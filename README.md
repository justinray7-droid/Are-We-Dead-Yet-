# 2031 AI Wager Tracker

A private web app for Alex, Justin and Shaun to track a five-year bet on autonomous AI research. Bettors submit dated, sourced evidence; Shaun approves and rates it; a Bayesian engine moves the probability. Shaun's final ruling in October 2031 decides the bet.

Spec: `docs/requirements-v1.1.md`.

## What's built

- **Probability engine** (`lib/engine/`): odds updating, strength scale, correlation discounts, multi-claim tags, monthly decay on Claim A with skips and waivers, the Claim A satisfied override, caps, and backdated flags. Fully tested.
- **Database** (`supabase/`): tables, roles, row-level security, append-only audit log, change requests with three-way approval, and seed data. Rules tested on Postgres.
- **App shell**: magic-link sign-in limited to three members, and a status page showing live probabilities.
- **Evidence flow**: bettors submit dated, sourced evidence; everyone sees the pending queue and can comment; Shaun approves (setting final direction, strength, correlation discount and links), rejects with a reason, or requests changes; approval recomputes every probability. Each item's page shows the exact math of its effect.
- **Governance**: a Rules page with versioned definitions and change requests (definitions need all three approvals, priors need both bettors and Shaun), Shaun's direct recalibration of the other settings, decay waivers and the Claim A satisfied mark, a readable audit log, a filterable Evidence Log that includes decay steps, and one-click JSON/CSV export.
- **Resolution mode**: from 30 days before the resolution date, Shaun records his final ruling on each claim and on the bet. The dashboard then shows the verdict. His ruling decides the bet; the probability is commentary.
- **Dashboard**: headline with a loose/strict toggle, per-claim cards, a history chart with markers for evidence, decay steps, late additions and Claim A satisfied (hover, keyboard and table view), a countdown to resolution, and a recent-activity feed.

## Setup

1. Create a free Supabase project. In **Authentication > Providers**, keep Email enabled.
2. Edit `supabase/seed.sql` and replace the three example email addresses with the real ones.
3. In the Supabase SQL editor, run each file in `supabase/migrations/` in order (`0001_init.sql` through `0004_resolution.sql`), then `supabase/seed.sql`.
4. In **Authentication > URL Configuration**, add `http://localhost:3000/auth/callback` (and later your Vercel URL) to the redirect URLs.
5. Copy `.env.example` to `.env.local` and fill in the project URL and anon key.
6. `npm install`, then `npm run dev`, and open http://localhost:3000.

## Tests

- `npm test` runs the engine, data-mapping, form, log, audit, export and chart tests.
- `scripts/test-db.sh` runs the database rule tests against a local Postgres.

## Deploying

Push to GitHub, import the repo in Vercel, add the three environment variables (with `NEXT_PUBLIC_SITE_URL` set to the Vercel URL), and add that URL's `/auth/callback` to Supabase's redirect list.
