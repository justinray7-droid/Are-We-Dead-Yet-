import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadSnapshot } from "@/lib/data/load.ts";
import { evidenceCsv, historyCsv, type ExportEvidence } from "@/lib/export/export.ts";

export const dynamic = "force-dynamic";

const FILES = ["wager-export.json", "evidence.csv", "history.csv"] as const;

// One-click export for members (RLS limits the queries to members).
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!(FILES as readonly string[]).includes(file)) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const snapshot = await loadSnapshot();
  const day = snapshot.result.asOf;
  const attach = (name: string) => `attachment; filename="wager-${day}-${name}"`;

  const [evidenceRes, membersRes] = await Promise.all([
    supabase
      .from("evidence")
      .select(
        "id, title, summary, source_url, source_type, event_date, status, is_expert_forecast, rationale, decision_note, " +
          "submitted_by, submitted_at, decided_at, approved_at, " +
          "evidence_claims(claim, proposed_direction, proposed_strength, final_direction, final_strength, discount, dropped)",
      )
      .order("event_date"),
    supabase.from("members").select("user_id, name, role"),
  ]);
  if (evidenceRes.error || membersRes.error) {
    return new NextResponse((evidenceRes.error ?? membersRes.error)!.message, { status: 500 });
  }
  const evidence = evidenceRes.data as unknown as ExportEvidence[];
  const members = membersRes.data as { user_id: string | null; name: string; role: string }[];
  const names = new Map(members.filter((m) => m.user_id).map((m) => [m.user_id!, m.name]));

  if (file === "evidence.csv") {
    return new NextResponse(evidenceCsv(evidence, names, snapshot.result.steps), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": attach("evidence.csv") },
    });
  }
  if (file === "history.csv") {
    return new NextResponse(historyCsv(snapshot.result), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": attach("history.csv") },
    });
  }

  const [comments, links, actions, configs, defVersions, definitions, requests, approvals] = await Promise.all([
    supabase.from("comments").select("id, evidence_id, author, body, created_at").order("created_at"),
    supabase.from("evidence_links").select("evidence_id, related_id"),
    supabase.from("arbiter_actions").select("*").order("created_at"),
    supabase.from("config_versions").select("*").order("version"),
    supabase.from("definition_versions").select("*").order("version"),
    supabase.from("definitions").select("*").order("version"),
    supabase.from("change_requests").select("*").order("created_at"),
    supabase.from("change_approvals").select("*").order("at"),
  ]);
  const body = {
    exported_at: new Date().toISOString(),
    as_of: day,
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
    evidence_links: links.data,
    comments: comments.data,
    arbiter_actions: actions.data,
    config_versions: configs.data,
    definition_versions: defVersions.data,
    definitions: definitions.data,
    change_requests: requests.data,
    change_approvals: approvals.data,
  };
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": attach("export.json") },
  });
}
