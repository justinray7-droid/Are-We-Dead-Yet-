"use client";

import { useData } from "@/lib/client/useData.ts";
import { Loading } from "../../Loading.tsx";
import { NotFound } from "../../NotFound.tsx";
import { editHref, evidenceHref } from "@/lib/links.ts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CLAIM_LABELS, STRENGTH_LABELS, toOdds, type Step } from "@/lib/engine/index.ts";
import { listEvidence, loadEvidence, loadPeople } from "@/lib/data/evidence.ts";
import { loadSnapshot } from "@/lib/data/load.ts";
import { SOURCE_TYPES, type FormValues } from "@/lib/evidence/form.ts";
import { CLAIM_SHORT, STATUS_LABELS, formatDateTime, pct } from "@/lib/evidence/labels.ts";
import { addComment, reviewEvidence } from "../actions.ts";
import { CommentForm } from "./CommentForm.tsx";
import { ReviewForm, type ProposedTag } from "./ReviewForm.tsx";

const strengthText = (s: number | null) => (s ? `${s} · ${STRENGTH_LABELS[s as 1 | 2 | 3 | 4 | 5]}` : "—");
const odds = (p: number) => (p >= 1 ? "∞" : toOdds(p).toFixed(3));

function StepMath({ s }: { s: Step }) {
  const op = s.direction === "YES" ? "×" : "÷";
  return (
    <tr>
      <td>{CLAIM_SHORT[s.claim]}</td>
      <td>
        {s.status === "applied" ? (
          <>
            odds {odds(s.before)} {op} {s.effectiveLR.toFixed(3)} = {odds(s.after)}
            {s.effectiveLR !== s.lr && <span className="muted"> (nominal LR {s.lr})</span>}
          </>
        ) : (
          <span className="muted">Recorded, not applied: Claim A is marked satisfied</span>
        )}
      </td>
      <td>
        {pct(s.before)} → {pct(s.after)}
      </td>
    </tr>
  );
}

export default function EvidenceDetailPage() {
  const id = useSearchParams().get("id") ?? "";
  const { data, error } = useData(
    () => Promise.all([loadEvidence(id), loadPeople(), loadSnapshot(), listEvidence()]),
    [id],
  );
  if (!data) return <Loading error={error} />;
  const [loaded, { me, names }, snapshot, allItems] = data;
  if (!loaded) return <NotFound />;
  const { item, comments, links } = loaded;
  const { result, timeZone } = snapshot;

  const steps = result.steps.filter((s) => s.id === id);
  const excluded = result.excludedEvidenceIds.includes(id);
  const isArbiter = me?.role === "arbiter";
  const canEdit = me?.user_id === item.submitted_by && (item.status === "pending" || item.status === "needs_changes");
  const tags = item.evidence_claims;

  let reviewForm = null;
  if (isArbiter) {
    const initial: FormValues = {
      decision: item.status === "pending" ? "approved" : item.status,
      note: item.decision_note ?? "",
      links: links.map((l) => l.id),
    };
    if (item.is_expert_forecast) initial.is_expert_forecast = "on";
    const proposed: Record<string, ProposedTag> = {};
    for (const c of tags) {
      proposed[c.claim] = { direction: c.proposed_direction, strength: c.proposed_strength };
      if (!c.dropped) initial[`tag_${c.claim}`] = "on";
      initial[`direction_${c.claim}`] = c.final_direction ?? c.proposed_direction ?? "YES";
      initial[`strength_${c.claim}`] = String(c.final_strength ?? c.proposed_strength ?? 2);
      initial[`discount_${c.claim}`] = String(c.discount);
    }
    const candidates = allItems.filter((e) => e.id !== id && e.status !== "rejected");
    reviewForm = (
      <ReviewForm action={reviewEvidence.bind(null, id)} initial={initial} proposed={proposed} candidates={candidates} />
    );
  }

  return (
    <main>
      <p className="small">
        <Link href="/evidence/">← Evidence</Link>
      </p>
      <div className="row spread">
        <h1>{item.title}</h1>
        <span className={`pill ${item.status}`}>{STATUS_LABELS[item.status]}</span>
      </div>
      <p className="muted small">
        Happened {item.event_date} · submitted by {names.get(item.submitted_by) ?? "unknown"} on{" "}
        {formatDateTime(item.submitted_at, timeZone)}
        {item.approved_at && <> · approved {formatDateTime(item.approved_at, timeZone)}</>}
        {item.is_expert_forecast && <> · expert forecast</>}
      </p>
      {canEdit && (
        <p>
          <Link href={editHref(id)}>{item.status === "needs_changes" ? "Edit and resubmit →" : "Edit →"}</Link>
        </p>
      )}

      <section className="card stack">
        <div>
          <a href={item.source_url} target="_blank" rel="noopener noreferrer">
            {item.source_url}
          </a>{" "}
          <span className="muted small">({SOURCE_TYPES[item.source_type]})</span>
        </div>
        {item.summary && <p>{item.summary}</p>}
        <div>
          <div className="muted small">Rationale</div>
          <p>{item.rationale}</p>
        </div>
      </section>

      <section className="card">
        <h2>Claims</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Claim</th>
                <th>Proposed</th>
                <th>Final</th>
                <th>Discount</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((c) => (
                <tr key={c.claim} className={c.dropped ? "muted" : undefined}>
                  <td title={CLAIM_LABELS[c.claim]}>
                    {CLAIM_SHORT[c.claim]}
                    {c.dropped && " (dropped by arbiter)"}
                  </td>
                  <td>{c.proposed_direction ? `${c.proposed_direction}, ${strengthText(c.proposed_strength)}` : "—"}</td>
                  <td>{c.final_direction ? `${c.final_direction}, ${strengthText(c.final_strength)}` : "—"}</td>
                  <td>{c.final_direction ? Number(c.discount) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Effect on the probability</h2>
        {item.status !== "approved" ? (
          <p className="muted">Only approved evidence moves the probability.</p>
        ) : excluded ? (
          <p className="muted">
            This happened before the bet started (October 21, 2026). The priors already account for it, so it is
            recorded but not applied.
          </p>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <tbody>
                  {steps.map((s) => (
                    <StepMath key={s.claim} s={s} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              Applied in event-date order from the priors. YES multiplies the odds by the LR; NO divides. A discount d
              makes the LR into LR<sup>d</sup>. Figures are as of {result.asOf} and change if earlier evidence is added.
            </p>
          </>
        )}
      </section>

      {(item.decision_note || item.decided_at) && (
        <section className="card">
          <h2>Arbiter decision</h2>
          <p className="muted small">
            {STATUS_LABELS[item.status]}
            {item.decided_by && <> by {names.get(item.decided_by) ?? "the arbiter"}</>}
            {item.decided_at && <> on {formatDateTime(item.decided_at, timeZone)}</>}
          </p>
          {item.decision_note && <p>{item.decision_note}</p>}
        </section>
      )}

      {links.length > 0 && (
        <section className="card">
          <h2>Related items</h2>
          <ul>
            {links.map((l) => (
              <li key={l.id}>
                <Link href={evidenceHref(l.id)}>{l.title}</Link>{" "}
                <span className="muted small">
                  {l.event_date} · {STATUS_LABELS[l.status]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {reviewForm}

      <section className="card stack">
        <h2>Discussion</h2>
        {comments.length === 0 && <p className="muted">No comments yet.</p>}
        {comments.map((c) => (
          <div key={c.id} className="comment">
            <div className="muted small">
              {names.get(c.author) ?? "unknown"} · {formatDateTime(c.created_at, timeZone)}
            </div>
            <p>{c.body}</p>
          </div>
        ))}
        {me && <CommentForm action={addComment.bind(null, id)} />}
      </section>
    </main>
  );
}
