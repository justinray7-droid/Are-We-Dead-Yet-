import { db } from "@/lib/supabase/client.ts";
import { loadSnapshot } from "@/lib/data/load.ts";
import { evidenceCsv, historyCsv, type ExportEvidence } from "@/lib/export/export.ts";

export const EXPORT_FILES = {
  "wager-export.json": "Everything (JSON)",
  "evidence.csv": "Evidence (CSV)",
  "history.csv": "Probability history (CSV)",
} as const;
export type ExportFile = keyof typeof EXPORT_FILES;

function check<T>(res: { data: unknown; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/** Builds one export in the browser: the file name, type and contents. */
export async function buildExport(file: ExportFile): Promise<{ name: string; type: string; body: string }> {
  const supabase = db();
  const snapshot = await loadSnapshot();
  const name = `wager-${snapshot.result.asOf}-${file.replace("wager-", "")}`;
  if (file === "history.csv") return { name, type: "text/csv", body: historyCsv(snapshot.result) };

  const [evidence, members] = await Promise.all([
    supabase
      .from("evidence")
      .select(
        "id, title, summary, source_url, source_type, event_date, status, is_expert_forecast, rationale, decision_note, " +
          "submitted_by, submitted_at, decided_at, approved_at, " +
          "evidence_claims(claim, proposed_direction, proposed_strength, final_direction, final_strength, discount, dropped)",
      )
      .order("event_date")
      .then((r) => check<ExportEvidence[]>(r)),
    supabase
      .from("members")
      .select("user_id, name, role")
      .then((r) => check<{ user_id: string; name: string; role: string }[]>(r)),
  ]);
  const names = new Map(members.map((m) => [m.user_id, m.name]));
  if (file === "evidence.csv") return { name, type: "text/csv", body: evidenceCsv(evidence, names, snapshot.result.steps) };

  const all = (table: string, order: string) => supabase.from(table).select("*").order(order).then((r) => check<unknown[]>(r));
  const [comments, links, actions, configs, defVersions, definitions, requests, approvals] = await Promise.all([
    all("comments", "created_at"),
    supabase.from("evidence_links").select("evidence_id, related_id").then((r) => check<unknown[]>(r)),
    all("arbiter_actions", "created_at"),
    all("config_versions", "version"),
    all("definition_versions", "version"),
    all("definitions", "version"),
    all("change_requests", "created_at"),
    all("change_approvals", "at"),
  ]);
  const body = {
    exported_at: new Date().toISOString(),
    as_of: snapshot.result.asOf,
    note: "Shaun's final ruling decides the bet. Probabilities are recomputed from the inputs below and are a running estimate.",
    members,
    engine: {
      config_version: snapshot.configVersion,
      config: snapshot.config,
      probabilities: snapshot.result.probabilities,
      headline: snapshot.result.headline,
      claim_a_satisfied: snapshot.result.claimASatisfied,
      steps: snapshot.result.steps,
      history: snapshot.result.history,
      excluded_evidence_ids: snapshot.result.excludedEvidenceIds,
    },
    evidence,
    evidence_links: links,
    comments,
    arbiter_actions: actions,
    config_versions: configs,
    definition_versions: defVersions,
    definitions,
    change_requests: requests,
    change_approvals: approvals,
  };
  return { name, type: "application/json", body: JSON.stringify(body, null, 2) };
}
