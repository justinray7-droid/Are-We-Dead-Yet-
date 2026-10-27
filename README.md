# 2031 AI Wager Tracker

A private web app for Alex, Justin and Shaun to track a five-year bet on autonomous AI research. Bettors submit dated, sourced evidence; Shaun approves and rates it; a Bayesian engine moves the probability. Shaun's final ruling in October 2031 decides the bet.

It installs on an iPhone Home Screen as "AI Wager" and runs full screen like an app.

Spec: `docs/requirements-v1.1.md`.

## What's built

- **Probability engine** (`lib/engine/`): odds updating, strength scale, correlation discounts, multi-claim tags, monthly decay on Claim A with skips and waivers, the Claim A satisfied override, caps, and backdated flags. Fully tested.
- **Database** (`supabase/`): tables, roles, row-level security, append-only audit log, change requests with three-way approval, and seed data. Rules tested on Postgres.
- **Who's who (honor system)**: no logins. The first time a device opens the app, it asks "Who's using this phone?" and remembers the answer on that device; "Switch person" is in the menu. The database still enforces each person's role (only Shaun approves evidence, bettors edit only their own items) and records every action under the chosen name.
- **Evidence flow**: bettors submit dated, sourced evidence; everyone sees the pending queue and can comment; Shaun approves (setting final direction, strength, correlation discount and links), rejects with a reason, or requests changes; approval recomputes every probability. Each item's page shows the exact math of its effect.
- **Dashboard**: headline with a loose/strict toggle, per-claim cards, a history chart with markers for evidence, decay steps, late additions and Claim A satisfied (tap, hover, keyboard and table view), a countdown to resolution, and a recent-activity feed.
- **Governance**: a Rules page with versioned definitions and change requests (definitions need all three approvals, priors need both bettors and Shaun), Shaun's direct recalibration of the other settings, decay waivers and the Claim A satisfied mark, a readable audit log, a filterable Evidence Log that includes decay steps, and one-click JSON/CSV export.
- **Resolution mode**: from 30 days before the resolution date, Shaun records his final ruling on each claim and on the bet. The dashboard then shows the verdict. His ruling decides the bet; the probability is commentary.
- **iPhone app**: Home Screen icon and name, full-screen display under the notch, a bottom tab bar, no zoom-on-tap, and fresh data whenever the app comes back to the foreground.

## Setup

Everything runs on two free services: **Supabase** holds the data and **GitHub Pages** hosts the app. There is no server.

1. **Supabase project.** At supabase.com, create a free project. No auth or email settings are needed.
2. **Database.** In the Supabase **SQL Editor**, run each file in `supabase/migrations/` in order (`0001_init.sql` through `0005_honor_system.sql`), then `supabase/seed.sql`. Paste each file's contents and click **Run**; wait for success before the next. Don't run anything in `supabase/tests/`.
3. **Connect GitHub to Supabase.** In Supabase, open **Project Settings > API Keys** and copy the **Project URL** and the **anon** (or **publishable**) key. Never use the `service_role`/secret key. In this GitHub repository, go to **Settings > Secrets and variables > Actions > Variables** and add two repository variables: `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
4. **Turn on GitHub Pages.** In the repository, go to **Settings > Pages** and set **Source** to **GitHub Actions**.
5. **Publish.** Go to the **Actions** tab, open **Deploy to GitHub Pages**, and click **Run workflow** (it also runs by itself on every push to `main`). When it finishes, the app is at `https://<your-github-name>.github.io/Are-We-Dead-Yet-/`.

The key ends up inside the published app, so anyone who has the link (or digs the key out) could read or change the data. That's fine for a friendly bet among three people; just don't share the link beyond the group. Search engines are told not to index it.

To run it on your own computer instead: copy `.env.example` to `.env.local`, fill in the same two values, then `npm install` and `npm run dev`, and open http://localhost:3000.

## Installing on iPhone

1. Open the GitHub Pages link in **Safari** (other browsers can't add web apps on every iOS version).
2. Tap **Share**, then **Add to Home Screen**, then **Add**. It appears as **AI Wager**.
3. Open it from the Home Screen and pick your name. The app remembers it (pick again from **More > Switch person**).

The Home Screen app keeps its own memory separate from Safari, so you pick your name once in each.

## Tests

- `npm test` runs the engine, data-mapping, form, log, audit, export and chart tests.
- `scripts/test-db.sh` runs the database rule tests against a local Postgres.
- `node scripts/make-icons.mjs` re-renders the app icons from `public/icons/icon.svg` (needs Playwright with Chromium).
