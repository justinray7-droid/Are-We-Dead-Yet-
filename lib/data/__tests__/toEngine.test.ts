import { test } from "node:test";
import assert from "node:assert/strict";
import { currentConfig, toArbiterState, toEvidenceInputs, type EvidenceRow } from "../toEngine.ts";
import { DEFAULT_CONFIG, recompute } from "../../engine/index.ts";

test("currentConfig picks the highest version and strips timeZone", () => {
  const { config, timeZone, version } = currentConfig([
    { version: 1, config: { ...DEFAULT_CONFIG, timeZone: "America/Chicago" } },
    { version: 2, config: { ...DEFAULT_CONFIG, decay: { ...DEFAULT_CONFIG.decay, lr: 1.03 }, timeZone: "America/Chicago" } },
  ]);
  assert.equal(version, 2);
  assert.equal(config.decay.lr, 1.03);
  assert.equal(timeZone, "America/Chicago");
  assert.equal("timeZone" in config, false);
});

test("Only approved evidence reaches the engine, with numeric discounts", () => {
  const rows: EvidenceRow[] = [
    {
      id: "a", title: "Approved", event_date: "2027-01-10", approved_at: "2027-03-01T04:00:00Z",
      status: "approved", is_expert_forecast: false,
      evidence_claims: [{ claim: "A", final_direction: "YES", final_strength: 3, discount: "0.8", dropped: false }],
    },
    {
      id: "p", title: "Pending", event_date: "2027-01-11", approved_at: null,
      status: "pending", is_expert_forecast: false,
      evidence_claims: [{ claim: "A", final_direction: null, final_strength: null, discount: 1, dropped: false }],
    },
  ];
  const inputs = toEvidenceInputs(rows, "America/Chicago");
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].tags[0].discount, 0.8);
  // 04:00 UTC on Mar 1 is still Feb 28 in Chicago.
  assert.equal(inputs[0].approvedDate, "2027-02-28");
  const r = recompute(DEFAULT_CONFIG, inputs, { decayWaivers: [], claimASatisfied: null }, "2027-02-01");
  assert.equal(r.steps.find((s) => s.id === "decay:2027-01")!.status, "skipped");
});

test("Tags the arbiter dropped never reach the engine", () => {
  const rows: EvidenceRow[] = [
    {
      id: "d", title: "Partly dropped", event_date: "2026-11-02", approved_at: "2026-11-03T18:00:00Z",
      status: "approved", is_expert_forecast: false,
      evidence_claims: [
        { claim: "A", final_direction: "NO", final_strength: 2, discount: 1, dropped: false },
        // Proposed by the bettor, removed on review: no final values.
        { claim: "C", final_direction: null, final_strength: null, discount: 1, dropped: true },
      ],
    },
  ];
  const inputs = toEvidenceInputs(rows, "America/Chicago");
  assert.deepEqual(inputs[0].tags.map((t) => t.claim), ["A"]);
  const r = recompute(DEFAULT_CONFIG, inputs, { decayWaivers: [], claimASatisfied: null }, "2026-11-15");
  assert.equal(r.probabilities.C, DEFAULT_CONFIG.priors.C);
});

test("Latest satisfied/unsatisfied action wins; waivers collected", () => {
  const state = toArbiterState([
    { kind: "decay_waiver", month: "2027-02", effective_on: null, evidence_ids: [], note: "first", created_at: "2027-03-01T00:00:00Z" },
    { kind: "claim_a_satisfied", month: null, effective_on: "2028-01-05", evidence_ids: ["x"], note: "met", created_at: "2028-01-06T00:00:00Z" },
    { kind: "claim_a_unsatisfied", month: null, effective_on: null, evidence_ids: [], note: "reversed", created_at: "2028-01-07T00:00:00Z" },
    { kind: "decay_waiver", month: "2027-02", effective_on: null, evidence_ids: [], note: "updated", created_at: "2028-02-01T00:00:00Z" },
  ]);
  assert.equal(state.claimASatisfied, null);
  assert.deepEqual(state.decayWaivers, [{ month: "2027-02", note: "updated" }]);
});

test("A revoked waiver no longer waives; waiving again restores it", () => {
  const row = (kind: "decay_waiver" | "decay_waiver_revoked", month: string, note: string, at: string) => ({
    kind, month, effective_on: null, evidence_ids: [], note, created_at: at,
  });
  const state = toArbiterState([
    row("decay_waiver", "2027-02", "conference", "2027-03-01T00:00:00Z"),
    row("decay_waiver", "2027-04", "holiday", "2027-05-01T00:00:00Z"),
    row("decay_waiver_revoked", "2027-02", "mistake", "2027-03-02T00:00:00Z"),
    row("decay_waiver_revoked", "2027-04", "mistake", "2027-05-02T00:00:00Z"),
    row("decay_waiver", "2027-04", "re-waived", "2027-05-03T00:00:00Z"),
  ]);
  assert.deepEqual(state.decayWaivers, [{ month: "2027-04", note: "re-waived" }]);
});
