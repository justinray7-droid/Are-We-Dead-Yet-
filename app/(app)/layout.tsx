import Link from "next/link";
import { countByStatus, loadPeople } from "@/lib/data/evidence.ts";
import { loadConfigVersions } from "@/lib/data/governance.ts";
import { DEFAULT_TIME_ZONE } from "@/lib/data/toEngine.ts";
import { todayIn } from "@/lib/engine/index.ts";
import { rulingOpensOn } from "@/lib/governance/resolution.ts";

export const dynamic = "force-dynamic";

// Shell for signed-in pages: navigation with the pending count.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [{ me }, counts, [latest]] = await Promise.all([loadPeople(), countByStatus(), loadConfigVersions()]);
  const isArbiter = me?.role === "arbiter";
  const { resolutionDate, timeZone } = latest.config;
  const resolutionOpen = todayIn(timeZone ?? DEFAULT_TIME_ZONE) >= rulingOpensOn(resolutionDate);
  return (
    <>
      <nav className="nav">
        <Link href="/" className="brand">
          2031 AI Wager
        </Link>
        <Link href="/evidence">Evidence</Link>
        <Link href="/queue">
          {isArbiter ? "Review" : "Pending"}
          {counts.pending > 0 && <span className="count">{counts.pending}</span>}
        </Link>
        {me && me.role !== "arbiter" && <Link href="/evidence/new">Submit</Link>}
        <Link href="/rules">Rules</Link>
        <Link href="/audit">Audit</Link>
        {resolutionOpen && <Link href="/resolution">Resolution</Link>}
      </nav>
      {children}
    </>
  );
}
