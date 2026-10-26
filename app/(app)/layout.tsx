import Link from "next/link";
import { countByStatus, loadPeople } from "@/lib/data/evidence.ts";

export const dynamic = "force-dynamic";

// Shell for signed-in pages: navigation with the pending count.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [{ me }, counts] = await Promise.all([loadPeople(), countByStatus()]);
  const isArbiter = me?.role === "arbiter";
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
      </nav>
      {children}
    </>
  );
}
