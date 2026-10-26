"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { todayIn } from "@/lib/engine/index.ts";
import { DEFAULT_TIME_ZONE } from "@/lib/data/toEngine.ts";
import { formValues, parseReview, parseSubmission, type FormValues } from "@/lib/evidence/form.ts";

export type FormState = {
  errors: Record<string, string>;
  values: FormValues;
  /** Bumped on each failed attempt so the form remounts with the echoed values. */
  attempt: number;
} | null;

function fail(prev: FormState, form: FormData, errors: Record<string, string>): FormState {
  return { errors, values: formValues(form), attempt: (prev?.attempt ?? 0) + 1 };
}

export async function submitEvidence(prev: FormState, form: FormData): Promise<FormState> {
  const parsed = parseSubmission(form, todayIn(DEFAULT_TIME_ZONE));
  if (!parsed.ok) return fail(prev, form, parsed.errors);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_evidence", { item: parsed.value });
  if (error) return fail(prev, form, { form: error.message });

  revalidatePath("/", "layout");
  redirect(`/evidence/${data as string}`);
}

export async function resubmitEvidence(id: string, prev: FormState, form: FormData): Promise<FormState> {
  const parsed = parseSubmission(form, todayIn(DEFAULT_TIME_ZONE));
  if (!parsed.ok) return fail(prev, form, parsed.errors);

  const supabase = await createClient();
  const { error } = await supabase.rpc("resubmit_evidence", { p_id: id, item: parsed.value });
  if (error) return fail(prev, form, { form: error.message });

  revalidatePath("/", "layout");
  redirect(`/evidence/${id}`);
}

/** Arbiter decision. Approval changes the inputs, so every page recomputes. */
export async function reviewEvidence(id: string, prev: FormState, form: FormData): Promise<FormState> {
  const parsed = parseReview(form, id);
  if (!parsed.ok) return fail(prev, form, parsed.errors);
  const r = parsed.value;

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_evidence", {
    p_id: id,
    p_decision: r.decision,
    p_note: r.note,
    p_claims: r.claims,
    p_is_expert_forecast: r.decision === "approved" ? r.isExpertForecast : null,
    p_links: r.decision === "approved" ? r.links : null,
  });
  if (error) return fail(prev, form, { form: error.message });

  revalidatePath("/", "layout");
  redirect(`/evidence/${id}`);
}

export async function addComment(id: string, prev: FormState, form: FormData): Promise<FormState> {
  const body = String(form.get("body") ?? "").trim();
  if (!body) return fail(prev, form, { body: "Write something first." });
  if (body.length > 5000) return fail(prev, form, { body: "Keep comments under 5,000 characters." });

  const supabase = await createClient();
  const { error } = await supabase.from("comments").insert({ evidence_id: id, body });
  if (error) return fail(prev, form, { form: error.message });

  revalidatePath(`/evidence/${id}`);
  return null;
}
