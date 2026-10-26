import { loadSnapshot } from "@/lib/data/load.ts";
import { daysBetween } from "@/lib/engine/index.ts";

export const dynamic = "force-dynamic";

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

// Phase 1 status page: proves auth, database and engine are wired together.
// The full dashboard (toggle, chart, activity feed) is Phase 4.
export default async function Home() {
  const s = await loadSnapshot();
  const { result } = s;
  const daysLeft = Math.max(0, daysBetween(result.asOf, s.resolutionDate));
  const recent = [...result.steps].reverse().slice(0, 8);

  return (
    <main>
      <h1>2031 AI Wager</h1>
      <p className="muted">
        {s.me ? `Signed in as ${s.me.name} (${s.me.role === "arbiter" ? "arbiter" : s.me.role.toUpperCase() + " side"})` : ""}
      </p>

      <section className="card">
        <div className="muted">Chance the bet resolves YES (B-loose)</div>
        <div className="headline">{pct(result.headline.loose)}</div>
        <div className="muted">Strict view: {pct(result.headline.strict)}</div>
        <p className="muted" style={{ marginBottom: 0 }}>
          Shaun&apos;s final ruling decides the bet. This number is a running estimate.
        </p>
      </section>

      <section className="grid">
        <div className="card">
          <div className="muted">Claim A</div>
          <div className="big">{pct(result.probabilities.A)}</div>
          {result.claimASatisfied && <span className="badge">Satisfied</span>}
        </div>
        <div className="card">
          <div className="muted">Claim B (loose | A)</div>
          <div className="big">{pct(result.probabilities.B_LOOSE)}</div>
        </div>
        <div className="card">
          <div className="muted">Claim B (strict | A)</div>
          <div className="big">{pct(result.probabilities.B_STRICT)}</div>
        </div>
        <div className="card">
          <div className="muted">Claim C</div>
          <div className="big">{pct(result.probabilities.C)}</div>
          <span className="badge">Tracked only</span>
        </div>
      </section>

      <section className="card">
        <strong>{daysLeft.toLocaleString()}</strong> days until resolution ({s.resolutionDate}) ·{" "}
        <strong>{s.pendingCount}</strong> pending
      </section>

      <section className="card">
        <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Latest movements</h2>
        {recent.length === 0 ? (
          <p className="muted">Nothing yet. The first decay step lands at the end of November 2026.</p>
        ) : (
          <table>
            <tbody>
              {recent.map((st) => (
                <tr key={`${st.id}-${st.claim}`}>
                  <td>{st.date}</td>
                  <td>
                    {st.label}
                    {st.backdated ? " (added later)" : ""}
                    {st.status !== "applied" ? ` · ${st.status.replace("_", " ")}` : ""}
                  </td>
                  <td>{st.claim.replace("_", "-")}</td>
                  <td>
                    {pct(st.before)} → {pct(st.after)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <p className="muted">Config v{s.configVersion}</p>
    </main>
  );
}
