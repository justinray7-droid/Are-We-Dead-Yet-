"use client";

import { useActionState } from "react";
import { CLAIMS, CLAIM_LABELS, STRENGTH_LABELS } from "@/lib/engine/index.ts";
import { SOURCE_TYPES, type FormValues } from "@/lib/evidence/form.ts";
import { STRENGTH_ANCHORS } from "@/lib/evidence/labels.ts";
import type { FormState } from "./actions.ts";

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

export function StrengthOptions() {
  return (
    <>
      {([1, 2, 3, 4, 5] as const).map((s) => (
        <option key={s} value={s} title={STRENGTH_ANCHORS[s]}>
          {s} · {STRENGTH_LABELS[s]}
        </option>
      ))}
    </>
  );
}

export function FieldError({ state, name }: { state: FormState; name: string }) {
  const msg = state?.errors[name];
  return msg ? <p className="error">{msg}</p> : null;
}

/** Submit and resubmit form for bettors. */
export function EvidenceForm({
  action,
  initial,
  today,
  submitLabel,
}: {
  action: Action;
  initial: FormValues;
  today: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const v = state?.values ?? initial;
  const val = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");

  return (
    <form action={formAction} key={state?.attempt ?? 0} className="stack">
      <section className="card stack">
        <label htmlFor="title">Title</label>
        <input id="title" name="title" required minLength={3} maxLength={200} defaultValue={val("title")} />
        <FieldError state={state} name="title" />

        <label htmlFor="summary">Short summary</label>
        <textarea id="summary" name="summary" rows={3} defaultValue={val("summary")} />

        <label htmlFor="source_url">Source link</label>
        <input id="source_url" name="source_url" type="url" required placeholder="https://" defaultValue={val("source_url")} />
        <FieldError state={state} name="source_url" />

        <div className="row">
          <div className="stack grow">
            <label htmlFor="source_type">Source type</label>
            <select id="source_type" name="source_type" required defaultValue={val("source_type") || "news_report"}>
              {Object.entries(SOURCE_TYPES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <FieldError state={state} name="source_type" />
          </div>
          <div className="stack grow">
            <label htmlFor="event_date">Date it happened</label>
            <input id="event_date" name="event_date" type="date" required max={today} defaultValue={val("event_date")} />
            <FieldError state={state} name="event_date" />
          </div>
        </div>
        <p className="muted small">
          Evidence must describe something that happened, not a prediction or opinion. Events before the bet start
          (October 21, 2026) are recorded but don&apos;t move the probability.
        </p>
      </section>

      <fieldset className="card stack">
        <legend>Claims this bears on</legend>
        <p className="muted small">Tick each claim and propose a direction and strength. Shaun sets the final values.</p>
        {CLAIMS.map((c) => (
          <div key={c} className="claim-row">
            <label className="check">
              <input type="checkbox" name={`tag_${c}`} defaultChecked={val(`tag_${c}`) !== ""} />
              {CLAIM_LABELS[c]}
            </label>
            <div className="row">
              <select name={`direction_${c}`} aria-label={`Direction for ${c}`} defaultValue={val(`direction_${c}`) || "YES"}>
                <option value="YES">Supports YES</option>
                <option value="NO">Supports NO</option>
              </select>
              <select name={`strength_${c}`} aria-label={`Strength for ${c}`} defaultValue={val(`strength_${c}`) || "2"}>
                <StrengthOptions />
              </select>
            </div>
          </div>
        ))}
        <FieldError state={state} name="claims" />
        <details className="small">
          <summary>Strength scale</summary>
          <ul>
            {([1, 2, 3, 4, 5] as const).map((s) => (
              <li key={s}>
                <strong>
                  {s} · {STRENGTH_LABELS[s]}
                </strong>
                : {STRENGTH_ANCHORS[s]}
              </li>
            ))}
          </ul>
        </details>
      </fieldset>

      <section className="card stack">
        <label htmlFor="rationale">Rationale</label>
        <textarea id="rationale" name="rationale" rows={4} required defaultValue={val("rationale")} />
        <FieldError state={state} name="rationale" />
      </section>

      <FieldError state={state} name="form" />
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
