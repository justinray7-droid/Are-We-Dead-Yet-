"use client";

import { useSearchParams } from "next/navigation";
import { useData } from "@/lib/client/useData.ts";
import { Loading } from "../Loading.tsx";
import { evidenceHref } from "@/lib/links.ts";
import { ExportLinks } from "../ExportLinks.tsx";
import Link from "next/link";
import { CLAIMS, STRENGTH_LABELS } from "@/lib/engine/index.ts";
import { listEvidence, loadPeople } from "@/lib/data/evidence.ts";
import { loadSnapshot } from "@/lib/data/load.ts";
import { buildLog, filterLog, hasFilters, LOG_STATUS_LABELS, parseLogFilters } from "@/lib/evidence/log.ts";
import { CLAIM_SHORT, pct } from "@/lib/evidence/labels.ts";

const PILL: Record<string, string> = {
  pending: "pending",
  needs_changes: "needs_changes",
  approved: "approved",
  rejected: "rejected",
  decay_applied: "needs_changes",
  decay_skipped: "needs_changes",
  decay_waived: "needs_changes",
};

// Evidence Log: every item and every monthly decay step, filterable, with its effect.
export default function EvidencePage() {
  const query = useSearchParams();
  const f = parseLogFilters(Object.fromEntries(query.entries()));
  const { data, error } = useData(() => Promise.all([listEvidence(), loadPeople(), loadSnapshot()]), []);
  if (!data) return <Loading error={error} />;
  const [items, { names }, snapshot] = data;
  const all = buildLog(items, snapshot.result.steps);
  const rows = filterLog(all, f);

  return (
    <main>
      <div className="row spread">
        <h1>Evidence log</h1>
        <ExportLinks />
      </div>

      <form method="get" className="card filters">
        <label>
          Type
          <select name="type" defaultValue={f.type ?? ""}>
            <option value="">All</option>
            <option value="evidence">Evidence only</option>
            <option value="decay">Decay steps only</option>
          </select>
        </label>
        <label>
          Status
          <select name="status" defaultValue={f.status ?? ""}>
            <option value="">Any</option>
            {Object.entries(LOG_STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Claim
          <select name="claim" defaultValue={f.claim ?? ""}>
            <option value="">Any</option>
            {CLAIMS.map((c) => (
              <option key={c} value={c}>
                {CLAIM_SHORT[c]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Direction
          <select name="direction" defaultValue={f.direction ?? ""}>
            <option value="">Any</option>
            <option value="YES">YES</option>
            <option value="NO">NO</option>
          </select>
        </label>
        <label>
          Strength
          <select name="strength" defaultValue={f.strength ?? ""}>
            <option value="">Any</option>
            {([1, 2, 3, 4, 5] as const).map((s) => (
              <option key={s} value={s}>
                {s} · {STRENGTH_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Submitted by
          <select name="submitter" defaultValue={f.submitter ?? ""}>
            <option value="">Anyone</option>
            {[...names].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input type="date" name="from" defaultValue={f.from} />
        </label>
        <label>
          To
          <input type="date" name="to" defaultValue={f.to} />
        </label>
        <div className="row">
          <button type="submit">Filter</button>
          {hasFilters(f) && <Link href="/evidence/">Clear</Link>}
        </div>
      </form>

      <p className="muted small">
        {rows.length} of {all.length} entries. Event dates; strength and direction are final once approved, proposed
        before. Claim tags match together, so &ldquo;Claim A, NO&rdquo; finds items that push A toward NO.
      </p>

      {rows.length === 0 ? (
        <p className="card muted">Nothing matches.</p>
      ) : (
        <ul className="evidence-list">
          {rows.map((r) => (
            <li key={r.id} className={`card${r.type === "decay" ? " decay-row" : ""}`}>
              <div className="row spread">
                {r.type === "evidence" ? (
                  <Link href={evidenceHref(r.id)} className="title">
                    {r.title}
                  </Link>
                ) : (
                  <span className="title">{r.title}</span>
                )}
                <span className={`pill ${PILL[r.status]}`}>{LOG_STATUS_LABELS[r.status]}</span>
              </div>
              <div className="muted small">
                {r.date}
                {r.type === "evidence" ? ` · submitted by ${names.get(r.submitter ?? "") ?? "unknown"}` : " · system entry"}
                {r.note ? ` · ${r.note}` : ""}
              </div>
              <div className="small">
                {r.effects.length > 0
                  ? r.effects.map((s) => (
                      <span key={s.claim} className="tag">
                        {CLAIM_SHORT[s.claim]} {s.direction} {pct(s.before)} → {pct(s.after)}
                        {s.status === "ignored_satisfied" ? " (A satisfied; not applied)" : ""}
                        {s.backdated ? " · added late" : ""}
                      </span>
                    ))
                  : r.tags.map((t) => (
                      <span key={t.claim} className="tag">
                        {CLAIM_SHORT[t.claim]} {t.direction} {t.strength ?? ""}
                      </span>
                    ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
