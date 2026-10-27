"use client";

import { useEffect, useState } from "react";

// Pages load their data in the browser. After any change, invalidate() makes
// every page on screen fetch again, so the probabilities always reflect it.
let version = 0;
const listeners = new Set<() => void>();

export function invalidate(): void {
  version += 1;
  for (const l of listeners) l();
}

export interface Loaded<T> {
  data: T | undefined;
  error: Error | undefined;
}

/** Runs `load` on mount, when `deps` change, and after invalidate(); keeps the last data while reloading. */
export function useData<T>(load: () => Promise<T>, deps: readonly unknown[]): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: undefined, error: undefined });
  const [v, setV] = useState(version);

  useEffect(() => {
    const l = () => setV(version);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setState({ data, error: undefined }),
      (error: Error) => live && setState((s) => ({ data: s.data, error })),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, v]);

  return state;
}
