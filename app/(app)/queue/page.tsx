import Link from "next/link";
import { decayMonthEnds, monthOf } from "@/lib/engine/index.ts";
import { listEvidence, loadPeople } from "@/lib/data/evidence.ts";
import { loadArbiterActions } from "@/lib/data/governance.ts";
import { loadSnapshot } from "@/lib/data/load.ts";
import { formatDateTime, pct } from "@/lib/evidence/labels.ts";
import { EvidenceList } from "../evidence/EvidenceList.tsx";
import { ActionForm } from "../ActionForm.tsx";
import { markSatisfied, revokeWaiver, unmarkSatisfied, waiveDecay } from "./actions.ts";

// Pending queue, visible to all three. For Shaun it is the arbiter queue, with
// the decay-waiver and Claim A satisfied controls.
export default async function QueuePage() {
  const [items, { me, names }, snapshot, actions] = await Promise.all([
    listEvidence(),
    loadPeople(),
    loadSnapshot(),
    loadArbiterActions(),
  ]);
  const { result, config, timeZone } = snapshot;
  // Oldest first, so nothing waits forever.
  const byAge = [...items].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
  const pending = byAge.filter((e) => e.status === "pending");
  const waiting = byAge.filter((e) => e.status === "needs_changes");
  const approved = items.filter((e) => e.status === "approved");
  const isArbiter = me?.role === "arbiter";

  // Current waivers: the engine's view (latest action per month wins), with notes.
  const waivedSteps = result.steps.filter((s) => s.kind === "decay" && s.status === "waived");
  const futureWaivers = new Map<string, string>();
  for (const a of [...actions].reverse()) {
    if (a.kind === "decay_waiver" && a.month) futureWaivers.set(a.month, a.note);
    if (a.kind === "decay_waiver_revoked" && a.month) futureWaivers.delete(a.month);
  }
  const pastMonths = new Set(result.steps.filter((s) => s.kind === "decay").map((s) => s.id.slice(6)));
  const upcomingWaivers = [...futureWaivers].filter(([m]) => !pastMonths.has(m));
  const stepStatus = new Map(result.steps.filter((s) => s.kind === "decay").map((s) => [s.id.slice(6), s.status]));
  const months = decayMonthEnds(config.startDate, config.resolutionDate).map(monthOf);
  const thisMonth = result.asOf.slice(0, 7);
  const satisfied = actions.find((a) => a.kind === "claim_a_satisfied" || a.kind === "claim_a_unsatisfied");
  const isSatisfied = satisfied?.kind === "claim_a_satisfied";
  const titles = new Map(items.map((e) => [e.id, e.title]));
  // Approved items tagged to Claim A first.
  const linkable = [...approved].sort(
    (a, b) =>
      Number(b.evidence_claims.some((c) => c.claim === "A" && !c.dropped)) -
        Number(a.evidence_claims.some((c) => c.claim === "A" && !c.dropped)) || b.event_date.localeCompare(a.event_date),
  );

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

      <h2>Claim A</h2>
      <section className="card stack">
        {isSatisfied && satisfied ? (
          <>
            <p>
              <span className="badge">Satisfied</span> since {satisfied.effective_on}. P(A) is fixed at 100% and decay has
              stopped. This does not decide the bet; Shaun&apos;s final ruling does.
            </p>
            <p className="small">{satisfied.note}</p>
            <ul className="small">
              {satisfied.evidence_ids.map((id) => (
                <li key={id}>
                  <Link href={`/evidence/${id}`}>{titles.get(id) ?? id}</Link>
                </li>
              ))}
            </ul>
            {isArbiter && (
              <ActionForm action={unmarkSatisfied} buttons={[{ label: "Reverse satisfied mark", secondary: true }]}>
                <label htmlFor="unmark_note">Why (required)</label>
                <input id="unmark_note" name="note" />
              </ActionForm>
            )}
          </>
        ) : (
          <>
            <p className="muted">
              Not marked satisfied. P(A) is {pct(result.probabilities.A)}.
              {isArbiter && " Mark it when the definition has been met outright; you can reverse it later."}
            </p>
            {isArbiter && (
              <ActionForm action={markSatisfied} buttons={[{ label: "Mark Claim A satisfied" }]}>
                <fieldset className="stack plain">
                  <legend>Evidence that meets the definition</legend>
                  {linkable.length === 0 && <p className="muted small">No approved evidence yet.</p>}
                  {linkable.map((e) => (
                    <label key={e.id} className="check small">
                      <input type="checkbox" name="evidence_ids" value={e.id} />
                      {e.event_date} · {e.title}
                    </label>
                  ))}
                </fieldset>
                <label htmlFor="effective_on">Satisfied from</label>
                <input id="effective_on" name="effective_on" type="date" min={config.startDate} max={result.asOf} defaultValue={result.asOf} />
                <label htmlFor="sat_note">Why the definition is met</label>
                <textarea id="sat_note" name="note" rows={3} />
              </ActionForm>
            )}
          </>
        )}
      </section>

      <h2>Decay waivers</h2>
      <section className="card stack">
        {waivedSteps.length === 0 && upcomingWaivers.length === 0 && <p className="muted">No months waived.</p>}
        {[...waivedSteps.map((s) => [s.id.slice(6), s.note ?? ""] as const), ...upcomingWaivers].map(([month, note]) => (
          <div key={month} className="stack">
            <div>
              <strong>{month}</strong> waived{note ? `: ${note}` : ""}
            </div>
            {isArbiter && (
              <ActionForm action={revokeWaiver.bind(null, month)} buttons={[{ label: "Revoke waiver", secondary: true }]} className="row">
                <input name="note" aria-label={`Why revoke the ${month} waiver`} placeholder="Why revoke (required)" />
              </ActionForm>
            )}
          </div>
        ))}
        {isArbiter && months.length === 0 && <p className="muted small">No decay steps fall before the resolution date.</p>}
        {isArbiter && months.length > 0 && (
          <details>
            <summary>Waive a month&apos;s decay step</summary>
            <ActionForm action={waiveDecay} buttons={[{ label: "Waive" }]}>
              <label htmlFor="month">Month</label>
              <select id="month" name="month" defaultValue={months.includes(thisMonth) ? thisMonth : months[0]}>
                {months.map((m) => {
                  const st = stepStatus.get(m);
                  return (
                    <option key={m} value={m}>
                      {m}
                      {st === "applied" ? " (applied)" : st === "skipped" ? " (skipped: qualifying evidence)" : st === "waived" ? " (waived)" : ""}
                    </option>
                  );
                })}
              </select>
              <label htmlFor="waive_note">Why (required)</label>
              <input id="waive_note" name="note" />
            </ActionForm>
          </details>
        )}
        <p className="muted small">
          A waived month&apos;s step is not applied. Every waiver and revocation is in the{" "}
          <Link href="/audit">audit log</Link>
          {actions[0] ? ` (latest arbiter action ${formatDateTime(actions[0].created_at, timeZone)})` : ""}.
        </p>
      </section>
    </main>
  );
}
