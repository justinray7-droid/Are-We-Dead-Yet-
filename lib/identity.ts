// Honor-system identity: the member each person picked, kept in a cookie and
// sent to the database in a header (see supabase/migrations/0005_honor_system.sql).
// Pure, so middleware (edge runtime) and node --test can both use it.

export const MEMBER_COOKIE = "wager_member";
export const MEMBER_HEADER = "x-wager-member";
/** Browsers cap cookie lifetimes at 400 days; picking again renews it. */
export const MEMBER_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The cookie's member id, or null if it is missing or malformed. */
export function parseMemberId(value: string | undefined | null): string | null {
  return value && UUID_RE.test(value) ? value.toLowerCase() : null;
}

export type Role = "arbiter" | "yes" | "no";

export const ROLE_LABELS: Record<Role, string> = {
  yes: "YES side",
  no: "NO side",
  arbiter: "Arbiter",
};
