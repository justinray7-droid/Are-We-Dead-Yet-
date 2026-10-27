"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { countByStatus, loadPeople } from "@/lib/data/evidence.ts";
import { loadConfigVersions } from "@/lib/data/governance.ts";
import { DEFAULT_TIME_ZONE } from "@/lib/data/toEngine.ts";
import { todayIn } from "@/lib/engine/index.ts";
import { rulingOpensOn } from "@/lib/governance/resolution.ts";
import { ROLE_LABELS } from "@/lib/identity.ts";
import { useData } from "@/lib/client/useData.ts";
import { getMemberId, isConfigured, setMemberId } from "@/lib/supabase/client.ts";
import { Loading } from "./Loading.tsx";
import { RefreshOnFocus, TabBar } from "./TabBar.tsx";

// Shell for every page once a name is picked: header with who you are, top
// links on wide screens, and the tab bar on phones.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // undefined until local storage has been read in the browser.
  const [memberId, setMember] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const id = getMemberId();
    if (!id) router.replace("/who/");
    setMember(id);
  }, [router]);

  const { data, error } = useData(
    async () => (memberId ? Promise.all([loadPeople(), countByStatus(), loadConfigVersions()]) : null),
    [memberId],
  );
  const me = data?.[0].me;
  // A remembered name that is no longer a member (e.g. a reset database): pick again.
  useEffect(() => {
    if (data && !me) {
      setMemberId(null);
      router.replace("/who/");
    }
  }, [data, me, router]);

  if (!isConfigured) return <SetupNeeded />;
  if (!data || !me) return <Loading error={error} />;

  const [, counts, [latest]] = data;
  const isArbiter = me.role === "arbiter";
  const { resolutionDate, timeZone } = latest.config;
  const resolutionOpen = todayIn(timeZone ?? DEFAULT_TIME_ZONE) >= rulingOpensOn(resolutionDate);
  return (
    <>
      <header className="nav">
        <Link href="/" className="brand">
          2031 AI Wager
        </Link>
        <nav className="toplinks" aria-label="Sections">
          <Link href="/evidence/">Evidence</Link>
          <Link href="/queue/">
            {isArbiter ? "Review" : "Pending"}
            {counts.pending > 0 && <span className="count">{counts.pending}</span>}
          </Link>
          {!isArbiter && <Link href="/evidence/new/">Submit</Link>}
          <Link href="/rules/">Rules</Link>
          <Link href="/audit/">Audit</Link>
          {resolutionOpen && <Link href="/resolution/">Resolution</Link>}
        </nav>
        <Link href="/who/" className="me" title="Switch person">
          {me.name} <span className="muted">· {ROLE_LABELS[me.role]}</span>
        </Link>
      </header>
      <Suspense fallback={<Loading />}>{children}</Suspense>
      <TabBar isArbiter={isArbiter} pending={counts.pending} />
      <RefreshOnFocus />
    </>
  );
}

function SetupNeeded() {
  return (
    <main className="narrow">
      <h1>2031 AI Wager</h1>
      <p className="card">
        This copy of the app was built without its Supabase settings. Add the <code>SUPABASE_URL</code> and{" "}
        <code>SUPABASE_ANON_KEY</code> variables in the GitHub repository settings and run the deploy again (see the
        README).
      </p>
    </main>
  );
}
