import Link from "next/link";
import { listEvidence, loadPeople, STATUSES, type Status } from "@/lib/data/evidence.ts";
import { loadSnapshot } from "@/lib/data/load.ts";
import { STATUS_LABELS } from "@/lib/evidence/labels.ts";
import { EvidenceList } from "./EvidenceList.tsx";

// Evidence log. Fuller filters (claim, direction, strength, decay steps) come in Phase 5.
export default async function EvidencePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const filter = STATUSES.includes(status as Status) ? (status as Status) : undefined;
  const [items, { names }, snapshot] = await Promise.all([
    listEvidence(filter ? [filter] : undefined),
    loadPeople(),
    loadSnapshot(),
  ]);

  return (
    <main>
      <h1>Evidence</h1>
      <nav className="tabs" aria-label="Filter by status">
        <Link href="/evidence" aria-current={!filter ? "page" : undefined}>
          All
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/evidence?status=${s}`} aria-current={filter === s ? "page" : undefined}>
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </nav>
      <EvidenceList
        items={items}
        names={names}
        steps={snapshot.result.steps}
        empty={filter ? `No ${STATUS_LABELS[filter].toLowerCase()} items.` : "No evidence yet."}
      />
    </main>
  );
}
