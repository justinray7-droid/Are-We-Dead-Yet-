# 2031 AI Wager Tracker: Requirements for Claude Code (v1.1)

A small shared web app for three people to track a five-year bet in real time. Evidence is submitted, an arbiter approves it, and a Bayesian engine moves the probability. This document is the starting spec to hand to Claude Code.

## Changes in v1.1

- Added a scheduled monthly time-decay step on Claim A, so a lack of progress counts toward NO (Section 3.4).
- Decisive evidence stays at LR 5.0, and the arbiter can now mark Claim A as satisfied outright (Section 3.5).
- Shaun's final ruling decides the bet. The live probability is commentary only (Section 2.5).
- Dropped the tamper-proofing requirement. The audit log stays append-only in the UI (Section 7).
- Backdated evidence is placed on the chart at its event date and visibly flagged (Section 5).
- Equal-and-opposite cancellation is specified as holding only with no correlation discount (Section 3.8).
- Claim C is settled: it is tracked and quantified only and never gates the bet (Section 2.3).

## 1. Purpose

Alex and Justin have a bet on whether AI will, by October 2031, operate autonomously to do its own research and design, with outcomes beyond human understanding. A third person, Shaun, is the arbiter because he was present for the original discussion. The app makes the bet more fun and more rigorous: instead of arguing from vibes, the bettors submit dated, sourced evidence, and the live percentage shifts based on how strong that evidence is.

**Primary goals**

- Lock in agreed definitions so there is no ambiguity in 2031.
- Let either bettor submit evidence at any time.
- Let Shaun approve, reject, and rate evidence strength.
- Show a live probability, its history over time, and why it moved.
- Keep a permanent record of every change.

**Non-goals (v1)**

- Public access, payments, or real-money handling.
- Automatic web scraping of evidence.
- Replacing Shaun's judgment with an AI judge.
- Cryptographic tamper-proofing of the record.

## 2. The Wager, Defined

### 2.1 Parties and roles

| Role | Person | Permissions |
| --- | --- | --- |
| Arbiter / Admin | Shaun | Approves, rejects, and rates evidence; marks Claim A satisfied; waives decay steps; can edit priors only with both bettors' sign-off; final say at resolution |
| Bettor (YES) | Alex | Submit evidence, comment, view everything |
| Bettor (NO) | Justin | Submit evidence, comment, view everything |

### 2.2 Timeline

- Bet start date: October 21, 2026.
- Resolution date: default 2031-10-21, configurable.
- The app shows a countdown to the resolution date.

### 2.3 Definitions (locked, versioned)

**Autonomous.** Human prompting may be present to influence the work but is not necessary to sustain it. The AI can receive external input to advance ideas, as humans do, but it keeps working and making progress without a human driving each step.

**Claim A: Autonomous research and design.** AI independently picks a question, runs experiments or design iterations, and produces results that domain experts accept as real, under the definition of autonomous above.

**Claim B: Results beyond human understanding.** Two tracked definitions:

- **B-loose (primary, preferred by Alex):** Humans can verify that a result works but could not have produced it or cannot follow how it was found. Reference examples: AlphaGo's move 37, AlphaFold's predictions.
- **B-strict (secondary view):** Experts cannot understand the result even when it is explained to them.

The app headline uses B-loose by default, with a toggle to see the strict view.

**Claim C: Speed at quality (tracked only).** The AI does in weeks what a top expert team would take years to do, at equal or better quality, verified by experts. Speed alone does not count; a fast, mediocre output proves nothing. Claim C has its own probability and evidence, but it never affects the headline probability and does not close or gate the bet. It is shown as a separate, clearly labeled "tracked only" card.

### 2.4 Definition changes

Definitions are stored as versioned records. Any change requires explicit approval from all three people and creates a new version with a visible change log. Old versions are never deleted.

### 2.5 How the bet is decided

Shaun's final ruling at resolution decides the bet. The live probability is a running estimate to inform and entertain; it does not determine the winner, and no probability threshold automatically settles anything. The UI states this on the dashboard and in resolution mode.

## 3. Probability Engine

Bayesian odds updating, computed per claim.

### 3.1 Core math

- Convert probability to odds: `odds = p / (1 - p)`.
- Each approved piece of evidence has a direction (supports YES or supports NO) and a strength that maps to a likelihood ratio (LR).
- If it supports YES: `new_odds = odds × LR`. If it supports NO: `new_odds = odds / LR`.
- Convert back: `p = odds / (1 + odds)`.
- Evidence and decay steps are applied in order of event date, so the history is reproducible. Recompute the full chain from the priors whenever anything changes, rather than storing only the running total.

### 3.2 Strength scale (defaults, editable in config)

| Strength | Label | LR | Anchor example |
| --- | --- | --- | --- |
| 1 | Weak | 1.25 | Vendor claim or demo with no independent verification |
| 2 | Modest | 1.5 | Credible reporting of a notable but contested result |
| 3 | Moderate | 2.0 | Expert-verified result in a narrow domain |
| 4 | Strong | 3.0 | Independently replicated, AI-originated discovery |
| 5 | Decisive | 5.0 | Broad, verified, clearly autonomous result meeting a definition outright |

Bettors propose a strength. Shaun sets the final strength, and the final value is what the engine uses. Both the proposed and final values are stored.

### 3.3 Safeguards against double-counting

- Each evidence item can be linked to related items. Shaun can apply a correlation discount (a multiplier from 0 to 1 applied to the log of the LR) when pieces are not independent, for example five news articles about the same event. Effective LR = `LR ^ discount`.
- A single evidence item can be tagged to more than one claim, with a separate direction and strength for each.
- Per-item and per-day caps on movement are configurable and off by default.

### 3.4 Time decay on Claim A

Absence of progress should count toward NO, so the engine applies a scheduled decay step to Claim A.

- **Schedule:** one step at the end of each calendar month, starting with the first full month after the bet start date and ending at the resolution date.
- **Effect:** a NO-direction update with a small decay LR. Default `decay_LR = 1.02`, editable in config. `new_odds = odds / decay_LR`.
- **Skip condition:** the step is skipped automatically for any month that contains at least one approved YES-supporting Claim A item with final strength at or above a threshold (default: Moderate, strength 3; configurable). Because the chain is recomputed by event date, a backdated YES item can retroactively cancel a past month's decay step. That is intended.
- **Arbiter waiver:** Shaun can waive any individual month's step with a required note.
- **Stops when:** Claim A is marked satisfied, or the resolution date is reached.
- **Transparency:** each applied, skipped, or waived step appears in the Evidence Log as a system-generated entry ("Monthly decay, March 2028") with its before/after effect, so the math is visible like any other item.
- **Scale check:** with the default 1.02 and no qualifying YES evidence for the full five years (about 60 steps), Claim A falls from 65% to about 36%. Shaun can recalibrate.
- Decay applies to Claim A only. Claims B and C do not decay.

### 3.5 Marking Claim A satisfied

Decisive evidence keeps its LR of 5.0. Separately, Shaun can mark Claim A as satisfied when he judges the definition has been met outright.

- Shaun-only action. Requires linking at least one approved evidence item and a written note.
- While satisfied, P(A) is fixed at 100%, decay stops, and further Claim A evidence is recorded but does not move P(A).
- The headline then equals P(B | A) for the selected B definition.
- Reversible by Shaun with a required note. Both marking and reversing create audit entries and trigger a full recompute.
- Marking Claim A satisfied does not decide the bet; Shaun's final ruling still does (Section 2.5).

### 3.6 Priors (seed values)

All editable by Shaun at setup and recorded as the starting point.

- Claim A: 65%.
- Claim B-loose: 40%, conditional on Claim A.
- Claim B-strict: 12.5%, conditional on Claim A.
- Claim C: 40% (suggested; set at setup).

### 3.7 Headline probability

Headline P(YES) = P(A) × P(B | A), using B-loose by default, which seeds at 26% (65% × 40%). A toggle switches to B-strict. Claim C is excluded from the headline. The combination rule is configurable.

### 3.8 Worked examples (use as unit tests)

1. Claim A prior 65% (odds 1.857). A Modest (LR 1.5) NO-supporting item gives odds 1.238, so p = 55.3%.
2. Claim B-loose prior 40% (odds 0.667). A Strong (LR 3.0) YES-supporting item gives odds 2.0, so p = 66.7%.
3. A YES item and a NO item of equal strength, both with no correlation discount, applied to the same claim return it to its original probability. (With unequal discounts they do not cancel; test that too.)
4. Claim A at 65%, one decay step at LR 1.02: odds 1.857 / 1.02 = 1.821, so p = 64.5%.
5. Claim A at 65%, 60 decay steps with no qualifying YES evidence: odds 1.857 / 1.02^60 (3.281) = 0.566, so p = 36.1%.
6. A month containing an approved YES Claim A item of strength 3 or higher skips that month's decay step. A backdated item that lands in a past month removes that month's step on recompute.
7. Claim A marked satisfied: P(A) = 100%, headline = P(B-loose | A), no further decay steps applied. Reversing restores the computed chain exactly.
8. Claim C evidence never changes the headline.

## 4. Evidence Workflow

1. A bettor submits an evidence item.
2. It enters a Pending queue visible to all three.
3. Shaun reviews it and can Approve, Reject (with required reason), or Request changes.
4. On approval he sets the final direction, strength, claim tags, and optional correlation discount.
5. The engine recomputes and the dashboard updates.
6. Any later edit to an approved item creates an audit entry and triggers a full recompute.

### Evidence fields

- Title and short summary
- Source URL (required) and source type (peer-reviewed paper, company announcement, news report, independent replication, other)
- Date of the underlying event (required) and date submitted (automatic); date approved (automatic)
- Submitted by
- Claims tagged (A, B-loose, B-strict, C)
- Proposed direction and strength, with a written rationale
- Arbiter fields: final direction, final strength, correlation discount, linked items, decision note
- Status: Pending, Approved, Rejected, Needs changes

### Rules

- Only dated, sourced evidence is accepted.
- Evidence must describe something that happened, not a prediction or opinion, unless Shaun tags it as expert-forecast evidence with a low default cap.
- Both bettors can comment on any item, but only Shaun can change its status or values.

## 5. Screens and Features

**Dashboard**

- Large headline probability with the loose/strict toggle, and a short line stating that Shaun's final ruling decides the bet.
- Per-claim cards for A and B; Claim C as a separate "tracked only" card. Claim A shows a "Satisfied" badge when marked.
- Time-series chart of the headline probability since the start date, with markers for each evidence item and decay step that moved it, and hover details.
- **Backdated items:** plotted at their event date. Any item approved more than 30 days after its event date (threshold configurable) uses a distinct marker, and its hover shows both the event date and the approval date. The chart history updates when such items are approved.
- Countdown to the resolution date.
- Recent activity feed (ordered by when things happened in the app, so late additions are visible) and pending-item count.

**Evidence Log**

- Filterable list by status, claim, direction, strength, submitter, date, and type (evidence or system decay step).
- Each row shows its effect on the probability (before and after).

**Submit Evidence** form with the fields above.

**Evidence Detail** page with discussion thread, arbiter decision, and the exact math of its effect.

**Arbiter Queue** (Shaun only) for reviewing pending items, plus controls to waive a month's decay step and to mark or unmark Claim A satisfied.

**Rules and Definitions** page showing the current locked definitions, the strength scale, decay settings, version history, and a change-request flow requiring all three approvals.

**Audit Log.** Append-only record of every submission, decision, edit, decay waiver, satisfied mark, and definition change, with actor and timestamp. No deletes in the UI.

**Resolution mode.** Near the resolution date, Shaun opens a resolution view that summarizes the final probabilities, the key evidence, and records his final ruling on each claim and on the overall bet. His ruling is what decides the bet.

## 6. Users, Auth, and Hosting

- Exactly three user accounts, with roles as above. No public sign-up.
- Simple authentication: email magic links, or a per-user passcode. Sessions persist on trusted devices.
- Hosted at a shared link accessible only to the three accounts. Mobile-friendly is required.
- Suggested stack (Claude Code can propose changes): Next.js with TypeScript, Supabase (Postgres plus auth), deployed on Vercel. Keep the dependency list small.
- Store the probability engine as a pure, well-tested function separate from the UI. Decay steps are generated by the engine from the calendar and config during recompute, not by a stored background job, so recompute stays the single source of truth. A daily or monthly scheduled job only needs to trigger a recompute and refresh the dashboard.

## 7. Non-Functional Requirements

- Reproducibility: the headline number can always be regenerated from the priors, config, approved evidence, arbiter actions (waivers, satisfied marks), and the calendar alone.
- Transparency: every probability change links to the evidence or decay step that caused it and shows the math.
- Integrity: the audit log is append-only in the UI; rejected items remain visible. No cryptographic tamper-proofing is required.
- Data export: one-click JSON and CSV export of all evidence and history.
- Simplicity: prefer fewer features done cleanly over a large surface area.

## 8. Suggested Build Phases for Claude Code

1. **Foundation.** Project scaffold, database schema, auth with three roles, seeded config (priors, strength scale, decay settings, definitions v1).
2. **Engine.** Pure Bayesian engine with unit tests covering all worked examples in Section 3.8: ordering by event date, correlation discounts, multi-claim tagging, monthly decay with skips and waivers, and the Claim A satisfied override.
3. **Evidence flow.** Submit form, pending queue, arbiter review, approval that triggers recompute.
4. **Dashboard.** Headline, per-claim cards, history chart with evidence and decay markers and backdated flags, countdown.
5. **Governance.** Definitions versioning with three-way approval, audit log, export, decay waiver and satisfied controls.
6. **Polish.** Mobile layout, activity feed, resolution mode.
7. **Optional v2.** AI-assisted evidence intake using the Claude API: paste a link and get a draft summary, suggested claim tags, and a suggested strength with reasoning. Shaun still decides; the AI only drafts.

**Kickoff prompt for Claude Code:** "Read this requirements document in full. Before writing code, propose the database schema and the file structure, list any ambiguities you see, and wait for my approval. Then build Phase 1 and Phase 2 together, with tests for the probability engine passing before moving on."

## 9. Decisions and Open Items

**Settled**

- Sides: Alex is YES, Justin is NO.
- Dates: start October 21, 2026; resolution default October 21, 2031.
- Claim C: tracked and quantified only; it never gates or closes the bet.
- Deciding factor: Shaun's final ruling. The probability is commentary.
- Time decay: monthly step on Claim A, default LR 1.02, skipped in months with qualifying YES evidence.
- Decisive evidence: LR 5.0 retained, plus a separate "mark Claim A satisfied" option.
- Backdated evidence: shown at event date on the chart and flagged.
- Tamper-proofing: not required.

**Still open**

- Claim combination: confirm the headline is P(A) × P(B | A).
- Strength scale and decay LR: starting defaults; Shaun may recalibrate after the first few items.
- Stakes: add an optional display field if wanted.
- Shaun's own priors: by default he only judges evidence and is not a bettor.
