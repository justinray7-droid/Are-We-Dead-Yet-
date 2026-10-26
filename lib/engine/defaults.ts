import type { ArbiterState, EngineConfig } from "./types.ts";

/** Seed config, matching spec v1.1. Stored in the database as config v1. */
export const DEFAULT_CONFIG: EngineConfig = {
  priors: { A: 0.65, B_LOOSE: 0.4, B_STRICT: 0.125, C: 0.4 },
  strengthLR: { 1: 1.25, 2: 1.5, 3: 2.0, 4: 3.0, 5: 5.0 },
  decay: { enabled: true, lr: 1.02, skipThreshold: 3 },
  startDate: "2026-10-21",
  resolutionDate: "2031-10-21",
  backdateFlagDays: 30,
  forecastMaxLR: 1.25,
  caps: { perItemLR: null, perDayLR: null },
  combination: "product",
};

export const EMPTY_ARBITER: ArbiterState = { decayWaivers: [], claimASatisfied: null };

export const STRENGTH_LABELS = {
  1: "Weak",
  2: "Modest",
  3: "Moderate",
  4: "Strong",
  5: "Decisive",
} as const;

export const CLAIM_LABELS = {
  A: "A: Autonomous research and design",
  B_LOOSE: "B-loose: Beyond human understanding (verify, can't produce)",
  B_STRICT: "B-strict: Beyond understanding even when explained",
  C: "C: Speed at quality (tracked only)",
} as const;
