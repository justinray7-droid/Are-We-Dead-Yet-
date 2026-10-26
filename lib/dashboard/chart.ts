// Shapes the engine's history into what the dashboard chart draws. Pure, so it
// is unit-tested alongside the engine.

import type { EngineResult, ISODate, Step } from "../engine/index.ts";
import { daysBetween } from "../engine/index.ts";

export type View = "loose" | "strict";

export type MarkerKind = "yes" | "no" | "decay" | "satisfied";

export interface ChartPoint {
  date: ISODate;
  value: number;
}

export interface ChartMarker {
  date: ISODate;
  /** Headline before and after everything that landed on this date. */
  before: number;
  after: number;
  kind: MarkerKind;
  /** Any evidence here was approved long after its event date. */
  backdated: boolean;
  /** The steps on this date that moved this view's headline. */
  steps: Step[];
}

export interface ChartData {
  /** Step-after series from the start date to the as-of date. */
  points: ChartPoint[];
  markers: ChartMarker[];
  start: ISODate;
  end: ISODate;
}

const B_CLAIM = { loose: "B_LOOSE", strict: "B_STRICT" } as const;

/** A step moves the headline if it applied to A or this view's B, with a real effect. */
export function movesHeadline(s: Step, view: View): boolean {
  if (s.claim !== "A" && s.claim !== B_CLAIM[view]) return false;
  if (s.status !== "applied") return false;
  return s.kind === "satisfied" || s.before !== s.after;
}

export function chartData(result: EngineResult, view: View, startDate: ISODate): ChartData {
  const stepsById = new Map<string, Step[]>();
  for (const s of result.steps) stepsById.set(s.id, [...(stepsById.get(s.id) ?? []), s]);

  const points: ChartPoint[] = [];
  const markers: ChartMarker[] = [];
  let prev = result.history[0]?.[view] ?? result.headline[view];

  for (const h of result.history) {
    const value = h[view];
    points.push({ date: h.date, value });
    const steps = [...new Set(h.stepIds)]
      .flatMap((id) => stepsById.get(id) ?? [])
      .filter((s) => s.date === h.date && movesHeadline(s, view));
    if (steps.length > 0) {
      const kind: MarkerKind = steps.some((s) => s.kind === "satisfied")
        ? "satisfied"
        : steps.every((s) => s.kind === "decay")
          ? "decay"
          : value >= prev
            ? "yes"
            : "no";
      markers.push({
        date: h.date,
        before: prev,
        after: value,
        kind,
        backdated: steps.some((s) => s.backdated),
        steps,
      });
    }
    prev = value;
  }

  const end = result.asOf > startDate ? result.asOf : startDate;
  const last = points[points.length - 1];
  if (!last || last.date < end) points.push({ date: end, value: result.headline[view] });
  return { points, markers, start: startDate, end };
}

/** Change since the start, in percentage points, signed. */
export function pointsChange(from: number, to: number): string {
  const d = (to - from) * 100;
  if (Math.abs(d) < 0.05) return "no change";
  return `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} pts`;
}

export interface Countdown {
  days: number;
  /** e.g. "4 years, 11 months" */
  approx: string;
  reached: boolean;
}

export function countdown(asOf: ISODate, resolution: ISODate): Countdown {
  const days = Math.max(0, daysBetween(asOf, resolution));
  if (days === 0) return { days, approx: "Resolution date reached", reached: true };
  const [ay, am, ad] = asOf.split("-").map(Number);
  const [ry, rm, rd] = resolution.split("-").map(Number);
  let months = (ry - ay) * 12 + (rm - am) - (rd < ad ? 1 : 0);
  const years = Math.floor(months / 12);
  months -= years * 12;
  const parts = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? "" : "s"}`);
  if (months > 0) parts.push(`${months} month${months === 1 ? "" : "s"}`);
  return { days, approx: parts.length ? parts.join(", ") : `${days} day${days === 1 ? "" : "s"}`, reached: false };
}
