// Core types for the 2031 AI Wager probability engine.
// Pure data only: no I/O, no framework imports.

export type ClaimId = "A" | "B_LOOSE" | "B_STRICT" | "C";
export const CLAIMS: readonly ClaimId[] = ["A", "B_LOOSE", "B_STRICT", "C"];

export type Direction = "YES" | "NO";
export type Strength = 1 | 2 | 3 | 4 | 5;

/** Calendar date as "YYYY-MM-DD". Compared lexicographically. */
export type ISODate = string;
/** Calendar month as "YYYY-MM". */
export type ISOMonth = string;

export interface EngineConfig {
  /** Starting probabilities, 0 < p < 1. B claims are conditional on A. */
  priors: Record<ClaimId, number>;
  /** Likelihood ratio for each final strength. */
  strengthLR: Record<Strength, number>;
  decay: {
    enabled: boolean;
    /** NO-direction LR applied at each month end to Claim A. */
    lr: number;
    /** A month is skipped if it holds an approved YES Claim A tag at or above this strength. */
    skipThreshold: Strength;
  };
  startDate: ISODate;
  resolutionDate: ISODate;
  /** Items approved this many days after their event date are flagged as backdated. */
  backdateFlagDays: number;
  /** Max LR an expert-forecast item can apply. */
  forecastMaxLR: number;
  /** Optional caps on |ln(odds)| movement. null = off. */
  caps: {
    perItemLR: number | null;
    perDayLR: number | null;
  };
  /** How the headline is combined. Only "product" (P(A) × P(B|A)) for now. */
  combination: "product";
}

export interface ClaimTag {
  claim: ClaimId;
  direction: Direction;
  strength: Strength;
  /** Correlation discount, 0..1, applied to ln(LR). Default 1 (no discount). */
  discount?: number;
}

/** An APPROVED evidence item, with the arbiter's final values. */
export interface EvidenceInput {
  id: string;
  title: string;
  eventDate: ISODate;
  approvedDate?: ISODate;
  isExpertForecast?: boolean;
  tags: ClaimTag[];
}

export interface DecayWaiver {
  month: ISOMonth;
  note: string;
}

export interface ArbiterState {
  decayWaivers: DecayWaiver[];
  /** Present while Claim A is marked satisfied. Reversing = setting this to null. */
  claimASatisfied: { date: ISODate; evidenceIds: string[]; note: string } | null;
}

export type StepStatus =
  | "applied"
  | "skipped" // decay step skipped by qualifying YES evidence
  | "waived" // decay step waived by the arbiter
  | "ignored_satisfied"; // Claim A evidence recorded after A was marked satisfied

export interface Step {
  kind: "evidence" | "decay" | "satisfied";
  /** Evidence id, "decay:YYYY-MM", or "satisfied". */
  id: string;
  label: string;
  date: ISODate;
  claim: ClaimId;
  direction: Direction;
  /** Nominal LR before discount/caps. */
  lr: number;
  /** LR actually applied (1 when not applied). */
  effectiveLR: number;
  status: StepStatus;
  before: number;
  after: number;
  backdated?: boolean;
  approvedDate?: ISODate;
  note?: string;
}

export interface HeadlinePoint {
  date: ISODate;
  loose: number;
  strict: number;
  /** Ids of the steps that landed on this date. */
  stepIds: string[];
}

export interface EngineResult {
  asOf: ISODate;
  probabilities: Record<ClaimId, number>;
  headline: { loose: number; strict: number };
  claimASatisfied: boolean;
  steps: Step[];
  history: HeadlinePoint[];
  /** Approved evidence dated before the bet start; not applied. */
  excludedEvidenceIds: string[];
}
