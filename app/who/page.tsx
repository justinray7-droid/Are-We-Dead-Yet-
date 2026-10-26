import { createClient, currentMemberId } from "@/lib/supabase/server";
import { ROLE_LABELS, type Role } from "@/lib/identity.ts";
import { chooseMember } from "./actions.ts";

export const dynamic = "force-dynamic";

// "Who are you?" Shown the first time this device opens the app, and from the menu to switch.
export default async function WhoPage() {
  const [supabase, current] = await Promise.all([createClient(), currentMemberId()]);
  const { data, error } = await supabase.rpc("member_directory");
  if (error) throw new Error(error.message);
  const members = data as { user_id: string; name: string; role: Role }[];

  return (
    <main className="narrow who">
      <h1>2031 AI Wager</h1>
      <p className="muted">Who&apos;s using this phone? You&apos;ll stay picked until you switch.</p>
      <form action={chooseMember} className="stack">
        {members.map((m) => (
          <button
            key={m.user_id}
            type="submit"
            name="member"
            value={m.user_id}
            className={`who-choice${m.user_id === current ? " current" : ""}`}
          >
            <span className="who-name">{m.name}</span>
            <span className="who-role">
              {ROLE_LABELS[m.role]}
              {m.user_id === current ? " · current" : ""}
            </span>
          </button>
        ))}
      </form>
      <p className="muted small">
        Honor system: pick yourself. Everything you do is recorded under that name in the audit log.
      </p>
    </main>
  );
}
