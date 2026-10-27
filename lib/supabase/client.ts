import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MEMBER_HEADER, MEMBER_STORAGE_KEY, parseMemberId } from "@/lib/identity.ts";

// The browser talks to Supabase directly (a static app on GitHub Pages). The
// URL and anon key are baked in at build time; the owner chose not to hide them.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isConfigured = URL !== "" && KEY !== "";

/** The member this device picked, or null before anyone has picked. */
export function getMemberId(): string | null {
  try {
    return parseMemberId(window.localStorage.getItem(MEMBER_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function setMemberId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(MEMBER_STORAGE_KEY, id);
    else window.localStorage.removeItem(MEMBER_STORAGE_KEY);
  } catch {
    // Storage blocked (private mode): the picker will simply ask again.
  }
  cached = null;
}

let cached: { member: string | null; client: SupabaseClient } | null = null;

/** Database client acting as the picked member (the database enforces each role). */
export function db(): SupabaseClient {
  const member = getMemberId();
  if (!cached || cached.member !== member) {
    cached = {
      member,
      client: createClient(URL, KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: member ? { [MEMBER_HEADER]: member } : {} },
      }),
    };
  }
  return cached.client;
}
