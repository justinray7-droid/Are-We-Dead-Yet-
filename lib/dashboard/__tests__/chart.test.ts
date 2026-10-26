import { test } from "node:test";
import assert from "node:assert/strict";
import { chartData, countdown, movesHeadline, pointsChange } from "../chart.ts";
import { DEFAULT_CONFIG, EMPTY_ARBITER, recompute, type EvidenceInput } from "../../engine/index.ts";

const START = DEFAULT_CONFIG.startDate;
const ev = (id: string, eventDate: string, tags: EvidenceInput["tags"], extra: Partial<EvidenceInput> = {}): EvidenceInput => ({
  id, title: id, eventDate, tags, ...extra,
});

test("No evidence yet: a flat line from the start to today, no markers", () => {
  const r = recompute(DEFAULT_CONFIG, [], EMPTY_ARBITER, "2026-10-26");
  const d = chartData(r, "loose", START);
  assert.deepEqual(d.points.map((p) => p.date), [START, "2026-10-26"]);
  assert.ok(d.points.every((p) => Math.abs(p.value - 0.26) < 1e-9));
  assert.equal(d.markers.length, 0);
});

test("Markers only for steps that move the chosen view", () => {
  const r = recompute(
    DEFAULT_CONFIG,
    [
      ev("loose", "2026-11-02", [{ claim: "B_LOOSE", direction: "YES", strength: 3 }]),
      ev("strict", "2026-11-03", [{ claim: "B_STRICT", direction: "NO", strength: 2 }]),
      ev("c", "2026-11-04", [{ claim: "C", direction: "YES", strength: 5 }]),
    ],
    EMPTY_ARBITER,
    "2026-11-20",
  );
  const loose = chartData(r, "loose", START);
  assert.deepEqual(loose.markers.map((m) => [m.date, m.kind]), [["2026-11-02", "yes"]]);
  const strict = chartData(r, "strict", START);
  assert.deepEqual(strict.markers.map((m) => [m.date, m.kind]), [["2026-11-03", "no"]]);
  // Claim C never moves the headline (spec 3.8 #8).
  assert.ok(![...loose.markers, ...strict.markers].some((m) => m.steps.some((s) => s.claim === "C")));
});

test("Applied decay steps are markers; skipped ones are not", () => {
  const r = recompute(
    DEFAULT_CONFIG,
    [ev("big", "2026-12-10", [{ claim: "A", direction: "YES", strength: 3 }])],
    EMPTY_ARBITER,
    "2027-01-05",
  );
  const d = chartData(r, "loose", START);
  assert.deepEqual(d.markers.map((m) => [m.date, m.kind]), [
    ["2026-11-30", "decay"],
    ["2026-12-10", "yes"],
  ]);
  assert.ok(d.markers[0].after < d.markers[0].before);
  assert.equal(d.end, "2027-01-05");
  assert.equal(d.points.at(-1)!.date, "2027-01-05");
});

test("Backdated evidence is flagged and plotted at its event date", () => {
  const r = recompute(
    DEFAULT_CONFIG,
    [ev("late", "2026-11-05", [{ claim: "A", direction: "NO", strength: 2 }], { approvedDate: "2027-01-20" })],
    EMPTY_ARBITER,
    "2027-01-25",
  );
  const m = chartData(r, "loose", START).markers.find((x) => x.date === "2026-11-05")!;
  assert.equal(m.backdated, true);
  assert.equal(m.kind, "no");
  assert.equal(m.steps[0].approvedDate, "2027-01-20");
});

test("Claim A satisfied gets its own marker", () => {
  const r = recompute(
    DEFAULT_CONFIG,
    [ev("e", "2026-11-10", [{ claim: "A", direction: "YES", strength: 5 }])],
    { decayWaivers: [], claimASatisfied: { date: "2026-11-12", evidenceIds: ["e"], note: "met" } },
    "2026-12-15",
  );
  const d = chartData(r, "loose", START);
  const sat = d.markers.find((m) => m.kind === "satisfied")!;
  assert.equal(sat.date, "2026-11-12");
  assert.ok(Math.abs(sat.after - 0.4) < 1e-9); // headline = P(B-loose | A)
  assert.ok(!d.markers.some((m) => m.kind === "decay")); // no decay after satisfied
  assert.equal(movesHeadline(r.steps.find((s) => s.kind === "satisfied")!, "strict"), true);
});

test("Countdown and change labels", () => {
  assert.deepEqual(countdown("2026-10-26", "2031-10-21"), { days: 1821, approx: "4 years, 11 months", reached: false });
  assert.deepEqual(countdown("2031-09-21", "2031-10-21"), { days: 30, approx: "1 month", reached: false });
  assert.deepEqual(countdown("2031-10-15", "2031-10-21"), { days: 6, approx: "6 days", reached: false });
  assert.equal(countdown("2031-11-01", "2031-10-21").reached, true);
  assert.equal(pointsChange(0.26, 0.354), "+9.4 pts");
  assert.equal(pointsChange(0.65, 0.553), "−9.7 pts");
  assert.equal(pointsChange(0.4, 0.4), "no change");
});
