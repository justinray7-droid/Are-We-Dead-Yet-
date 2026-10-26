import { createClient } from "@/lib/supabase/server";
import type { ClaimId, Direction } from "@/lib/engine/index.ts";
import type { SourceType } from "@/lib/evidence/form.ts";

export type Role = "arbiter" | "yes" | "no";
export type Status = "pending" | "approved" | "rejected" | "needs_changes";
export const STATUSES: readonly Status[] = ["pending", "needs_changes", "approved", "rejected"];

export interface Member {
  user_id: string | null;
  name: string;
  role: Role;
}

export interface ClaimTagRow {
  claim: ClaimId;
  proposed_direction: Direction | null;
  proposed_strength: number | null;
  final_direction: Direction | null;
  final_strength: number | null;
  discount: number | string;
  dropped: boolean;
}

export interface EvidenceItem {
  id: string;
  title: string;
  summary: string;
  source_url: string;
  source_type: SourceType;
  event_date: string;
  is_expert_forecast: boolean;
  rationale: string;
  status: Status;
  decision_note: string | null;
  submitted_by: string;
  submitted_at: string;
  decided_by: string | null;
  decided_at: string | null;
  approved_at: string | null;
  evidence_claims: ClaimTagRow[];
}

export interface CommentRow {
  id: string;
  author: string;
  body: string;
  created_at: string;
}

const ITEM_COLUMNS =
  "id, title, summary, source_url, source_type, event_date, is_expert_forecast, rationale, status, decision_note, " +
  "submitted_by, submitted_at, decided_by, decided_at, approved_at, " +
  "evidence_claims(claim, proposed_direction, proposed_strength, final_direction, final_strength, discount, dropped)";

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/** The signed-in member plus everyone's names, for "submitted by" labels. */
export async function loadPeople(): Promise<{ me: (Member & { user_id: string }) | null; names: Map<string, string> }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const members = check(await supabase.from("members").select("user_id, name, role")) as Member[];
  const names = new Map(members.filter((m) => m.user_id).map((m) => [m.user_id!, m.name]));
  const me = members.find((m) => user && m.user_id === user.id);
  return { me: me ? { ...me, user_id: me.user_id! } : null, names };
}

export async function listEvidence(statuses?: readonly Status[]): Promise<EvidenceItem[]> {
  const supabase = await createClient();
  let q = supabase.from("evidence").select(ITEM_COLUMNS);
  if (statuses) q = q.in("status", statuses as Status[]);
  const rows = check(await q.order("event_date", { ascending: false }).order("submitted_at", { ascending: false }));
  return rows as unknown as EvidenceItem[];
}

export async function loadEvidence(id: string): Promise<{
  item: EvidenceItem;
  comments: CommentRow[];
  links: { id: string; title: string; event_date: string; status: Status }[];
} | null> {
  const supabase = await createClient();
  const [itemRes, commentsRes, linksRes] = await Promise.all([
    supabase.from("evidence").select(ITEM_COLUMNS).eq("id", id).maybeSingle(),
    supabase.from("comments").select("id, author, body, created_at").eq("evidence_id", id).order("created_at"),
    supabase.from("evidence_links").select("related_id").eq("evidence_id", id),
  ]);
  const item = check(itemRes) as unknown as EvidenceItem | null;
  if (!item) return null;
  const relatedIds = (check(linksRes) as { related_id: string }[]).map((l) => l.related_id);
  const links =
    relatedIds.length === 0
      ? []
      : (check(
          await supabase.from("evidence").select("id, title, event_date, status").in("id", relatedIds).order("event_date"),
        ) as { id: string; title: string; event_date: string; status: Status }[]);
  return { item, comments: check(commentsRes) as CommentRow[], links };
}

export async function countByStatus(): Promise<Record<Status, number>> {
  const supabase = await createClient();
  const rows = check(await supabase.from("evidence").select("status")) as { status: Status }[];
  const out: Record<Status, number> = { pending: 0, approved: 0, rejected: 0, needs_changes: 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}
