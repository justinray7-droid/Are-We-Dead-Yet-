import { createClient, currentMemberId } from "@/lib/supabase/server";
import { recompute, todayIn, type EngineConfig, type EngineResult } from "@/lib/engine/index.ts";
import {
  currentConfig,
  toArbiterState,
  toEvidenceInputs,
  type ArbiterActionRow,
  type ConfigRow,
  type EvidenceRow,
} from "@/lib/data/toEngine.ts";

export interface Snapshot {
  result: EngineResult;
  config: EngineConfig;
  configVersion: number;
  timeZone: string;
  resolutionDate: string;
  pendingCount: number;
  me: { name: string; role: "arbiter" | "yes" | "no" } | null;
}

/** Loads everything the engine needs and recomputes the full chain. */
export async function loadSnapshot(): Promise<Snapshot> {
  const [supabase, memberId] = await Promise.all([createClient(), currentMemberId()]);

  const [configRes, evidenceRes, actionsRes, meRes] = await Promise.all([
    supabase.from("config_versions").select("version, config"),
    supabase
      .from("evidence")
      .select("id, title, event_date, approved_at, status, is_expert_forecast, evidence_claims(claim, final_direction, final_strength, discount, dropped)"),
    supabase.from("arbiter_actions").select("kind, month, effective_on, evidence_ids, note, created_at"),
    supabase.from("members").select("name, role").eq("user_id", memberId ?? "").maybeSingle(),
  ]);

  for (const r of [configRes, evidenceRes, actionsRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  const { config, timeZone, version } = currentConfig(configRes.data as ConfigRow[]);
  const evidenceRows = evidenceRes.data as EvidenceRow[];
  const asOf = todayIn(timeZone);
  const result = recompute(
    config,
    toEvidenceInputs(evidenceRows, timeZone),
    toArbiterState(actionsRes.data as ArbiterActionRow[]),
    asOf,
  );

  return {
    result,
    config,
    configVersion: version,
    timeZone,
    resolutionDate: config.resolutionDate,
    pendingCount: evidenceRows.filter((r) => r.status === "pending").length,
    me: (meRes.data as Snapshot["me"]) ?? null,
  };
}
