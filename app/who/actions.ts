"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MEMBER_COOKIE, MEMBER_COOKIE_MAX_AGE, parseMemberId } from "@/lib/identity.ts";

/** Honor system: remember who this is on this device. */
export async function chooseMember(form: FormData) {
  const id = parseMemberId(String(form.get("member") ?? ""));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("member_directory");
  if (error) throw new Error(error.message);
  if (!id || !(data as { user_id: string }[]).some((m) => m.user_id === id)) redirect("/who");
  (await cookies()).set(MEMBER_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MEMBER_COOKIE_MAX_AGE,
  });
  redirect("/");
}
