"use client";

import { invalidate } from "@/lib/client/useData.ts";

/** Shown while a page's data loads, or if it failed (usually no connection). */
export function Loading({ error }: { error?: Error }) {
  if (!error) {
    return (
      <main>
        <p className="muted loading">Loading…</p>
      </main>
    );
  }
  return (
    <main className="narrow">
      <h1>Couldn&apos;t load</h1>
      <p className="muted">Check the connection and try again. ({error.message})</p>
      <button type="button" onClick={invalidate}>
        Try again
      </button>
    </main>
  );
}
