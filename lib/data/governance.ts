import { db } from "@/lib/supabase/client.ts";
import type { AuditRow } from "@/lib/audit/describe.ts";
import type { DefinitionKey, Definitions, StoredConfig } from "@/lib/governance/forms.ts";

function check<T>(res: { data: unknown; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export interface DefinitionVersion {
  version: number;
  change_log: string;
  request_id: string | null;
  created_at: string;
}

/** Definitions at a version (default: current), plus every version for the history. */
export async function loadDefinitions(version?: number): Promise<{
  versions: DefinitionVersion[];
  current: number;
  shown: number;
  definitions: Definitions;
}> {
  const supabase = db();
  const versions = check<DefinitionVersion[]>(
    await supabase.from("definition_versions").select("version, change_log, request_id, created_at").order("version", { ascending: false }),
  );
  const current = versions[0]?.version ?? 1;
  const shown = version && versions.some((v) => v.version === version) ? version : current;
  const rows = check<{ key: DefinitionKey; title: string; body: string }[]>(
    await supabase.from("definitions").select("key, title, body").eq("version", shown),
  );
  const definitions = Object.fromEntries(rows.map((r) => [r.key, { title: r.title, body: r.body }])) as Definitions;
  return { versions, current, shown, definitions };
}

export interface ConfigVersion {
  version: number;
  config: StoredConfig;
  note: string;
  request_id: string | null;
  created_by: string | null;
  created_at: string;
}

export async function loadConfigVersions(): Promise<ConfigVersion[]> {
  const supabase = db();
  return check<ConfigVersion[]>(
    await supabase
      .from("config_versions")
      .select("version, config, note, request_id, created_by, created_at")
      .order("version", { ascending: false }),
  );
}

export interface ChangeRequest {
  id: string;
  kind: "definitions" | "priors";
  proposed: {
    change_log?: string;
    note?: string;
    definitions?: Partial<Record<DefinitionKey, { title?: string; body?: string }>>;
    priors?: Record<string, number>;
  };
  rationale: string;
  status: "open" | "applied" | "rejected";
  requested_by: string;
  created_at: string;
  approvals: { approver: string; decision: "approve" | "reject"; note: string; at: string }[];
}

export async function loadChangeRequests(): Promise<ChangeRequest[]> {
  const supabase = db();
  const [reqRes, apprRes] = await Promise.all([
    supabase
      .from("change_requests")
      .select("id, kind, proposed, rationale, status, requested_by, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("change_approvals").select("request_id, approver, decision, note, at").order("at"),
  ]);
  const approvals = check<(ChangeRequest["approvals"][number] & { request_id: string })[]>(apprRes);
  return check<Omit<ChangeRequest, "approvals">[]>(reqRes).map((r) => ({
    ...r,
    approvals: approvals.filter((a) => a.request_id === r.id),
  }));
}

export interface ArbiterAction {
  id: string;
  kind: "decay_waiver" | "decay_waiver_revoked" | "claim_a_satisfied" | "claim_a_unsatisfied" | "final_ruling";
  month: string | null;
  effective_on: string | null;
  evidence_ids: string[];
  note: string;
  payload: unknown;
  actor: string;
  created_at: string;
}

export async function loadArbiterActions(): Promise<ArbiterAction[]> {
  const supabase = db();
  return check<ArbiterAction[]>(
    await supabase
      .from("arbiter_actions")
      .select("id, kind, month, effective_on, evidence_ids, note, payload, actor, created_at")
      .order("created_at", { ascending: false }),
  );
}

export const AUDIT_PAGE = 100;

/** Newest first; `before` is the id to page back from. */
export async function loadAudit(before?: number): Promise<{ rows: AuditRow[]; more: boolean }> {
  const supabase = db();
  let q = supabase.from("audit_log").select("id, at, actor, action, entity, entity_id, details");
  if (before) q = q.lt("id", before);
  const rows = check<AuditRow[]>(await q.order("id", { ascending: false }).limit(AUDIT_PAGE + 1));
  return { rows: rows.slice(0, AUDIT_PAGE), more: rows.length > AUDIT_PAGE };
}

export async function loadEvidenceTitles(): Promise<Map<string, string>> {
  const supabase = db();
  const rows = check<{ id: string; title: string }[]>(await supabase.from("evidence").select("id, title"));
  return new Map(rows.map((r) => [r.id, r.title]));
}
