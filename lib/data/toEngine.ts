// Maps database rows (as returned by Supabase) to engine inputs. Pure, so it is
// unit-tested alongside the engine.

import type {
  ArbiterState,
  ClaimId,
  Direction,
  EngineConfig,
  EvidenceInput,
  Strength,
} from "../engine/index.ts";
import { todayIn } from "../engine/index.ts";

export interface ConfigRow {
  version: number;
  config: EngineConfig & { timeZone?: string };
}

export interface EvidenceRow {
  id: string;
  title: string;
  event_date: string;
  approved_at: string | null;
  status: "pending" | "approved" | "rejected" | "needs_changes";
  is_expert_forecast: boolean;
  evidence_claims: {
    claim: ClaimId;
    final_direction: Direction | null;
    final_strength: number | null;
    discount: number | string;
    /** Removed by the arbiter; kept for the record, never applied. */
    dropped: boolean;
  }[];
}

export interface ArbiterActionRow {
  kind: "decay_waiver" | "decay_waiver_revoked" | "claim_a_satisfied" | "claim_a_unsatisfied" | "final_ruling";
  month: string | null;
  effective_on: string | null;
  evidence_ids: string[];
  note: string;
  created_at: string;
}

export const DEFAULT_TIME_ZONE = "America/Chicago";

/** The current config is the highest version. */
export function currentConfig(rows: ConfigRow[]): { config: EngineConfig; timeZone: string; version: number } {
  if (rows.length === 0) throw new Error("No config has been seeded.");
  const latest = rows.reduce((a, b) => (b.version > a.version ? b : a));
  const { timeZone, ...config } = latest.config;
  return { config, timeZone: timeZone ?? DEFAULT_TIME_ZONE, version: latest.version };
}

/** Approved evidence only, with the arbiter's final values on tags he kept. */
export function toEvidenceInputs(rows: EvidenceRow[], timeZone: string): EvidenceInput[] {
  return rows
    .filter((r) => r.status === "approved")
    .map((r) => ({
      id: r.id,
      title: r.title,
      eventDate: r.event_date,
      approvedDate: r.approved_at ? todayIn(timeZone, new Date(r.approved_at)) : undefined,
      isExpertForecast: r.is_expert_forecast,
      tags: r.evidence_claims.filter((c) => !c.dropped).map((c) => {
        if (c.final_direction === null || c.final_strength === null) {
          throw new Error(`Approved evidence ${r.id} is missing final values for ${c.claim}`);
        }
        return {
          claim: c.claim,
          direction: c.final_direction,
          strength: c.final_strength as Strength,
          discount: Number(c.discount),
        };
      }),
    }));
}

/**
 * Waivers: the latest waiver or revocation per month decides (latest note wins).
 * Satisfied: whichever of satisfied/unsatisfied was recorded last.
 */
export function toArbiterState(rows: ArbiterActionRow[]): ArbiterState {
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const waivers = new Map<string, string>();
  let satisfied: ArbiterState["claimASatisfied"] = null;
  for (const r of sorted) {
    if (r.kind === "decay_waiver" && r.month) waivers.set(r.month, r.note);
    if (r.kind === "decay_waiver_revoked" && r.month) waivers.delete(r.month);
    if (r.kind === "claim_a_satisfied" && r.effective_on) {
      satisfied = { date: r.effective_on, evidenceIds: r.evidence_ids, note: r.note };
    }
    if (r.kind === "claim_a_unsatisfied") satisfied = null;
  }
  return {
    decayWaivers: [...waivers].map(([month, note]) => ({ month, note })),
    claimASatisfied: satisfied,
  };
}
