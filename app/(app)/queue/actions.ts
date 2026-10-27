import { invalidate } from "@/lib/client/useData.ts";
import { db } from "@/lib/supabase/client.ts";
import { decayMonthEnds, monthOf, todayIn } from "@/lib/engine/index.ts";
import { loadConfigVersions } from "@/lib/data/governance.ts";
import { DEFAULT_TIME_ZONE } from "@/lib/data/toEngine.ts";
import { parseNote, parseSatisfied, parseWaiver } from "@/lib/governance/forms.ts";
import type { ActionState } from "../ActionForm.tsx";

const fail = (errors: Record<string, string>): ActionState => ({ errors });

async function record(row: Record<string, unknown>): Promise<ActionState> {
  const supabase = db();
  const { error } = await supabase.from("arbiter_actions").insert(row);
  if (error) return fail({ form: error.message });
  invalidate();
  return { errors: {}, done: true };
}

export async function waiveDecay(_prev: ActionState, form: FormData): Promise<ActionState> {
  const [{ config }] = await loadConfigVersions();
  const months = decayMonthEnds(config.startDate, config.resolutionDate).map(monthOf);
  const parsed = parseWaiver(form, months);
  if (!parsed.ok) return fail(parsed.errors);
  return record({ kind: "decay_waiver", month: parsed.value.month, note: parsed.value.note });
}

export async function revokeWaiver(month: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = parseNote(form, "Say why the waiver is revoked.");
  if (!parsed.ok) return fail(parsed.errors);
  return record({ kind: "decay_waiver_revoked", month, note: parsed.value.note });
}

export async function markSatisfied(_prev: ActionState, form: FormData): Promise<ActionState> {
  const [{ config }] = await loadConfigVersions();
  const parsed = parseSatisfied(form, config.startDate, todayIn(config.timeZone ?? DEFAULT_TIME_ZONE));
  if (!parsed.ok) return fail(parsed.errors);
  return record({ kind: "claim_a_satisfied", ...parsed.value });
}

export async function unmarkSatisfied(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = parseNote(form, "Say why Claim A is no longer satisfied.");
  if (!parsed.ok) return fail(parsed.errors);
  return record({ kind: "claim_a_unsatisfied", note: parsed.value.note });
}
