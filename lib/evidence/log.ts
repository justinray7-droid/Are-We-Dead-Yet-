// The Evidence Log: evidence items and the engine's monthly decay steps in one
// filterable list. Pure, so it runs under node --test.

import { CLAIMS, type ClaimId, type Direction, type ISODate, type Step } from "../engine/index.ts";

export type EvidenceStatus = "pending" | "needs_changes" | "approved" | "rejected";
export type DecayStatus = "decay_applied" | "decay_skipped" | "decay_waived";
export type LogStatus = EvidenceStatus | DecayStatus;

export const LOG_STATUS_LABELS: Record<LogStatus, string> = {
  pending: "Pending",
  needs_changes: "Needs changes",
  approved: "Approved",
  rejected: "Rejected",
  decay_applied: "Decay applied",
  decay_skipped: "Decay skipped",
  decay_waived: "Decay waived",
};

export interface LogTag {
  claim: ClaimId;
  direction: Direction;
  strength: number | null;
}

export interface LogRow {
  type: "evidence" | "decay";
  id: string;
  date: ISODate;
  title: string;
  status: LogStatus;
  submitter: string | null;
  tags: LogTag[];
  /** Engine steps for this row (empty until evidence is approved and applies). */
  effects: Step[];
  note?: string;
}

/** The subset of an evidence item the log needs. */
export interface LogEvidence {
  id: string;
  title: string;
  event_date: string;
  status: EvidenceStatus;
  submitted_by: string;
  evidence_claims: {
    claim: ClaimId;
    proposed_direction: Direction | null;
    proposed_strength: number | null;
    final_direction: Direction | null;
    final_strength: number | null;
    dropped: boolean;
  }[];
}

export function buildLog(items: LogEvidence[], steps: Step[]): LogRow[] {
  const byId = new Map<string, Step[]>();
  for (const s of steps) byId.set(s.id, [...(byId.get(s.id) ?? []), s]);

  const rows: LogRow[] = items.map((e) => ({
    type: "evidence",
    id: e.id,
    date: e.event_date,
    title: e.title,
    status: e.status,
    submitter: e.submitted_by,
    tags: e.evidence_claims
      .filter((c) => !c.dropped)
      .map((c) => ({
        claim: c.claim,
        direction: (c.final_direction ?? c.proposed_direction ?? "YES") as Direction,
        strength: c.final_strength ?? c.proposed_strength,
      })),
    effects: byId.get(e.id) ?? [],
  }));

  for (const s of steps) {
    if (s.kind !== "decay") continue;
    rows.push({
      type: "decay",
      id: s.id,
      date: s.date,
      title: s.label,
      status: s.status === "skipped" ? "decay_skipped" : s.status === "waived" ? "decay_waived" : "decay_applied",
      submitter: null,
      tags: [{ claim: "A", direction: "NO", strength: null }],
      effects: [s],
      note: s.note,
    });
  }

  // Newest event first; decay after evidence on the same day, as the engine applies it.
  return rows.sort((a, b) => b.date.localeCompare(a.date) || (a.type === b.type ? 0 : a.type === "decay" ? -1 : 1));
}

export interface LogFilters {
  type?: "evidence" | "decay";
  status?: LogStatus;
  claim?: ClaimId;
  direction?: Direction;
  strength?: number;
  submitter?: string;
  from?: ISODate;
  to?: ISODate;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Reads filters from the query string, ignoring anything invalid. */
export function parseLogFilters(q: Record<string, string | string[] | undefined>): LogFilters {
  const one = (k: string) => {
    const v = q[k];
    return typeof v === "string" ? v.trim() : "";
  };
  const f: LogFilters = {};
  if (one("type") === "evidence" || one("type") === "decay") f.type = one("type") as LogFilters["type"];
  if (one("status") in LOG_STATUS_LABELS) f.status = one("status") as LogStatus;
  if ((CLAIMS as readonly string[]).includes(one("claim"))) f.claim = one("claim") as ClaimId;
  if (one("direction") === "YES" || one("direction") === "NO") f.direction = one("direction") as Direction;
  const s = Number(one("strength"));
  if (Number.isInteger(s) && s >= 1 && s <= 5) f.strength = s;
  if (/^[0-9a-f-]{36}$/i.test(one("submitter"))) f.submitter = one("submitter");
  if (DATE_RE.test(one("from"))) f.from = one("from");
  if (DATE_RE.test(one("to"))) f.to = one("to");
  return f;
}

export function filterLog(rows: LogRow[], f: LogFilters): LogRow[] {
  return rows.filter((r) => {
    if (f.type && r.type !== f.type) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.submitter && r.submitter !== f.submitter) return false;
    if (f.from && r.date < f.from) return false;
    if (f.to && r.date > f.to) return false;
    // Claim, direction and strength must hold on the same tag.
    if (f.claim || f.direction || f.strength) {
      return r.tags.some(
        (t) =>
          (!f.claim || t.claim === f.claim) &&
          (!f.direction || t.direction === f.direction) &&
          (!f.strength || t.strength === f.strength),
      );
    }
    return true;
  });
}

export const hasFilters = (f: LogFilters) => Object.keys(f).length > 0;
