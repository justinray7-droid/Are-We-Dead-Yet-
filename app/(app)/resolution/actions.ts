"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseRuling } from "@/lib/governance/resolution.ts";
import type { ActionState } from "../ActionForm.tsx";

/** Shaun's final ruling. The database checks the window and that every claim is ruled on. */
export async function recordRuling(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = parseRuling(form);
  if (!parsed.ok) return { errors: parsed.errors };
  const supabase = await createClient();
  const { error } = await supabase
    .from("arbiter_actions")
    .insert({ kind: "final_ruling", payload: parsed.value.payload, note: parsed.value.note });
  if (error) return { errors: { form: error.message } };
  revalidatePath("/", "layout");
  return { errors: {}, done: true };
}
