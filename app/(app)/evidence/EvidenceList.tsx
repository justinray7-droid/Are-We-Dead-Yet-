import Link from "next/link";
import type { Step } from "@/lib/engine/index.ts";
import type { EvidenceItem } from "@/lib/data/evidence.ts";
import { CLAIM_SHORT, STATUS_LABELS, pct } from "@/lib/evidence/labels.ts";

/** Evidence rows with tags, status and, once approved, each tag's effect. */
export function EvidenceList({
  items,
  names,
  steps,
  empty,
}: {
  items: EvidenceItem[];
  names: Map<string, string>;
  steps: Step[];
  empty: string;
}) {
  if (items.length === 0) return <p className="card muted">{empty}</p>;
  const byId = new Map<string, Step[]>();
  for (const s of steps) byId.set(s.id, [...(byId.get(s.id) ?? []), s]);
  return (
    <ul className="evidence-list">
      {items.map((e) => {
        const effects = byId.get(e.id) ?? [];
        return (
          <li key={e.id} className="card">
            <div className="row spread">
              <Link href={`/evidence/${e.id}`} className="title">
                {e.title}
              </Link>
              <span className={`pill ${e.status}`}>{STATUS_LABELS[e.status]}</span>
            </div>
            <div className="muted small">
              {e.event_date} · submitted by {names.get(e.submitted_by) ?? "unknown"}
            </div>
            <div className="small">
              {effects.length > 0
                ? effects.map((s) => (
                    <span key={s.claim} className="tag">
                      {CLAIM_SHORT[s.claim]} {s.direction} {pct(s.before)} → {pct(s.after)}
                      {s.status !== "applied" ? " (not applied)" : ""}
                    </span>
                  ))
                : e.evidence_claims
                    .filter((c) => !c.dropped)
                    .map((c) => (
                      <span key={c.claim} className="tag">
                        {CLAIM_SHORT[c.claim]} {c.final_direction ?? c.proposed_direction}{" "}
                        {c.final_strength ?? c.proposed_strength}
                      </span>
                    ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
