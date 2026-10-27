"use client";

import { useSearchParams } from "next/navigation";
import { useData } from "@/lib/client/useData.ts";
import { Loading } from "../Loading.tsx";
import Link from "next/link";
import { AUDIT_CATEGORIES, describeAudit, type AuditCategory } from "@/lib/audit/describe.ts";
import { loadPeople } from "@/lib/data/evidence.ts";
import { loadAudit, loadEvidenceTitles } from "@/lib/data/governance.ts";
import { DEFAULT_TIME_ZONE } from "@/lib/data/toEngine.ts";
import { formatDateTime } from "@/lib/evidence/labels.ts";

// Append-only record of every change. Nothing here can be edited or deleted.
export default function AuditPage() {
  const query = useSearchParams();
  const before = query.get("before") ?? undefined;
  const show = query.get("show") ?? undefined;
  const category = show && show in AUDIT_CATEGORIES ? (show as AuditCategory) : undefined;
  const { data, error } = useData(
    () => Promise.all([loadAudit(Number(before) || undefined), loadEvidenceTitles(), loadPeople()]),
    [before],
  );
  if (!data) return <Loading error={error} />;
  const [{ rows, more }, titles, { names }] = data;
  const lines = rows
    .map((r) => ({ r, line: describeAudit(r, titles) }))
    .filter(({ line }) => !category || line.category === category);
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ show: category, ...extra })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/audit/?${s}` : "/audit/";
  };

  return (
    <main>
      <h1>Audit log</h1>
      <p className="muted">
        Every submission, decision, edit, waiver, satisfied mark and rule change, with who did it and when. Append-only:
        nothing can be edited or deleted.
      </p>
      <nav className="tabs" aria-label="Filter by kind">
        <Link href={qs({ show: undefined })} aria-current={!category ? "page" : undefined}>
          All
        </Link>
        {Object.entries(AUDIT_CATEGORIES).map(([k, label]) => (
          <Link key={k} href={qs({ show: k })} aria-current={category === k ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      {lines.length === 0 ? (
        <p className="card muted">Nothing {category ? "of this kind " : ""}on this page.</p>
      ) : (
        <ol className="audit card">
          {lines.map(({ r, line }) => (
            <li key={r.id}>
              <div className="muted small">
                {formatDateTime(r.at, DEFAULT_TIME_ZONE)} · #{r.id}
              </div>
              <div>
                <strong>{r.actor ? (names.get(r.actor) ?? "Unknown member") : "System"}</strong>{" "}
                {line.href ? <Link href={line.href}>{line.text}</Link> : line.text}
              </div>
              {line.detail && <div className="muted small detail">{line.detail}</div>}
            </li>
          ))}
        </ol>
      )}
      <div className="row spread">
        {before ? <Link href={qs({})}>← Newest</Link> : <span />}
        {more && <Link href={qs({ before: String(rows[rows.length - 1].id) })}>Older entries →</Link>}
      </div>
    </main>
  );
}
