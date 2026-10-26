import { test } from "node:test";
import assert from "node:assert/strict";
import { keyEvidence, parseRuling, rulingOpensOn, rulings } from "../resolution.ts";
import { DEFAULT_CONFIG, EMPTY_ARBITER, recompute } from "../../engine/index.ts";

test("Ruling opens 30 days before resolution", () => {
  assert.equal(rulingOpensOn("2031-10-21"), "2031-09-21");
  assert.equal(rulingOpensOn("2031-03-15"), "2031-02-13");
});

test("The latest ruling stands; earlier ones are kept as history", () => {
  const r = rulings([
    { kind: "decay_waiver", payload: {}, note: "x", effective_on: null, created_at: "2031-09-01T00:00:00Z" },
    { kind: "final_ruling", payload: { overall: "NO" }, note: "first", effective_on: "2031-10-01", created_at: "2031-10-01T12:00:00Z" },
    { kind: "final_ruling", payload: { overall: "YES" }, note: "amended", effective_on: "2031-10-03", created_at: "2031-10-03T12:00:00Z" },
  ]);
  assert.deepEqual(r.map((x) => [x.note, x.payload.overall, x.date]), [["amended", "YES", "2031-10-03"], ["first", "NO", "2031-10-01"]]);
});

test("Key evidence ranks by headline movement and ignores Claim C and unapplied steps", () => {
  const result = recompute(
    DEFAULT_CONFIG,
    [
      { id: "small", title: "small", eventDate: "2026-11-02", tags: [{ claim: "A", direction: "NO", strength: 1 }] },
      { id: "big", title: "big", eventDate: "2026-11-03", tags: [{ claim: "B_LOOSE", direction: "YES", strength: 5 }, { claim: "A", direction: "YES", strength: 2 }] },
      { id: "c", title: "c only", eventDate: "2026-11-04", tags: [{ claim: "C", direction: "YES", strength: 5 }] },
      { id: "later", title: "after satisfied", eventDate: "2026-11-10", tags: [{ claim: "A", direction: "NO", strength: 5 }] },
    ],
    { ...EMPTY_ARBITER, claimASatisfied: { date: "2026-11-05", evidenceIds: ["big"], note: "met" } },
    "2026-11-20",
  );
  const k = keyEvidence(result.steps);
  assert.deepEqual(k.map((x) => x.id), ["big", "small"]);
  assert.ok(Math.abs(k[0].weight - (Math.log(5) + Math.log(1.5))) < 1e-9);
  assert.equal(k[0].steps.length, 2);
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

test("A ruling covers every claim and the bet, with a note", () => {
  const full = { ruling_A: "met", ruling_B_LOOSE: "not_met", ruling_B_STRICT: "not_met", ruling_C: "met", overall: "NO", note: " Results are explainable " };
  const ok = parseRuling(fd(full));
  assert.ok(ok.ok);
  assert.deepEqual(ok.value, { payload: { A: "met", B_LOOSE: "not_met", B_STRICT: "not_met", C: "met", overall: "NO" }, note: "Results are explainable" });
  const { ruling_C: _, ...missing } = full;
  const bad = parseRuling(fd({ ...missing, overall: "maybe", note: "" }));
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ["note", "overall", "ruling_C"]);
});
