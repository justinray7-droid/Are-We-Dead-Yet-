"use client";

import Link from "next/link";

// Shown if a page fails to load, e.g. the database is unreachable.
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="narrow">
      <h1>Something went wrong</h1>
      <p className="muted">The tracker couldn&apos;t load this page.</p>
      <div className="row">
        <button type="button" onClick={reset}>
          Try again
        </button>
        <Link href="/who/">Pick your name again</Link>
      </div>
    </main>
  );
}
