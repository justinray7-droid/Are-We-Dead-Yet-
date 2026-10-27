// Honor-system identity: the member each person picked, kept in the device's
// local storage and sent to the database in a header (see
// supabase/migrations/0005_honor_system.sql). Pure, so node --test can use it.

export const MEMBER_STORAGE_KEY = "wager_member";
export const MEMBER_HEADER = "x-wager-member";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The stored member id, or null if it is missing or malformed. */
export function parseMemberId(value: string | undefined | null): string | null {
  return value && UUID_RE.test(value) ? value.toLowerCase() : null;
}

export type Role = "arbiter" | "yes" | "no";

export const ROLE_LABELS: Record<Role, string> = {
  yes: "YES side",
  no: "NO side",
  arbiter: "Arbiter",
};
