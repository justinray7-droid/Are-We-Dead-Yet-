import Link from "next/link";
import { CLAIMS, STRENGTH_LABELS, type ClaimId } from "@/lib/engine/index.ts";
import { loadPeople } from "@/lib/data/evidence.ts";
import { loadChangeRequests, loadConfigVersions, loadDefinitions, type ChangeRequest } from "@/lib/data/governance.ts";
import { DEFINITION_KEYS, type Definitions } from "@/lib/governance/forms.ts";
import { CLAIM_SHORT, STRENGTH_ANCHORS, formatDateTime, pct } from "@/lib/evidence/labels.ts";
import { DEFAULT_TIME_ZONE } from "@/lib/data/toEngine.ts";
import { ActionForm } from "../ActionForm.tsx";
import { decideRequest, proposeDefinitions, proposePriors, updateConfig } from "./actions.ts";

const fmt = (iso: string) => formatDateTime(iso, DEFAULT_TIME_ZONE);

function RequestCard({
  r,
  definitions,
  priors,
  names,
  myId,
  members,
}: {
  r: ChangeRequest;
  definitions: Definitions;
  priors: Record<ClaimId, number>;
  names: Map<string, string>;
  myId: string | undefined;
  members: { user_id: string; name: string }[];
}) {
  const mine = r.approvals.find((a) => a.approver === myId);
  const needed = r.kind === "priors" ? "Needs both bettors and Shaun." : "Needs all three.";
  return (
    <div className="card stack" id={`request-${r.id}`}>
      <div className="row spread">
        <strong>{r.kind === "priors" ? "Priors change" : `Definitions change: ${r.proposed.change_log ?? ""}`}</strong>
        <span className={`pill ${r.status === "applied" ? "approved" : r.status === "rejected" ? "rejected" : "pending"}`}>
          {r.status === "open" ? "Open" : r.status === "applied" ? "Applied" : "Rejected"}
        </span>
      </div>
      <div className="muted small">
        Proposed by {names.get(r.requested_by) ?? "unknown"} · {fmt(r.created_at)}
      </div>
      <p>{r.rationale}</p>
      {r.kind === "priors" && r.proposed.priors && (
        <ul className="small">
          {Object.entries(r.proposed.priors).map(([c, v]) => (
            <li key={c}>
              Claim {CLAIM_SHORT[c as ClaimId]}: {pct(priors[c as ClaimId])} → <strong>{pct(v)}</strong>
            </li>
          ))}
        </ul>
      )}
      {r.kind === "definitions" &&
        Object.entries(r.proposed.definitions ?? {}).map(([k, change]) => (
          <div key={k} className="diff small">
            <div className="muted">{definitions[k as keyof Definitions]?.title ?? k}</div>
            {change?.title && (
              <p>
                <span className="muted">New title:</span> {change.title}
              </p>
            )}
            {change?.body && <p className="proposed">{change.body}</p>}
          </div>
        ))}
      <ul className="approvals small">
        {members.map((m) => {
          const a = r.approvals.find((x) => x.approver === m.user_id);
          return (
            <li key={m.user_id}>
              {a ? (a.decision === "approve" ? "✓" : "✗") : "…"} {m.name}
              {a ? (a.decision === "approve" ? " approved" : " rejected") : " has not decided"}
              {a?.note && a.note !== "Proposed it" ? `: ${a.note}` : ""}
            </li>
          );
        })}
      </ul>
      {r.status === "open" && <div className="muted small">{needed}</div>}
      {r.status === "open" && myId && !mine && (
        <ActionForm
          action={decideRequest.bind(null, r.id)}
          buttons={[
            { label: "Approve", name: "decision", value: "approve" },
            { label: "Reject", name: "decision", value: "reject", secondary: true },
          ]}
        >
          <label htmlFor={`note-${r.id}`}>Note (required to reject)</label>
          <input id={`note-${r.id}`} name="note" />
        </ActionForm>
      )}
    </div>
  );
}

export default async function RulesPage({ searchParams }: { searchParams: Promise<{ version?: string }> }) {
  const { version } = await searchParams;
  const [defs, configs, requests, { me, names }] = await Promise.all([
    loadDefinitions(Number(version) || undefined),
    loadConfigVersions(),
    loadChangeRequests(),
    loadPeople(),
  ]);
  const { config } = configs[0];
  const isArbiter = me?.role === "arbiter";
  const members = [...names].map(([user_id, name]) => ({ user_id, name }));
  const open = requests.filter((r) => r.status === "open");
  const closed = requests.filter((r) => r.status !== "open");
  const current = defs.shown === defs.current ? defs.definitions : (await loadDefinitions()).definitions;

  return (
    <main>
      <h1>Rules and definitions</h1>
      <p className="muted">
        Definitions change only with all three approvals. Priors change only with both bettors and Shaun. Shaun can
        recalibrate the other settings directly; every change is versioned and in the <Link href="/audit">audit log</Link>.
      </p>

      <section className="card stack">
        <div className="row spread">
          <h2>Definitions v{defs.shown}</h2>
          {defs.shown !== defs.current && <Link href="/rules">Back to current (v{defs.current})</Link>}
        </div>
        {defs.shown !== defs.current && (
          <p className="notice small">You are viewing an old version. It no longer applies.</p>
        )}
        {DEFINITION_KEYS.map((k) => (
          <div key={k}>
            <h3>{defs.definitions[k]?.title}</h3>
            <p>{defs.definitions[k]?.body}</p>
          </div>
        ))}
        <details>
          <summary>Version history ({defs.versions.length})</summary>
          <ul className="small">
            {defs.versions.map((v) => (
              <li key={v.version}>
                <Link href={`/rules?version=${v.version}`}>v{v.version}</Link> · {fmt(v.created_at)} · {v.change_log}
              </li>
            ))}
          </ul>
        </details>
      </section>

      <h2>Change requests</h2>
      {open.length === 0 && <p className="muted">No open requests.</p>}
      {open.map((r) => (
        <RequestCard key={r.id} r={r} definitions={current} priors={config.priors} names={names} myId={me?.user_id} members={members} />
      ))}
      {closed.length > 0 && (
        <details>
          <summary>Closed requests ({closed.length})</summary>
          {closed.map((r) => (
            <RequestCard key={r.id} r={r} definitions={current} priors={config.priors} names={names} myId={me?.user_id} members={members} />
          ))}
        </details>
      )}

      {me && (
        <section className="card stack">
          <h2>Propose a change</h2>
          <details>
            <summary>Change the definitions</summary>
            <ActionForm action={proposeDefinitions} buttons={[{ label: "Propose definitions change" }]}>
              <p className="muted small">Edit any definition below. Your proposal counts as your approval.</p>
              {DEFINITION_KEYS.map((k) => (
                <fieldset key={k} className="stack plain">
                  <label htmlFor={`title_${k}`}>Title</label>
                  <input id={`title_${k}`} name={`title_${k}`} defaultValue={current[k]?.title} />
                  <label htmlFor={`body_${k}`} className="sr-only">
                    Text
                  </label>
                  <textarea id={`body_${k}`} name={`body_${k}`} rows={4} defaultValue={current[k]?.body} />
                </fieldset>
              ))}
              <label htmlFor="change_log">Change log entry</label>
              <input id="change_log" name="change_log" placeholder="e.g. Clarify what counts as autonomous" />
              <label htmlFor="def_rationale">Why</label>
              <textarea id="def_rationale" name="rationale" rows={2} />
            </ActionForm>
          </details>
          <details>
            <summary>Change the priors</summary>
            <ActionForm action={proposePriors} buttons={[{ label: "Propose new priors" }]}>
              <p className="muted small">
                In percent. Changing a prior rewrites the whole history from the start, so it needs both bettors and Shaun.
              </p>
              <div className="grid">
                {CLAIMS.map((c) => (
                  <label key={c} className="stack small">
                    Claim {CLAIM_SHORT[c]}
                    <input name={`prior_${c}`} type="number" min={0.1} max={99.9} step={0.1} defaultValue={+(config.priors[c] * 100).toFixed(1)} />
                  </label>
                ))}
              </div>
              <label htmlFor="prior_rationale">Why</label>
              <textarea id="prior_rationale" name="rationale" rows={2} />
            </ActionForm>
          </details>
        </section>
      )}

      <section className="card stack" id="settings">
        <h2>Probability settings (v{configs[0].version})</h2>
        <div className="table-scroll">
          <table>
            <tbody>
              <tr>
                <th>Priors</th>
                <td>
                  {CLAIMS.map((c) => `${CLAIM_SHORT[c]} ${pct(config.priors[c])}`).join(" · ")}
                  <div className="muted small">B claims are conditional on A. Headline = P(A) × P(B | A).</div>
                </td>
              </tr>
              <tr>
                <th>Decay on Claim A</th>
                <td>
                  {config.decay.enabled ? `On: odds ÷ ${config.decay.lr} at each month end` : "Off"}
                  <div className="muted small">
                    Skipped in any month with approved YES Claim A evidence at strength {config.decay.skipThreshold} (
                    {STRENGTH_LABELS[config.decay.skipThreshold]}) or above. First step November 30, 2026.
                  </div>
                </td>
              </tr>
              <tr>
                <th>Added-late flag</th>
                <td>Approved more than {config.backdateFlagDays} days after the event</td>
              </tr>
              <tr>
                <th>Expert forecasts</th>
                <td>LR capped at {config.forecastMaxLR}</td>
              </tr>
              <tr>
                <th>Movement caps</th>
                <td>
                  Per item: {config.caps.perItemLR ?? "off"} · per claim per day: {config.caps.perDayLR ?? "off"}
                </td>
              </tr>
              <tr>
                <th>Dates</th>
                <td>
                  {config.startDate} to {config.resolutionDate} (locked)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <h3>Strength scale</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Strength</th>
                <th>LR</th>
                <th>Anchor example</th>
              </tr>
            </thead>
            <tbody>
              {([1, 2, 3, 4, 5] as const).map((s) => (
                <tr key={s}>
                  <td>
                    {s} · {STRENGTH_LABELS[s]}
                  </td>
                  <td>{config.strengthLR[s]}</td>
                  <td className="small">{STRENGTH_ANCHORS[s]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details>
          <summary>Settings history ({configs.length})</summary>
          <ul className="small">
            {configs.map((c) => (
              <li key={c.version}>
                v{c.version} · {fmt(c.created_at)}
                {c.created_by ? ` · ${names.get(c.created_by) ?? "unknown"}` : ""}
                {c.request_id ? " · approved request" : ""} · {c.note}
              </li>
            ))}
          </ul>
        </details>
        {isArbiter && (
          <details>
            <summary>Recalibrate settings</summary>
            <ActionForm action={updateConfig} buttons={[{ label: "Save settings" }]}>
              <p className="muted small">Takes effect immediately and recomputes every probability. Priors and dates aren&apos;t here.</p>
              <div className="grid">
                {([1, 2, 3, 4, 5] as const).map((s) => (
                  <label key={s} className="stack small">
                    LR for {s} · {STRENGTH_LABELS[s]}
                    <input name={`lr_${s}`} type="number" min={1} step={0.01} defaultValue={config.strengthLR[s]} />
                  </label>
                ))}
              </div>
              <label className="check">
                <input type="checkbox" name="decay_enabled" defaultChecked={config.decay.enabled} /> Monthly decay on Claim A
              </label>
              <div className="grid">
                <label className="stack small">
                  Decay LR
                  <input name="decay_lr" type="number" min={1} step={0.001} defaultValue={config.decay.lr} />
                </label>
                <label className="stack small">
                  Skip at strength
                  <select name="skip_threshold" defaultValue={config.decay.skipThreshold}>
                    {([1, 2, 3, 4, 5] as const).map((s) => (
                      <option key={s} value={s}>
                        {s} · {STRENGTH_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="stack small">
                  Added-late after (days)
                  <input name="backdate_days" type="number" min={0} step={1} defaultValue={config.backdateFlagDays} />
                </label>
                <label className="stack small">
                  Forecast LR cap
                  <input name="forecast_max_lr" type="number" min={1} step={0.01} defaultValue={config.forecastMaxLR} />
                </label>
                <label className="stack small">
                  Per-item cap (blank = off)
                  <input name="cap_item" type="number" min={1} step={0.01} defaultValue={config.caps.perItemLR ?? ""} />
                </label>
                <label className="stack small">
                  Per-day cap (blank = off)
                  <input name="cap_day" type="number" min={1} step={0.01} defaultValue={config.caps.perDayLR ?? ""} />
                </label>
              </div>
              <label htmlFor="config_note">Why</label>
              <input id="config_note" name="note" />
            </ActionForm>
          </details>
        )}
      </section>
    </main>
  );
}
