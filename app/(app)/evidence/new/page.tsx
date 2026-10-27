"use client";

import { useData } from "@/lib/client/useData.ts";
import { Loading } from "../../Loading.tsx";
import { todayIn } from "@/lib/engine/index.ts";
import { DEFAULT_TIME_ZONE } from "@/lib/data/toEngine.ts";
import { loadPeople } from "@/lib/data/evidence.ts";
import { submitEvidence } from "../actions.ts";
import { EvidenceForm } from "../EvidenceForm.tsx";

export default function NewEvidencePage() {
  const { data, error } = useData(loadPeople, []);
  if (!data) return <Loading error={error} />;
  const { me } = data;
  if (me?.role === "arbiter") {
    return (
      <main>
        <h1>Submit evidence</h1>
        <p className="card">Evidence is submitted by the bettors. As arbiter you review it from the queue.</p>
      </main>
    );
  }
  return (
    <main>
      <h1>Submit evidence</h1>
      <p className="muted">It goes into the pending queue for Shaun to review. You can edit it until he decides.</p>
      <EvidenceForm action={submitEvidence} initial={{}} today={todayIn(DEFAULT_TIME_ZONE)} submitLabel="Submit for review" />
    </main>
  );
}
