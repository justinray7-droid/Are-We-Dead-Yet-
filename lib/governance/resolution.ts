// Resolution mode: when the ruling opens, which ruling stands, the evidence
// that moved the headline most, and parsing Shaun's ruling. Pure.

import { CLAIMS, toOdds, type ClaimId, type ISODate, type Step } from "../engine/index.ts";
import type { FormLike, Parsed } from "../evidence/form.ts";

export const RULING_WINDOW_DAYS = 30;

export type ClaimRuling = "met" | "not_met";
export type Verdict = "YES" | "NO";
export type RulingPayload = Record<ClaimId, ClaimRuling> & { overall: Verdict };

export interface RulingAction {
  kind: string;
  payload: unknown;
  note: string;
  effective_on: string | null;
  created_at: string;
}

export interface Ruling {
  payload: RulingPayload;
  note: string;
  date: ISODate;
  at: string;
}

/** The first day Shaun can record the ruling (matches public.ruling_opens_on()). */
export function rulingOpensOn(resolutionDate: ISODate, days = RULING_WINDOW_DAYS): ISODate {
  const d = new Date(resolutionDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Every ruling, newest first; the first one stands. */
export function rulings(actions: RulingAction[]): Ruling[] {
  return actions
    .filter((a) => a.kind === "final_ruling")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((a) => ({
      payload: a.payload as RulingPayload,
      note: a.note,
      date: a.effective_on ?? a.created_at.slice(0, 10),
      at: a.created_at,
    }));
}

export interface KeyEvidence {
  id: string;
  title: string;
  date: ISODate;
  /** Total |ln odds| moved across headline claims (A and both B views). */
  weight: number;
  steps: Step[];
}

/** Approved evidence ranked by how far it moved the claims behind the headline. */
export function keyEvidence(steps: Step[], limit = 8): KeyEvidence[] {
  const by = new Map<string, KeyEvidence>();
  for (const s of steps) {
    if (s.kind !== "evidence" || s.status !== "applied" || s.claim === "C") continue;
    if (s.before >= 1 || s.after >= 1) continue;
    const moved = Math.abs(Math.log(toOdds(s.after) / toOdds(s.before)));
    const k = by.get(s.id) ?? { id: s.id, title: s.label, date: s.date, weight: 0, steps: [] };
    k.weight += moved;
    k.steps.push(s);
    by.set(s.id, k);
  }
  return [...by.values()]
    .filter((k) => k.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.date.localeCompare(b.date))
    .slice(0, limit);
}

export function parseRuling(form: FormLike): Parsed<{ payload: RulingPayload; note: string }> {
  const errors: Record<string, string> = {};
  const payload = {} as RulingPayload;
  for (const c of CLAIMS) {
    const v = form.get(`ruling_${c}`);
    if (v === "met" || v === "not_met") payload[c] = v;
    else errors[`ruling_${c}`] = "Rule on every claim.";
  }
  const overall = form.get("overall");
  if (overall === "YES" || overall === "NO") payload.overall = overall;
  else errors.overall = "Rule on the bet: YES or NO.";
  const note = typeof form.get("note") === "string" ? String(form.get("note")).trim() : "";
  if (!note) errors.note = "Explain the ruling.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { payload, note } };
}
