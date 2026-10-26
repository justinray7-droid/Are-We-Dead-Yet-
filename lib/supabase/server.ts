import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { MEMBER_COOKIE, MEMBER_HEADER, parseMemberId } from "@/lib/identity.ts";

/** The member this browser picked, or null before anyone has picked. */
export async function currentMemberId(): Promise<string | null> {
  return parseMemberId((await cookies()).get(MEMBER_COOKIE)?.value);
}

/**
 * Server-only database client, acting as the picked member. The key is not
 * exposed to browsers (no NEXT_PUBLIC_ prefix), so the database is reachable
 * only through this app; the database enforces each member's role.
 */
export async function createClient() {
  const member = await currentMemberId();
  return createSupabaseClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: member ? { [MEMBER_HEADER]: member } : {} },
  });
}
