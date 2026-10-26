"use client";

import { useActionState, useState } from "react";
import { CLAIMS, CLAIM_LABELS, STRENGTH_LABELS } from "@/lib/engine/index.ts";
import { DECISIONS, type FormValues } from "@/lib/evidence/form.ts";
import type { FormState } from "../actions.ts";
import { FieldError, StrengthOptions } from "../EvidenceForm.tsx";

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

export interface ProposedTag {
  direction: string | null;
  strength: number | null;
}

/** Arbiter panel: final values per claim, links, forecast flag, decision. */
export function ReviewForm({
  action,
  initial,
  proposed,
  candidates,
}: {
  action: Action;
  initial: FormValues;
  proposed: Partial<Record<string, ProposedTag>>;
  candidates: { id: string; title: string; event_date: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const v = state?.values ?? initial;
  const val = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
  const linked = new Set(Array.isArray(v.links) ? v.links : []);
  const [decision, setDecision] = useState(val("decision") || "approved");

  return (
    <form action={formAction} key={state?.attempt ?? 0} className="card stack">
      <h2>Arbiter review</h2>

      <fieldset className="stack plain">
        <legend>Decision</legend>
        <div className="row">
          {Object.entries(DECISIONS).map(([k, label]) => (
            <label key={k} className="check">
              <input
                type="radio"
                name="decision"
                value={k}
                defaultChecked={decision === k}
                onChange={() => setDecision(k)}
              />
              {label}
            </label>
          ))}
        </div>
        <FieldError state={state} name="decision" />
      </fieldset>

      <fieldset className="stack plain" disabled={decision !== "approved"} hidden={decision !== "approved"}>
        <legend>Final values</legend>
        <p className="muted small">
          Untick a claim to drop it (it stays on record). The correlation discount (0 to 1) is applied to the log of
          the LR: 1 means independent, 0 means no effect.
        </p>
        {CLAIMS.map((c) => {
          const p = proposed[c];
          return (
            <div key={c} className="claim-row">
              <label className="check">
                <input type="checkbox" name={`tag_${c}`} defaultChecked={val(`tag_${c}`) !== ""} />
                {CLAIM_LABELS[c]}
              </label>
              <div className="muted small">
                {p?.direction && p.strength
                  ? `Proposed: ${p.direction}, ${p.strength} · ${STRENGTH_LABELS[p.strength as 1 | 2 | 3 | 4 | 5]}`
                  : "Not proposed by the submitter"}
              </div>
              <div className="row">
                <select name={`direction_${c}`} aria-label={`Final direction for ${c}`} defaultValue={val(`direction_${c}`) || "YES"}>
                  <option value="YES">Supports YES</option>
                  <option value="NO">Supports NO</option>
                </select>
                <select name={`strength_${c}`} aria-label={`Final strength for ${c}`} defaultValue={val(`strength_${c}`) || "2"}>
                  <StrengthOptions />
                </select>
                <label className="check small">
                  Discount
                  <input
                    name={`discount_${c}`}
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    className="narrow-input"
                    defaultValue={val(`discount_${c}`) || "1"}
                  />
                </label>
              </div>
            </div>
          );
        })}
        <FieldError state={state} name="claims" />

        <label className="check">
          <input type="checkbox" name="is_expert_forecast" defaultChecked={val("is_expert_forecast") !== ""} />
          Expert-forecast evidence (capped at a low LR)
        </label>

        {candidates.length > 0 && (
          <details>
            <summary>Related items ({linked.size} linked)</summary>
            <div className="stack small">
              {candidates.map((c) => (
                <label key={c.id} className="check">
                  <input type="checkbox" name="links" value={c.id} defaultChecked={linked.has(c.id)} />
                  {c.event_date} · {c.title}
                </label>
              ))}
            </div>
          </details>
        )}
      </fieldset>

      <label htmlFor="note">{decision === "approved" ? "Decision note (optional)" : "Note to the submitter (required)"}</label>
      <textarea id="note" name="note" rows={3} defaultValue={val("note")} />
      <FieldError state={state} name="note" />

      <FieldError state={state} name="form" />
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : decision === "approved" ? "Approve and recompute" : DECISIONS[decision as keyof typeof DECISIONS]}
      </button>
    </form>
  );
}
