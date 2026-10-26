import Link from "next/link";
import { notFound } from "next/navigation";
import { todayIn } from "@/lib/engine/index.ts";
import { DEFAULT_TIME_ZONE } from "@/lib/data/toEngine.ts";
import { loadEvidence, loadPeople } from "@/lib/data/evidence.ts";
import type { FormValues } from "@/lib/evidence/form.ts";
import { resubmitEvidence } from "../../actions.ts";
import { EvidenceForm } from "../../EvidenceForm.tsx";

export default async function EditEvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [loaded, { me }] = await Promise.all([loadEvidence(id), loadPeople()]);
  if (!loaded) notFound();
  const { item } = loaded;

  const editable = me?.user_id === item.submitted_by && (item.status === "pending" || item.status === "needs_changes");
  if (!editable) {
    return (
      <main>
        <h1>Edit evidence</h1>
        <p className="card">
          Only the submitter can edit an item, and only before Shaun approves or rejects it.{" "}
          <Link href={`/evidence/${id}`}>Back to the item</Link>
        </p>
      </main>
    );
  }

  const initial: FormValues = {
    title: item.title,
    summary: item.summary,
    source_url: item.source_url,
    source_type: item.source_type,
    event_date: item.event_date,
    rationale: item.rationale,
  };
  for (const c of item.evidence_claims) {
    if (c.dropped || !c.proposed_direction || !c.proposed_strength) continue;
    initial[`tag_${c.claim}`] = "on";
    initial[`direction_${c.claim}`] = c.proposed_direction;
    initial[`strength_${c.claim}`] = String(c.proposed_strength);
  }

  return (
    <main>
      <h1>Edit evidence</h1>
      {item.status === "needs_changes" && item.decision_note && (
        <p className="card">
          <strong>Shaun asked for changes:</strong> {item.decision_note}
        </p>
      )}
      <EvidenceForm
        action={resubmitEvidence.bind(null, id)}
        initial={initial}
        today={todayIn(DEFAULT_TIME_ZONE)}
        submitLabel={item.status === "needs_changes" ? "Resubmit for review" : "Save changes"}
      />
    </main>
  );
}
