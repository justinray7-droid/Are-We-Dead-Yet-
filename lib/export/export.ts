// One-click export: JSON of everything, and CSVs of evidence and the
// probability history. Pure, so it runs under node --test.

import type { EngineResult, Step } from "../engine/index.ts";

type Cell = string | number | boolean | null | undefined;

/** RFC 4180 quoting, plus a leading ' on text that a spreadsheet would run as a formula. */
export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export interface ExportEvidence {
  id: string;
  title: string;
  summary: string;
  source_url: string;
  source_type: string;
  event_date: string;
  status: string;
  is_expert_forecast: boolean;
  rationale: string;
  decision_note: string | null;
  submitted_by: string;
  submitted_at: string;
  decided_at: string | null;
  approved_at: string | null;
  evidence_claims: {
    claim: string;
    proposed_direction: string | null;
    proposed_strength: number | null;
    final_direction: string | null;
    final_strength: number | null;
    discount: number | string;
    dropped: boolean;
  }[];
}

const r4 = (p: number) => Math.round(p * 1e6) / 1e6;

/** One row per evidence item and claim tag, with that tag's effect if applied. */
export function evidenceCsv(items: ExportEvidence[], names: Map<string, string>, steps: Step[]): string {
  const effect = new Map(steps.map((s) => [`${s.id}|${s.claim}`, s]));
  const rows: Cell[][] = [];
  for (const e of items) {
    const tags = e.evidence_claims.length > 0 ? e.evidence_claims : [null];
    for (const t of tags) {
      const s = t ? effect.get(`${e.id}|${t.claim}`) : undefined;
      rows.push([
        e.id, e.event_date, e.title, e.status, names.get(e.submitted_by) ?? e.submitted_by, e.submitted_at,
        e.approved_at, e.source_type, e.source_url, e.is_expert_forecast,
        t?.claim, t?.proposed_direction, t?.proposed_strength, t?.final_direction, t?.final_strength,
        t ? Number(t.discount) : null, t?.dropped ?? null,
        s ? r4(s.before) : null, s ? r4(s.after) : null, s ? s.status : null,
        e.summary, e.rationale, e.decision_note,
      ]);
    }
  }
  return toCsv(
    [
      "evidence_id", "event_date", "title", "status", "submitted_by", "submitted_at", "approved_at", "source_type",
      "source_url", "expert_forecast", "claim", "proposed_direction", "proposed_strength", "final_direction",
      "final_strength", "discount", "dropped", "claim_before", "claim_after", "step_status", "summary", "rationale",
      "decision_note",
    ],
    rows,
  );
}

/** Every engine step in order, with the headline after each date. */
export function historyCsv(result: EngineResult): string {
  const headlineAt = new Map(result.history.map((h) => [h.date, h]));
  return toCsv(
    ["date", "kind", "id", "label", "claim", "direction", "lr", "effective_lr", "status", "before", "after", "backdated", "approved_date", "headline_loose_after_date", "headline_strict_after_date", "note"],
    result.steps.map((s) => {
      const h = headlineAt.get(s.date);
      return [
        s.date, s.kind, s.id, s.label, s.claim, s.direction, s.lr, s.effectiveLR, s.status, r4(s.before), r4(s.after),
        s.backdated ?? false, s.approvedDate, h ? r4(h.loose) : null, h ? r4(h.strict) : null, s.note,
      ];
    }),
  );
}
