import type { ISODate, ISOMonth } from "./types.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDate(d: string, field = "date"): void {
  if (!DATE_RE.test(d) || Number.isNaN(Date.parse(d + "T00:00:00Z"))) {
    throw new Error(`Invalid ${field}: "${d}" (expected YYYY-MM-DD)`);
  }
}

function parts(d: ISODate): [number, number, number] {
  const [y, m, day] = d.split("-").map(Number);
  return [y, m, day];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function monthOf(d: ISODate): ISOMonth {
  return d.slice(0, 7);
}

/** Last calendar day of the given month, as YYYY-MM-DD. */
export function monthEnd(year: number, month: number): ISODate {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(last)}`;
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: ISODate, b: ISODate): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * Month-end dates for decay steps: starting with the first FULL month after
 * startDate, up to and including the last month end on or before `until`.
 */
export function decayMonthEnds(startDate: ISODate, until: ISODate): ISODate[] {
  let [y, m, d] = parts(startDate);
  if (d !== 1) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  const out: ISODate[] = [];
  for (;;) {
    const end = monthEnd(y, m);
    if (end > until) break;
    out.push(end);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Today's calendar date in an IANA time zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string, now: Date = new Date()): ISODate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
