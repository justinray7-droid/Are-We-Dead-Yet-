import Link from "next/link";
import { redirect } from "next/navigation";
import { countByStatus, loadPeople } from "@/lib/data/evidence.ts";
import { loadConfigVersions } from "@/lib/data/governance.ts";
import { DEFAULT_TIME_ZONE } from "@/lib/data/toEngine.ts";
import { todayIn } from "@/lib/engine/index.ts";
import { rulingOpensOn } from "@/lib/governance/resolution.ts";
import { ROLE_LABELS } from "@/lib/identity.ts";
import { RefreshOnFocus, TabBar } from "./TabBar.tsx";

export const dynamic = "force-dynamic";

// Shell for every page once a name is picked: header with who you are, top
// links on wide screens, and the tab bar on phones.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { me } = await loadPeople();
  // A remembered name that is no longer a member (e.g. a reset database): pick again.
  if (!me) redirect("/who");
  const [counts, [latest]] = await Promise.all([countByStatus(), loadConfigVersions()]);
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
          <Link href="/evidence">Evidence</Link>
          <Link href="/queue">
            {isArbiter ? "Review" : "Pending"}
            {counts.pending > 0 && <span className="count">{counts.pending}</span>}
          </Link>
          {!isArbiter && <Link href="/evidence/new">Submit</Link>}
          <Link href="/rules">Rules</Link>
          <Link href="/audit">Audit</Link>
          {resolutionOpen && <Link href="/resolution">Resolution</Link>}
        </nav>
        <Link href="/who" className="me" title="Switch person">
          {me.name} <span className="muted">· {ROLE_LABELS[me.role]}</span>
        </Link>
      </header>
      {children}
      <TabBar isArbiter={isArbiter} pending={counts.pending} />
      <RefreshOnFocus />
    </>
  );
}
