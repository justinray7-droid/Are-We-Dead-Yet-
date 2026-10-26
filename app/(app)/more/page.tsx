import Link from "next/link";
import { loadPeople } from "@/lib/data/evidence.ts";
import { loadConfigVersions } from "@/lib/data/governance.ts";
import { ROLE_LABELS } from "@/lib/identity.ts";
import { rulingOpensOn } from "@/lib/governance/resolution.ts";

// The phone tab bar's "More" tab: everything that isn't a tab.
export default async function MorePage() {
  const [{ me }, [latest]] = await Promise.all([loadPeople(), loadConfigVersions()]);
  const opens = rulingOpensOn(latest.config.resolutionDate);
  return (
    <main>
      <h1>More</h1>
      <ul className="menu card">
        {me?.role === "arbiter" ? (
          <li>
            <Link href="/evidence/new">Submit evidence</Link>
            <span className="muted small">Bettors only</span>
          </li>
        ) : (
          <li>
            <Link href="/rules">Rules and definitions</Link>
            <span className="muted small">Definitions, change requests, settings</span>
          </li>
        )}
        <li>
          <Link href="/audit">Audit log</Link>
          <span className="muted small">Every change, who and when</span>
        </li>
        <li>
          <Link href="/resolution">Resolution</Link>
          <span className="muted small">Shaun&apos;s final ruling · opens {opens}</span>
        </li>
      </ul>

      <h2>Export</h2>
      <ul className="menu card">
        <li>
          <a href="/export/wager-export.json">Everything (JSON)</a>
        </li>
        <li>
          <a href="/export/evidence.csv">Evidence (CSV)</a>
        </li>
        <li>
          <a href="/export/history.csv">Probability history (CSV)</a>
        </li>
      </ul>

      <h2>You</h2>
      <ul className="menu card">
        <li>
          <Link href="/who">Switch person</Link>
          <span className="muted small">
            Using this device as {me?.name} ({me ? ROLE_LABELS[me.role] : ""})
          </span>
        </li>
      </ul>
      <p className="muted small">
        To install on iPhone: open this site in Safari, tap Share, then Add to Home Screen.
      </p>
    </main>
  );
}
