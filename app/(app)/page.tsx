import Link from "next/link";
import { loadSnapshot } from "@/lib/data/load.ts";
import { chartData, countdown, pointsChange, type View } from "@/lib/dashboard/chart.ts";
import { pct } from "@/lib/evidence/labels.ts";
import { HistoryChart, MarkerShape } from "./HistoryChart.tsx";

const RULING = "Shaun's final ruling decides the bet. This number is a running estimate, not a verdict.";

const LEGEND = [
  { kind: "yes", hollow: false, label: "Evidence, moved toward YES" },
  { kind: "no", hollow: false, label: "Evidence, moved toward NO" },
  { kind: "no", hollow: true, label: "Added late (hollow)" },
  { kind: "decay", hollow: false, label: "Monthly decay" },
  { kind: "satisfied", hollow: false, label: "Claim A satisfied" },
] as const;

function ClaimCard({
  title,
  value,
  prior,
  note,
  badge,
  emphasis,
}: {
  title: string;
  value: number;
  prior: number;
  note?: string;
  badge?: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`card claim-card${emphasis ? " emphasis" : ""}`}>
      <div className="muted small">{title}</div>
      <div className="big">{pct(value)}</div>
      <div className="muted small">
        Prior {pct(prior)} · {pointsChange(prior, value)}
      </div>
      {note && <div className="muted small">{note}</div>}
      {badge && <span className="badge">{badge}</span>}
    </div>
  );
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view: rawView } = await searchParams;
  const view: View = rawView === "strict" ? "strict" : "loose";
  const s = await loadSnapshot();
  const { result, config } = s;
  const p = result.probabilities;
  const bClaim = view === "loose" ? "B_LOOSE" : "B_STRICT";
  const bName = view === "loose" ? "B-loose" : "B-strict";
  const priorHeadline = config.priors.A * config.priors[bClaim];
  const data = chartData(result, view, config.startDate);
  const left = countdown(result.asOf, s.resolutionDate);

  return (
    <main>
      <section className="card hero">
        <div className="row spread">
          <div className="muted">Chance the bet resolves YES</div>
          <nav className="segmented" aria-label="Claim B definition">
            <Link href="/" aria-current={view === "loose" ? "page" : undefined}>
              B-loose
            </Link>
            <Link href="/?view=strict" aria-current={view === "strict" ? "page" : undefined}>
              B-strict
            </Link>
          </nav>
        </div>
        <div className="headline">{pct(result.headline[view])}</div>
        <div className="muted small">
          {result.claimASatisfied
            ? `Claim A is marked satisfied, so this is P(${bName} | A).`
            : `P(A) × P(${bName} | A) = ${pct(p.A)} × ${pct(p[bClaim])}`}{" "}
          · {pointsChange(priorHeadline, result.headline[view])} since the start
        </div>
        <p className="ruling">{RULING}</p>
      </section>

      <section className="card">
        <h2>Since October 21, 2026</h2>
        <p className="muted small">
          Headline ({bName}) by event date. Hover or focus the chart and use the arrow keys to see what moved it.
        </p>
        <HistoryChart data={data} label={`Headline probability, ${bName} view`} />
        <ul className="legend small" aria-label="Marker key">
          {LEGEND.map((l) => (
            <li key={l.label}>
              <svg width="16" height="16" aria-hidden="true">
                <MarkerShape kind={l.kind} hollow={l.hollow} x={8} y={8} r={4.5} />
              </svg>
              {l.label}
            </li>
          ))}
        </ul>
        {data.markers.length === 0 ? (
          <p className="muted small">
            Nothing has moved it yet. The first monthly decay step on Claim A lands on November 30, 2026.
          </p>
        ) : (
          <details className="small">
            <summary>Show as a table ({data.markers.length} changes)</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>What moved it</th>
                    <th>Headline</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.markers].reverse().map((m) => (
                    <tr key={m.date}>
                      <td>{m.date}</td>
                      <td>
                        {m.steps.map((st) => (
                          <div key={`${st.id}-${st.claim}`}>
                            {st.kind === "evidence" ? <Link href={`/evidence/${st.id}`}>{st.label}</Link> : st.label}
                            {st.backdated && st.approvedDate ? ` (added late, approved ${st.approvedDate})` : ""}
                          </div>
                        ))}
                      </td>
                      <td>
                        {pct(m.before)} → {pct(m.after)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>

      <section className="grid claims">
        <ClaimCard
          title="Claim A: autonomous research"
          value={p.A}
          prior={config.priors.A}
          badge={result.claimASatisfied ? "Satisfied" : undefined}
        />
        <ClaimCard
          title="Claim B-loose (given A)"
          value={p.B_LOOSE}
          prior={config.priors.B_LOOSE}
          note={view === "loose" ? "In the headline" : undefined}
          emphasis={view === "loose"}
        />
        <ClaimCard
          title="Claim B-strict (given A)"
          value={p.B_STRICT}
          prior={config.priors.B_STRICT}
          note={view === "strict" ? "In the headline" : undefined}
          emphasis={view === "strict"}
        />
      </section>

      <section className="card claim-c">
        <div className="row spread">
          <div>
            <div className="muted small">Claim C: speed at quality</div>
            <div className="big">{pct(p.C)}</div>
            <div className="muted small">
              Prior {pct(config.priors.C)} · {pointsChange(config.priors.C, p.C)}
            </div>
          </div>
          <span className="badge">Tracked only</span>
        </div>
        <p className="muted small">Claim C never affects the headline and doesn&apos;t decide the bet.</p>
      </section>

      <section className="grid">
        <div className="card">
          <div className="muted small">Until resolution</div>
          <div className="big">
            {left.reached ? (
              "Reached"
            ) : (
              <>
                {left.days.toLocaleString("en-US")} <span className="unit">days</span>
              </>
            )}
          </div>
          <div className="muted small">
            {left.reached ? "Waiting on Shaun's final ruling" : left.approx} · {s.resolutionDate}
          </div>
        </div>
        <Link href="/queue" className="card card-link">
          <div className="muted small">Pending review</div>
          <div className="big">{s.pendingCount}</div>
          <div className="muted small">Open the queue →</div>
        </Link>
      </section>

      <p className="muted small">
        {s.me ? `Signed in as ${s.me.name} (${s.me.role === "arbiter" ? "arbiter" : s.me.role.toUpperCase() + " side"})` : ""} ·
        Config v{s.configVersion} · as of {result.asOf}
      </p>
    </main>
  );
}
