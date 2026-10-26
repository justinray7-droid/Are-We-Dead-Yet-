// Turns raw audit_log rows into readable lines. Pure, so it runs under node --test.

export interface AuditRow {
  id: number;
  at: string;
  actor: string | null;
  action: "insert" | "update" | "delete";
  entity: string;
  entity_id: string | null;
  details: { new?: Record<string, unknown>; old?: Record<string, unknown> };
}

export type AuditCategory = "evidence" | "review" | "tags" | "discussion" | "arbiter" | "settings" | "definitions" | "requests";

export const AUDIT_CATEGORIES: Record<AuditCategory, string> = {
  evidence: "Submissions and edits",
  review: "Arbiter decisions",
  tags: "Claim tags and links",
  discussion: "Comments",
  arbiter: "Waivers and Claim A",
  settings: "Settings",
  definitions: "Definitions",
  requests: "Change requests",
};

export interface AuditLine {
  category: AuditCategory;
  text: string;
  /** Extra detail such as a note or comment, shown under the line. */
  detail?: string;
  href?: string;
}

const CLAIM = { A: "A", B_LOOSE: "B-loose", B_STRICT: "B-strict", C: "C" } as Record<string, string>;
const STATUS_VERB: Record<string, string> = {
  approved: "approved",
  rejected: "rejected",
  needs_changes: "requested changes on",
  pending: "resubmitted",
};

const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const excerpt = (s: string, n = 140) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const dayMs = 86_400_000;

/** " (happened 2027-01-20)", plus "added late" when approved long after the event. */
function happened(n: Record<string, unknown>, backdateDays: number): string {
  const ev = str(n.event_date);
  if (!ev) return "";
  const approved = str(n.approved_at);
  const late = approved && Date.parse(approved) - Date.parse(ev + "T00:00:00Z") > (backdateDays + 1) * dayMs;
  return ` (happened ${ev}${late ? ", added late" : ""})`;
}

export function describeAudit(row: AuditRow, titles: Map<string, string>, backdateDays = 30): AuditLine {
  const n = row.details.new ?? {};
  const o = row.details.old ?? {};
  const rec = row.action === "delete" ? o : n;
  const evId = row.entity_id ?? "";
  const title = `“${titles.get(evId) ?? str(rec.title) ?? "an item"}”`;
  const evHref = evId ? `/evidence/${evId}` : undefined;

  switch (row.entity) {
    case "evidence": {
      if (row.action === "insert") return { category: "evidence", text: `submitted ${title}${happened(n, backdateDays)}`, href: evHref };
      if (n.status !== o.status) {
        return {
          category: "review",
          text: `${STATUS_VERB[str(n.status)] ?? `set status ${str(n.status)} on`} ${title}${n.status === "approved" ? happened(n, backdateDays) : ""}`,
          detail: str(n.decision_note) || undefined,
          href: evHref,
        };
      }
      return { category: "evidence", text: `edited ${title}`, href: evHref };
    }
    case "evidence_claims": {
      const claim = CLAIM[str(rec.claim)] ?? str(rec.claim);
      if (row.action === "delete") return { category: "tags", text: `removed the ${claim} tag from ${title}`, href: evHref };
      if (n.dropped === true && o.dropped !== true) return { category: "tags", text: `dropped the ${claim} tag from ${title}`, href: evHref };
      if (n.final_direction && (n.final_direction !== o.final_direction || n.final_strength !== o.final_strength || n.discount !== o.discount)) {
        const disc = Number(n.discount) !== 1 ? `, discount ${Number(n.discount)}` : "";
        return {
          category: "tags",
          text: `set ${claim} on ${title} to ${str(n.final_direction)} ${str(n.final_strength)}${disc}`,
          href: evHref,
        };
      }
      if (row.action === "insert") {
        return {
          category: "tags",
          text: `tagged ${title} ${claim}${n.proposed_direction ? ` (proposed ${str(n.proposed_direction)} ${str(n.proposed_strength)})` : ""}`,
          href: evHref,
        };
      }
      return { category: "tags", text: `updated the ${claim} tag on ${title}`, href: evHref };
    }
    case "evidence_links": {
      const other = `“${titles.get(str(rec.related_id)) ?? "another item"}”`;
      return {
        category: "tags",
        text: row.action === "delete" ? `unlinked ${title} from ${other}` : `linked ${title} to ${other}`,
        href: evHref,
      };
    }
    case "comments": {
      const target = str(n.evidence_id);
      return {
        category: "discussion",
        text: `commented on “${titles.get(target) ?? "an item"}”`,
        detail: excerpt(str(n.body)),
        href: target ? `/evidence/${target}` : undefined,
      };
    }
    case "arbiter_actions": {
      const note = str(n.note) || undefined;
      switch (n.kind) {
        case "decay_waiver":
          return { category: "arbiter", text: `waived the ${str(n.month)} decay step`, detail: note, href: "/queue" };
        case "decay_waiver_revoked":
          return { category: "arbiter", text: `revoked the ${str(n.month)} decay waiver`, detail: note, href: "/queue" };
        case "claim_a_satisfied":
          return { category: "arbiter", text: `marked Claim A satisfied from ${str(n.effective_on)}`, detail: note, href: "/queue" };
        case "claim_a_unsatisfied":
          return { category: "arbiter", text: "reversed the Claim A satisfied mark", detail: note, href: "/queue" };
        case "final_ruling": {
          const overall = (n.payload as { overall?: string } | undefined)?.overall;
          return { category: "arbiter", text: `recorded the final ruling: the bet resolves ${overall ?? "?"}`, detail: note, href: "/resolution" };
        }
        default:
          return { category: "arbiter", text: `recorded ${str(n.kind)}`, detail: note };
      }
    }
    case "config_versions":
      return { category: "settings", text: `saved settings v${str(n.version)}`, detail: str(n.note) || undefined, href: "/rules#settings" };
    case "definition_versions":
      return { category: "definitions", text: `definitions v${str(n.version)} took effect`, detail: str(n.change_log) || undefined, href: "/rules" };
    case "change_requests": {
      const kind = n.kind === "priors" ? "priors" : "definitions";
      const href = `/rules#request-${evId}`;
      if (row.action === "insert") return { category: "requests", text: `proposed a ${kind} change`, detail: str(n.rationale) || undefined, href };
      if (n.status === "applied") return { category: "requests", text: `the ${kind} change was approved by all three and applied`, href };
      if (n.status === "rejected") return { category: "requests", text: `the ${kind} change was rejected`, href };
      return { category: "requests", text: `updated a ${kind} change request`, href };
    }
    case "change_approvals":
      return {
        category: "requests",
        text: n.decision === "reject" ? "rejected a change request" : "approved a change request",
        detail: str(n.note) && n.note !== "Proposed it" ? str(n.note) : undefined,
        href: `/rules#request-${evId}`,
      };
    default:
      return { category: "settings", text: `${row.action} on ${row.entity}` };
  }
}
