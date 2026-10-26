import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLog, filterLog, parseLogFilters, type LogEvidence } from "../log.ts";
import { DEFAULT_CONFIG, EMPTY_ARBITER, recompute } from "../../engine/index.ts";

const ALEX = "00000000-0000-0000-0000-00000000000b";
const JUSTIN = "00000000-0000-0000-0000-00000000000c";

const items: LogEvidence[] = [
  {
    id: "yes", title: "Big YES", event_date: "2026-12-10", status: "approved", submitted_by: ALEX,
    evidence_claims: [
      { claim: "A", proposed_direction: "YES", proposed_strength: 4, final_direction: "YES", final_strength: 3, dropped: false },
      { claim: "C", proposed_direction: "YES", proposed_strength: 2, final_direction: null, final_strength: null, dropped: true },
    ],
  },
  {
    id: "no", title: "Pending NO", event_date: "2027-01-05", status: "pending", submitted_by: JUSTIN,
    evidence_claims: [{ claim: "B_LOOSE", proposed_direction: "NO", proposed_strength: 2, final_direction: null, final_strength: null, dropped: false }],
  },
];
const result = recompute(
  DEFAULT_CONFIG,
  [{ id: "yes", title: "Big YES", eventDate: "2026-12-10", tags: [{ claim: "A", direction: "YES", strength: 3 }] }],
  { ...EMPTY_ARBITER, decayWaivers: [{ month: "2027-01", note: "holiday" }] },
  "2027-02-10",
);
const rows = buildLog(items, result.steps);

test("Log merges evidence and decay steps, newest first", () => {
  assert.deepEqual(
    rows.map((r) => [r.date, r.type, r.status]),
    [
      ["2027-01-31", "decay", "decay_waived"],
      ["2027-01-05", "evidence", "pending"],
      ["2026-12-31", "decay", "decay_skipped"],
      ["2026-12-10", "evidence", "approved"],
      ["2026-11-30", "decay", "decay_applied"],
    ],
  );
  assert.equal(rows[0].note, "holiday");
  // Final values win over proposed; dropped tags are hidden.
  assert.deepEqual(rows[3].tags, [{ claim: "A", direction: "YES", strength: 3 }]);
  assert.equal(rows[3].effects.length, 1);
  assert.equal(rows[1].effects.length, 0);
});

test("Filters combine; claim, direction and strength match the same tag", () => {
  const ids = (f: Parameters<typeof filterLog>[1]) => filterLog(rows, f).map((r) => r.id);
  assert.deepEqual(ids({ type: "decay" }), ["decay:2027-01", "decay:2026-12", "decay:2026-11"]);
  assert.deepEqual(ids({ status: "decay_applied" }), ["decay:2026-11"]);
  assert.deepEqual(ids({ submitter: JUSTIN }), ["no"]);
  assert.deepEqual(ids({ claim: "A", direction: "YES" }), ["yes"]);
  assert.deepEqual(ids({ claim: "A", direction: "NO", type: "decay", from: "2026-12-01" }), ["decay:2027-01", "decay:2026-12"]);
  assert.deepEqual(ids({ claim: "B_LOOSE", direction: "YES" }), []);
  assert.deepEqual(ids({ strength: 3 }), ["yes"]); // decay steps have no strength
  assert.deepEqual(ids({ claim: "C" }), []); // dropped tag
  assert.deepEqual(ids({ from: "2027-01-01", to: "2027-01-10" }), ["no"]);
});

test("Query-string filters ignore junk", () => {
  assert.deepEqual(
    parseLogFilters({ type: "decay", status: "nope", claim: "B_STRICT", direction: "no", strength: "9", from: "2027-01-01", to: "soon", submitter: ALEX }),
    { type: "decay", claim: "B_STRICT", from: "2027-01-01", submitter: ALEX },
  );
  assert.deepEqual(parseLogFilters({ strength: "4", direction: "NO", status: "decay_waived" }), { strength: 4, direction: "NO", status: "decay_waived" });
});
