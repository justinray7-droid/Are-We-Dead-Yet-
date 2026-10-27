import { invalidate } from "@/lib/client/useData.ts";
import { db } from "@/lib/supabase/client.ts";
import { loadConfigVersions, loadDefinitions } from "@/lib/data/governance.ts";
import { parseConfigUpdate, parseDefinitionsProposal, parsePriorsProposal } from "@/lib/governance/forms.ts";
import type { ActionState } from "../ActionForm.tsx";

const fail = (errors: Record<string, string>): ActionState => ({ errors });
const done = (): ActionState => {
  invalidate();
  return { errors: {}, done: true };
};

export async function proposeDefinitions(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { definitions } = await loadDefinitions();
  const parsed = parseDefinitionsProposal(form, definitions);
  if (!parsed.ok) return fail(parsed.errors);
  const supabase = db();
  const { error } = await supabase.rpc("propose_change", {
    p_kind: "definitions",
    p_proposed: parsed.value.proposed,
    p_rationale: parsed.value.rationale,
  });
  return error ? fail({ form: error.message }) : done();
}

export async function proposePriors(_prev: ActionState, form: FormData): Promise<ActionState> {
  const [latest] = await loadConfigVersions();
  const parsed = parsePriorsProposal(form, latest.config.priors);
  if (!parsed.ok) return fail(parsed.errors);
  const supabase = db();
  const { error } = await supabase.rpc("propose_change", {
    p_kind: "priors",
    p_proposed: parsed.value.proposed,
    p_rationale: parsed.value.rationale,
  });
  return error ? fail({ form: error.message }) : done();
}

/** Approve or reject; the database applies the change once everyone needed has approved. */
export async function decideRequest(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const decision = form.get("decision");
  const note = String(form.get("note") ?? "").trim();
  if (decision !== "approve" && decision !== "reject") return fail({ decision: "Approve or reject." });
  if (decision === "reject" && !note) return fail({ note: "Say why you're rejecting it." });
  const supabase = db();
  const { error } = await supabase.from("change_approvals").insert({ request_id: id, decision, note });
  return error ? fail({ form: error.message }) : done();
}

/** Arbiter recalibration of everything except priors and the bet's terms. */
export async function updateConfig(_prev: ActionState, form: FormData): Promise<ActionState> {
  const [latest] = await loadConfigVersions();
  const parsed = parseConfigUpdate(form, latest.config);
  if (!parsed.ok) return fail(parsed.errors);
  const supabase = db();
  // Version is the latest + 1, so a concurrent change fails on the primary key instead of being overwritten.
  const { error } = await supabase
    .from("config_versions")
    .insert({ version: latest.version + 1, config: parsed.value.config, note: parsed.value.note });
  if (error) {
    return fail({ form: error.message.includes("duplicate key") ? "Settings changed meanwhile. Reload and try again." : error.message });
  }
  return done();
}
