import Link from "next/link";
import { listEvidence, loadPeople } from "@/lib/data/evidence.ts";
import { EvidenceList } from "../evidence/EvidenceList.tsx";

// Pending queue, visible to all three. For Shaun it is the arbiter queue.
// Decay waivers and the Claim A satisfied controls join this page in Phase 5.
export default async function QueuePage() {
  const [items, { me, names }] = await Promise.all([listEvidence(["pending", "needs_changes"]), loadPeople()]);
  // Oldest first, so nothing waits forever.
  const byAge = [...items].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
  const pending = byAge.filter((e) => e.status === "pending");
  const waiting = byAge.filter((e) => e.status === "needs_changes");
  const isArbiter = me?.role === "arbiter";

  return (
    <main>
      <h1>{isArbiter ? "Arbiter queue" : "Pending queue"}</h1>
      <p className="muted">
        {isArbiter
          ? "Open an item to approve, reject or request changes. Approval recomputes every probability."
          : "Shaun reviews these. Only approved evidence moves the probability."}
      </p>
      <h2>Awaiting review ({pending.length})</h2>
      <EvidenceList items={pending} names={names} steps={[]} empty="Nothing waiting for review." />
      <h2>Sent back for changes ({waiting.length})</h2>
      <EvidenceList items={waiting} names={names} steps={[]} empty="Nothing sent back." />
      {me && !isArbiter && (
        <p>
          <Link href="/evidence/new">Submit evidence →</Link>
        </p>
      )}
    </main>
  );
}
