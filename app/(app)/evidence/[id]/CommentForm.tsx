"use client";

import { useActionState } from "react";
import type { FormState } from "../actions.ts";
import { FieldError } from "../EvidenceForm.tsx";

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

export function CommentForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, null);
  const body = typeof state?.values.body === "string" ? state.values.body : "";
  return (
    <form action={formAction} key={state?.attempt ?? 0} className="stack">
      <label htmlFor="body" className="sr-only">
        Comment
      </label>
      <textarea id="body" name="body" rows={3} maxLength={5000} placeholder="Add to the discussion" defaultValue={body} />
      <FieldError state={state} name="body" />
      <FieldError state={state} name="form" />
      <button type="submit" disabled={pending}>
        {pending ? "Posting…" : "Comment"}
      </button>
    </form>
  );
}
