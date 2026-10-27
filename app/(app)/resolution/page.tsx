"use client";

import { useData } from "@/lib/client/useData.ts";
import { Loading } from "../Loading.tsx";
import { evidenceHref } from "@/lib/links.ts";
import Link from "next/link";
import { CLAIMS, type ClaimId } from "@/lib/engine/index.ts";
import { loadPeople } from "@/lib/data/evidence.ts";
import { loadArbiterActions } from "@/lib/data/governance.ts";
import { loadSnapshot } from "@/lib/data/load.ts";
import { countdown } from "@/lib/dashboard/chart.ts";
import { keyEvidence, rulingOpensOn, rulings } from "@/lib/governance/resolution.ts";
import { CLAIM_SHORT, formatDateTime, pct } from "@/lib/evidence/labels.ts";
import { ActionForm } from "../ActionForm.tsx";
import { recordRuling } from "./actions.ts";

const CLAIM_NAMES: Record<ClaimId, string> = {
  A: "Claim A: autonomous research and design",
  B_LOOSE: "Claim B-loose: beyond human understanding (primary)",
  B_STRICT: "Claim B-strict: beyond understanding even when explained",
  C: "Claim C: speed at quality (tracked only)",
};
const SIDE = { YES: "Alex's side", NO: "Justin's side" } as const;

// Resolution mode: the final picture, and Shaun's ruling, which decides the bet.
export default function ResolutionPage() {
  const { data, error } = useData(() => Promise.all([loadSnapshot(), loadArbiterActions(), loadPeople()]), []);
  if (!data) return <Loading error={error} />;
  const [snapshot, actions, { me, names }] = data;
  const { result, config, timeZone } = snapshot;
  const all = rulings(actions);
  const standing = all[0];
  const opens = rulingOpensOn(config.resolutionDate);
  const isOpen = result.asOf >= opens;
  const isArbiter = me?.role === "arbiter";
  const left = countdown(result.asOf, config.resolutionDate);
  const key = keyEvidence(result.steps);
  const shaun = actions.find((a) => a.kind === "final_ruling")?.actor;

  return (
    <main>
      <h1>Resolution</h1>
      <p className="ruling">
        Shaun&apos;s final ruling decides the bet. The probabilities below are the running estimate and settle nothing
        on their own.
      </p>

      {standing ? (
        <section className="card verdict">
          <div className="muted small">
            Final ruling by {shaun ? (names.get(shaun) ?? "Shaun") : "Shaun"} · {standing.date}
            {all.length > 1 ? ` · amended ${all.length - 1} time${all.length > 2 ? "s" : ""}` : ""}
          </div>
          <div className="headline">{standing.payload.overall}</div>
          <div>The bet resolves {standing.payload.overall} ({SIDE[standing.payload.overall]}).</div>
          <ul className="rulings">
            {CLAIMS.map((c) => (
              <li key={c}>
                <span className={`pill ${standing.payload[c] === "met" ? "approved" : "rejected"}`}>
                  {standing.payload[c] === "met" ? "Met" : "Not met"}
                </span>{" "}
                {CLAIM_NAMES[c]}
              </li>
            ))}
          </ul>
          <p>{standing.note}</p>
        </section>
      ) : (
        <section className="card">
          <div className="muted small">No ruling yet</div>
          <div className="big">
            {left.reached ? "Resolution date reached" : `${left.days.toLocaleString("en-US")} days to go`}
          </div>
          <div className="muted small">
            Resolution date {config.resolutionDate}. Shaun can record his ruling from {opens}.
          </div>
        </section>
      )}

      <section className="card">
        <h2>Final probabilities (as of {result.asOf})</h2>
        <div className="table-scroll">
          <table>
            <tbody>
              <tr>
                <th>Headline, B-loose</th>
                <td>{pct(result.headline.loose)}</td>
              </tr>
              <tr>
                <th>Headline, B-strict</th>
                <td>{pct(result.headline.strict)}</td>
              </tr>
              {CLAIMS.map((c) => (
                <tr key={c}>
                  <th>{CLAIM_NAMES[c]}</th>
                  <td>
                    {pct(result.probabilities[c])} <span className="muted small">(prior {pct(config.priors[c])})</span>
                    {c === "A" && result.claimASatisfied && <span className="badge">Satisfied</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Key evidence</h2>
        <p className="muted small">The approved items that moved Claims A and B the most.</p>
        {key.length === 0 ? (
          <p className="muted">No approved evidence has moved them yet.</p>
        ) : (
          <ol className="key-evidence">
            {key.map((k) => (
              <li key={k.id}>
                <Link href={evidenceHref(k.id)}>{k.title}</Link> <span className="muted small">{k.date}</span>
                <div className="small">
                  {k.steps.map((s) => (
                    <span key={s.claim} className="tag">
                      {CLAIM_SHORT[s.claim]} {s.direction} {pct(s.before)} → {pct(s.after)}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {isArbiter && (
        <section className="card stack">
          <h2>{standing ? "Amend the ruling" : "Record the final ruling"}</h2>
          {!isOpen ? (
            <p className="muted">The ruling opens on {opens}, 30 days before the resolution date.</p>
          ) : (
            <ActionForm action={recordRuling} buttons={[{ label: standing ? "Record amended ruling" : "Record final ruling" }]}>
              <p className="muted small">
                This decides the bet. It goes in the audit log; an amendment is kept alongside the original.
              </p>
              {CLAIMS.map((c) => (
                <fieldset key={c} className="stack plain">
                  <legend>{CLAIM_NAMES[c]}</legend>
                  <div className="row">
                    <label className="check">
                      <input type="radio" name={`ruling_${c}`} value="met" defaultChecked={standing?.payload[c] === "met"} /> Met
                    </label>
                    <label className="check">
                      <input type="radio" name={`ruling_${c}`} value="not_met" defaultChecked={standing?.payload[c] === "not_met"} /> Not met
                    </label>
                  </div>
                </fieldset>
              ))}
              <fieldset className="stack plain">
                <legend>The bet</legend>
                <div className="row">
                  <label className="check">
                    <input type="radio" name="overall" value="YES" defaultChecked={standing?.payload.overall === "YES"} /> YES ({SIDE.YES})
                  </label>
                  <label className="check">
                    <input type="radio" name="overall" value="NO" defaultChecked={standing?.payload.overall === "NO"} /> NO ({SIDE.NO})
                  </label>
                </div>
              </fieldset>
              <label htmlFor="ruling_note">Reasoning</label>
              <textarea id="ruling_note" name="note" rows={4} />
            </ActionForm>
          )}
        </section>
      )}

      {all.length > 1 && (
        <details className="card">
          <summary>Earlier rulings ({all.length - 1})</summary>
          <ul className="small">
            {all.slice(1).map((r) => (
              <li key={r.at}>
                {formatDateTime(r.at, timeZone)}: {r.payload.overall}. {r.note}
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
