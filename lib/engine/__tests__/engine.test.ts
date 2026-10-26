import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  EMPTY_ARBITER,
  recompute,
  decayMonthEnds,
  todayIn,
  type EngineConfig,
  type EvidenceInput,
} from "../index.ts";

const NO_DECAY_YET = "2026-11-15"; // before the first decay step (2026-11-30)
const close = (actual: number, expected: number, digits = 3) =>
  assert.ok(Math.abs(actual - expected) < 0.5 * 10 ** -digits, `expected ${expected}, got ${actual}`);

function ev(id: string, eventDate: string, tags: EvidenceInput["tags"], extra: Partial<EvidenceInput> = {}): EvidenceInput {
  return { id, title: id, eventDate, tags, ...extra };
}

describe("Spec 3.8 worked examples", () => {
  test("1. Claim A 65%, Modest NO item -> 55.3%", () => {
    const r = recompute(DEFAULT_CONFIG, [ev("e1", "2026-11-01", [{ claim: "A", direction: "NO", strength: 2 }])], EMPTY_ARBITER, NO_DECAY_YET);
    close(r.probabilities.A, 0.553);
    close(r.steps[0].before / (1 - r.steps[0].before), 1.857);
  });

  test("2. B-loose 40%, Strong YES item -> 66.7%", () => {
    const r = recompute(DEFAULT_CONFIG, [ev("e1", "2026-11-01", [{ claim: "B_LOOSE", direction: "YES", strength: 4 }])], EMPTY_ARBITER, NO_DECAY_YET);
    close(r.probabilities.B_LOOSE, 0.667);
  });

  test("3a. Equal YES and NO, no discount, cancel exactly", () => {
    const r = recompute(
      DEFAULT_CONFIG,
      [
        ev("y", "2026-11-01", [{ claim: "A", direction: "YES", strength: 3 }]),
        ev("n", "2026-11-02", [{ claim: "A", direction: "NO", strength: 3 }]),
      ],
      EMPTY_ARBITER,
      NO_DECAY_YET,
    );
    close(r.probabilities.A, 0.65, 12);
  });

  test("3b. Equal strength with unequal discounts does not cancel", () => {
    const r = recompute(
      DEFAULT_CONFIG,
      [
        ev("y", "2026-11-01", [{ claim: "A", direction: "YES", strength: 3, discount: 0.5 }]),
        ev("n", "2026-11-02", [{ claim: "A", direction: "NO", strength: 3 }]),
      ],
      EMPTY_ARBITER,
      NO_DECAY_YET,
    );
    // odds 1.857 * 2^0.5 / 2 = 1.313 -> 56.8%
    close(r.probabilities.A, 0.568);
  });

  test("4. One decay step at LR 1.02 -> 64.5%", () => {
    const r = recompute(DEFAULT_CONFIG, [], EMPTY_ARBITER, "2026-12-01");
    const decay = r.steps.filter((s) => s.kind === "decay");
    assert.equal(decay.length, 1);
    assert.equal(decay[0].date, "2026-11-30");
    close(r.probabilities.A, 0.645);
  });

  test("5. 60 decay steps -> 36.1%", () => {
    const cfg: EngineConfig = { ...DEFAULT_CONFIG, startDate: "2026-10-01", resolutionDate: "2031-10-01" };
    const r = recompute(cfg, [], EMPTY_ARBITER, "2031-10-01");
    assert.equal(r.steps.filter((s) => s.status === "applied").length, 60);
    close(r.probabilities.A, 0.361);
  });

  test("5b. Default dates give 59 steps (Nov 2026 to Sep 2031), ending near 36.6%", () => {
    const r = recompute(DEFAULT_CONFIG, [], EMPTY_ARBITER, "2031-12-31");
    const decay = r.steps.filter((s) => s.kind === "decay");
    assert.equal(decay.length, 59);
    assert.equal(decay[0].date, "2026-11-30");
    assert.equal(decay.at(-1)!.date, "2031-09-30");
    close(r.probabilities.A, 0.366);
  });

  test("6a. Month with a YES Claim A item of strength >= 3 skips its decay step", () => {
    const r = recompute(DEFAULT_CONFIG, [ev("y", "2027-01-10", [{ claim: "A", direction: "YES", strength: 3 }])], EMPTY_ARBITER, "2027-02-01");
    const jan = r.steps.find((s) => s.id === "decay:2027-01")!;
    assert.equal(jan.status, "skipped");
    assert.equal(jan.before, jan.after);
    assert.equal(r.steps.find((s) => s.id === "decay:2026-12")!.status, "applied");
  });

  test("6b. Strength 2 YES item does not skip decay", () => {
    const r = recompute(DEFAULT_CONFIG, [ev("y", "2027-01-10", [{ claim: "A", direction: "YES", strength: 2 }])], EMPTY_ARBITER, "2027-02-01");
    assert.equal(r.steps.find((s) => s.id === "decay:2027-01")!.status, "applied");
  });

  test("6c. NO items and B-only YES items do not skip decay", () => {
    const r = recompute(
      DEFAULT_CONFIG,
      [
        ev("n", "2027-01-10", [{ claim: "A", direction: "NO", strength: 5 }]),
        ev("b", "2027-01-12", [{ claim: "B_LOOSE", direction: "YES", strength: 5 }]),
      ],
      EMPTY_ARBITER,
      "2027-02-01",
    );
    assert.equal(r.steps.find((s) => s.id === "decay:2027-01")!.status, "applied");
  });

  test("6d. Backdated item retroactively removes a past decay step and is flagged", () => {
    const before = recompute(DEFAULT_CONFIG, [], EMPTY_ARBITER, "2027-06-01");
    assert.equal(before.steps.find((s) => s.id === "decay:2027-02")!.status, "applied");
    const late = ev("late", "2027-02-14", [{ claim: "A", direction: "YES", strength: 4 }], { approvedDate: "2027-05-20" });
    const after = recompute(DEFAULT_CONFIG, [late], EMPTY_ARBITER, "2027-06-01");
    assert.equal(after.steps.find((s) => s.id === "decay:2027-02")!.status, "skipped");
    assert.equal(after.steps.find((s) => s.id === "late")!.backdated, true);
    // History point for Feb now reflects the YES item.
    assert.ok(after.history.some((h) => h.date === "2027-02-14"));
  });

  test("6e. Item approved within 30 days is not flagged backdated", () => {
    const r = recompute(DEFAULT_CONFIG, [ev("x", "2027-02-14", [{ claim: "A", direction: "YES", strength: 1 }], { approvedDate: "2027-03-10" })], EMPTY_ARBITER, "2027-06-01");
    assert.equal(r.steps.find((s) => s.id === "x")!.backdated, false);
  });

  test("7. Claim A satisfied: P(A)=100%, headline = P(B|A), decay stops; reversing restores exactly", () => {
    const evidence = [
      ev("big", "2028-03-05", [{ claim: "A", direction: "YES", strength: 5 }]),
      ev("afterA", "2028-06-01", [{ claim: "A", direction: "NO", strength: 4 }]),
      ev("b", "2028-07-01", [{ claim: "B_LOOSE", direction: "YES", strength: 2 }]),
    ];
    const asOf = "2029-01-01";
    const base = recompute(DEFAULT_CONFIG, evidence, EMPTY_ARBITER, asOf);
    const sat = recompute(
      DEFAULT_CONFIG,
      evidence,
      { decayWaivers: [], claimASatisfied: { date: "2028-03-10", evidenceIds: ["big"], note: "Meets Claim A" } },
      asOf,
    );
    assert.equal(sat.probabilities.A, 1);
    assert.equal(sat.claimASatisfied, true);
    close(sat.headline.loose, sat.probabilities.B_LOOSE, 12);
    close(sat.headline.strict, sat.probabilities.B_STRICT, 12);
    assert.equal(sat.steps.filter((s) => s.kind === "decay" && s.date >= "2028-03-10").length, 0);
    assert.equal(sat.steps.find((s) => s.id === "afterA")!.status, "ignored_satisfied");

    const reversed = recompute(DEFAULT_CONFIG, evidence, EMPTY_ARBITER, asOf);
    assert.deepEqual(reversed, base);
  });

  test("8. Claim C evidence never changes the headline", () => {
    const base = recompute(DEFAULT_CONFIG, [], EMPTY_ARBITER, NO_DECAY_YET);
    const withC = recompute(DEFAULT_CONFIG, [ev("c", "2026-11-01", [{ claim: "C", direction: "YES", strength: 5 }])], EMPTY_ARBITER, NO_DECAY_YET);
    assert.deepEqual(withC.headline, base.headline);
    assert.notEqual(withC.probabilities.C, base.probabilities.C);
  });
});

describe("Engine behavior", () => {
  test("Headline seeds at 26% loose and 8.125% strict", () => {
    const r = recompute(DEFAULT_CONFIG, [], EMPTY_ARBITER, "2026-10-21");
    close(r.headline.loose, 0.26, 12);
    close(r.headline.strict, 0.08125, 12);
  });

  test("Evidence is applied in event-date order, not input order", () => {
    const a = ev("a", "2026-11-05", [{ claim: "A", direction: "YES", strength: 4 }]);
    const b = ev("b", "2026-11-02", [{ claim: "A", direction: "NO", strength: 2 }]);
    const r1 = recompute(DEFAULT_CONFIG, [a, b], EMPTY_ARBITER, NO_DECAY_YET);
    const r2 = recompute(DEFAULT_CONFIG, [b, a], EMPTY_ARBITER, NO_DECAY_YET);
    assert.deepEqual(r1.steps.map((s) => s.id), ["b", "a"]);
    assert.deepEqual(r1.steps, r2.steps);
  });

  test("One item tagged to several claims updates each independently", () => {
    const r = recompute(
      DEFAULT_CONFIG,
      [
        ev("multi", "2026-11-01", [
          { claim: "A", direction: "YES", strength: 3 },
          { claim: "B_LOOSE", direction: "NO", strength: 2 },
          { claim: "C", direction: "YES", strength: 1, discount: 0.5 },
        ]),
      ],
      EMPTY_ARBITER,
      NO_DECAY_YET,
    );
    close(r.probabilities.A, (1.857142857 * 2) / (1 + 1.857142857 * 2)); // 78.8%
    close(r.probabilities.B_LOOSE, (0.6666667 / 1.5) / (1 + 0.6666667 / 1.5)); // 30.8%
    const cOdds = (0.4 / 0.6) * Math.pow(1.25, 0.5);
    close(r.probabilities.C, cOdds / (1 + cOdds));
    assert.equal(r.steps.length, 3);
  });

  test("Discount of 0 makes an item have no effect", () => {
    const r = recompute(DEFAULT_CONFIG, [ev("d", "2026-11-01", [{ claim: "A", direction: "YES", strength: 5, discount: 0 }])], EMPTY_ARBITER, NO_DECAY_YET);
    close(r.probabilities.A, 0.65, 12);
  });

  test("Arbiter can waive a month's decay step with a note", () => {
    const r = recompute(DEFAULT_CONFIG, [], { decayWaivers: [{ month: "2026-12", note: "Holiday lull" }], claimASatisfied: null }, "2027-01-01");
    const dec = r.steps.find((s) => s.id === "decay:2026-12")!;
    assert.equal(dec.status, "waived");
    assert.equal(dec.note, "Holiday lull");
    assert.equal(dec.before, dec.after);
  });

  test("Decay can be disabled in config", () => {
    const r = recompute({ ...DEFAULT_CONFIG, decay: { ...DEFAULT_CONFIG.decay, enabled: false } }, [], EMPTY_ARBITER, "2030-01-01");
    assert.equal(r.steps.length, 0);
    assert.equal(r.probabilities.A, 0.65);
  });

  test("Expert-forecast items are capped at forecastMaxLR", () => {
    const r = recompute(DEFAULT_CONFIG, [ev("f", "2026-11-01", [{ claim: "A", direction: "YES", strength: 5 }], { isExpertForecast: true })], EMPTY_ARBITER, NO_DECAY_YET);
    assert.equal(r.steps[0].effectiveLR, 1.25);
  });

  test("Per-item cap limits a single item's movement", () => {
    const cfg = { ...DEFAULT_CONFIG, caps: { perItemLR: 2, perDayLR: null } };
    const r = recompute(cfg, [ev("x", "2026-11-01", [{ claim: "A", direction: "YES", strength: 5 }])], EMPTY_ARBITER, NO_DECAY_YET);
    assert.equal(r.steps[0].effectiveLR, 2);
  });

  test("Per-day cap limits total movement on one claim in one day", () => {
    const cfg = { ...DEFAULT_CONFIG, caps: { perItemLR: null, perDayLR: 3 } };
    const r = recompute(
      cfg,
      [
        ev("x", "2026-11-01", [{ claim: "A", direction: "YES", strength: 3 }]),
        ev("y", "2026-11-01", [{ claim: "A", direction: "YES", strength: 3 }]),
      ],
      EMPTY_ARBITER,
      NO_DECAY_YET,
    );
    close(r.steps[0].effectiveLR, 2, 9);
    close(r.steps[1].effectiveLR, 1.5, 9); // 3 / 2 remaining
  });

  test("Evidence dated before the bet start is excluded", () => {
    const r = recompute(DEFAULT_CONFIG, [ev("old", "2026-06-01", [{ claim: "A", direction: "YES", strength: 5 }])], EMPTY_ARBITER, NO_DECAY_YET);
    assert.deepEqual(r.excludedEvidenceIds, ["old"]);
    assert.equal(r.probabilities.A, 0.65);
  });

  test("Evidence dated after asOf is not yet applied", () => {
    const r = recompute(DEFAULT_CONFIG, [ev("future", "2027-01-01", [{ claim: "A", direction: "YES", strength: 5 }])], EMPTY_ARBITER, NO_DECAY_YET);
    assert.equal(r.steps.length, 0);
  });

  test("History has one point per date with the headline after that day", () => {
    const r = recompute(
      DEFAULT_CONFIG,
      [
        ev("x", "2026-11-30", [{ claim: "A", direction: "YES", strength: 1 }]),
        ev("y", "2026-11-30", [{ claim: "B_LOOSE", direction: "YES", strength: 1 }]),
      ],
      EMPTY_ARBITER,
      "2026-12-01",
    );
    assert.deepEqual(r.history.map((h) => h.date), ["2026-10-21", "2026-11-30"]);
    assert.deepEqual(r.history[1].stepIds, ["x", "y", "decay:2026-11"]);
    close(r.history[1].loose, r.headline.loose, 12);
  });

  test("Recompute is deterministic", () => {
    const evidence = [ev("x", "2027-03-01", [{ claim: "A", direction: "NO", strength: 2 }])];
    assert.deepEqual(recompute(DEFAULT_CONFIG, evidence, EMPTY_ARBITER, "2028-01-01"), recompute(DEFAULT_CONFIG, evidence, EMPTY_ARBITER, "2028-01-01"));
  });

  test("Invalid inputs throw", () => {
    assert.throws(() => recompute({ ...DEFAULT_CONFIG, priors: { ...DEFAULT_CONFIG.priors, A: 1 } }, [], EMPTY_ARBITER, NO_DECAY_YET));
    assert.throws(() => recompute(DEFAULT_CONFIG, [ev("x", "2026-13-01", [])], EMPTY_ARBITER, NO_DECAY_YET));
    assert.throws(() => recompute(DEFAULT_CONFIG, [ev("x", "2026-11-01", [{ claim: "A", direction: "YES", strength: 3, discount: 1.5 }])], EMPTY_ARBITER, NO_DECAY_YET));
  });
});

describe("Date helpers", () => {
  test("First decay month is the first full month after start", () => {
    assert.deepEqual(decayMonthEnds("2026-10-21", "2027-01-31"), ["2026-11-30", "2026-12-31", "2027-01-31"]);
    assert.deepEqual(decayMonthEnds("2026-10-01", "2026-11-29"), ["2026-10-31"]);
  });

  test("Leap-year February ends on the 29th", () => {
    assert.ok(decayMonthEnds("2028-01-15", "2028-03-01").includes("2028-02-29"));
  });

  test("todayIn uses the given time zone", () => {
    // 2026-11-01 03:00 UTC is still Oct 31 in Chicago.
    assert.equal(todayIn("America/Chicago", new Date("2026-11-01T03:00:00Z")), "2026-10-31");
  });
});
