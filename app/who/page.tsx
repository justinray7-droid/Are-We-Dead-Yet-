"use client";

import { useRouter } from "next/navigation";
import { ROLE_LABELS, type Role } from "@/lib/identity.ts";
import { useData } from "@/lib/client/useData.ts";
import { db, getMemberId, isConfigured, setMemberId } from "@/lib/supabase/client.ts";

type Member = { user_id: string; name: string; role: Role };

// "Who are you?" Shown the first time this device opens the app, and from the menu to switch.
export default function WhoPage() {
  const router = useRouter();
  const { data, error } = useData(async () => {
    const { data, error } = await db().rpc("member_directory");
    if (error) throw new Error(error.message);
    return { members: data as Member[], current: getMemberId() };
  }, []);

  function choose(id: string) {
    setMemberId(id); // honor system: remember who this is on this device
    router.push("/");
  }

  return (
    <main className="narrow who">
      <h1>2031 AI Wager</h1>
      <p className="muted">Who&apos;s using this phone? You&apos;ll stay picked until you switch.</p>
      {!isConfigured && <p className="error">This copy of the app was built without its Supabase settings.</p>}
      {error && <p className="error">Couldn&apos;t reach the database: {error.message}</p>}
      {!data && !error && isConfigured && <p className="muted">Loading…</p>}
      <div className="stack">
        {data?.members.map((m) => (
          <button
            key={m.user_id}
            type="button"
            onClick={() => choose(m.user_id)}
            className={`who-choice${m.user_id === data.current ? " current" : ""}`}
          >
            <span className="who-name">{m.name}</span>
            <span className="who-role">
              {ROLE_LABELS[m.role]}
              {m.user_id === data.current ? " · current" : ""}
            </span>
          </button>
        ))}
      </div>
      <p className="muted small">
        Honor system: pick yourself. Everything you do is recorded under that name in the audit log.
      </p>
    </main>
  );
}
