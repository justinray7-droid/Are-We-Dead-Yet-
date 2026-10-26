// Parses and validates the evidence forms. Pure, so it runs under node --test.
// The database enforces the same rules; this gives friendlier messages first.

import { CLAIMS, type ClaimId, type Direction, type ISODate, type Strength } from "../engine/index.ts";

export const SOURCE_TYPES = {
  peer_reviewed: "Peer-reviewed paper",
  company_announcement: "Company announcement",
  news_report: "News report",
  independent_replication: "Independent replication",
  other: "Other",
} as const;
export type SourceType = keyof typeof SOURCE_TYPES;

export const DECISIONS = {
  approved: "Approve",
  needs_changes: "Request changes",
  rejected: "Reject",
} as const;
export type Decision = keyof typeof DECISIONS;

export interface FormLike {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
}

/** Raw submitted values, echoed back so a form with errors keeps its input. */
export type FormValues = Record<string, string | string[]>;

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

export interface Submission {
  title: string;
  summary: string;
  source_url: string;
  source_type: SourceType;
  event_date: ISODate;
  rationale: string;
  claims: { claim: ClaimId; direction: Direction; strength: Strength }[];
}

export interface Review {
  decision: Decision;
  note: string;
  /** Final values; only meaningful when approving. */
  claims: { claim: ClaimId; direction: Direction; strength: Strength; discount: number }[];
  isExpertForecast: boolean;
  links: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function text(form: FormLike, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

function checked(form: FormLike, name: string): boolean {
  return form.get(name) !== null;
}

function direction(v: string): Direction | null {
  return v === "YES" || v === "NO" ? v : null;
}

function strength(v: string): Strength | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? (n as Strength) : null;
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isRealDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function formValues(form: FormLike & { keys(): IterableIterator<string> }): FormValues {
  const out: FormValues = {};
  for (const key of new Set(form.keys())) {
    if (key.startsWith("$")) continue; // React's internal action fields
    const all = form.getAll(key).filter((v): v is string => typeof v === "string");
    out[key] = key === "links" ? all : (all[0] ?? "");
  }
  return out;
}

export function parseSubmission(form: FormLike, today: ISODate): Parsed<Submission> {
  const errors: Record<string, string> = {};

  const title = text(form, "title");
  if (title.length < 3 || title.length > 200) errors.title = "Give it a title between 3 and 200 characters.";

  const source_url = text(form, "source_url");
  if (!isHttpUrl(source_url)) errors.source_url = "A source link starting with http:// or https:// is required.";

  const source_type = text(form, "source_type");
  if (!(source_type in SOURCE_TYPES)) errors.source_type = "Pick a source type.";

  const event_date = text(form, "event_date");
  if (!isRealDate(event_date)) errors.event_date = "Enter the date the event happened.";
  else if (event_date > today) errors.event_date = "The event date can't be in the future.";

  const rationale = text(form, "rationale");
  if (!rationale) errors.rationale = "Explain why this evidence matters.";

  const claims: Submission["claims"] = [];
  for (const claim of CLAIMS) {
    if (!checked(form, `tag_${claim}`)) continue;
    const d = direction(text(form, `direction_${claim}`));
    const s = strength(text(form, `strength_${claim}`));
    if (!d || !s) errors.claims = "Choose a direction and strength for every claim you tag.";
    else claims.push({ claim, direction: d, strength: s });
  }
  if (claims.length === 0 && !errors.claims) errors.claims = "Tag at least one claim.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      summary: text(form, "summary"),
      source_url,
      source_type: source_type as SourceType,
      event_date,
      rationale,
      claims,
    },
  };
}

export function parseReview(form: FormLike, selfId: string): Parsed<Review> {
  const errors: Record<string, string> = {};

  const decision = text(form, "decision");
  if (!(decision in DECISIONS)) errors.decision = "Choose approve, request changes, or reject.";

  const note = text(form, "note");
  if ((decision === "rejected" || decision === "needs_changes") && !note) {
    errors.note = decision === "rejected" ? "A reason is required to reject." : "Say what needs to change.";
  }

  const claims: Review["claims"] = [];
  if (decision === "approved") {
    for (const claim of CLAIMS) {
      if (!checked(form, `tag_${claim}`)) continue;
      const d = direction(text(form, `direction_${claim}`));
      const s = strength(text(form, `strength_${claim}`));
      const rawDiscount = text(form, `discount_${claim}`);
      const discount = rawDiscount === "" ? 1 : Number(rawDiscount);
      if (!d || !s) errors.claims = "Set a final direction and strength on every claim you keep.";
      else if (!(discount >= 0 && discount <= 1)) errors.claims = "Correlation discounts must be between 0 and 1.";
      else claims.push({ claim, direction: d, strength: s, discount });
    }
    if (claims.length === 0 && !errors.claims) errors.claims = "Keep at least one claim tag to approve.";
  }

  const links = form
    .getAll("links")
    .filter((v): v is string => typeof v === "string" && UUID_RE.test(v) && v !== selfId);

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      decision: decision as Decision,
      note,
      claims,
      isExpertForecast: checked(form, "is_expert_forecast"),
      links: [...new Set(links)],
    },
  };
}
