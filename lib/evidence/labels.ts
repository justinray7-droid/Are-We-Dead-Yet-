import type { ClaimId } from "../engine/index.ts";

export const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

export const CLAIM_SHORT: Record<ClaimId, string> = {
  A: "A",
  B_LOOSE: "B-loose",
  B_STRICT: "B-strict",
  C: "C",
};

export const STATUS_LABELS = {
  pending: "Pending",
  needs_changes: "Needs changes",
  approved: "Approved",
  rejected: "Rejected",
} as const;

/** Anchor examples from spec 3.2, shown next to the strength picker. */
export const STRENGTH_ANCHORS = {
  1: "Vendor claim or demo, no independent verification",
  2: "Credible reporting of a notable but contested result",
  3: "Expert-verified result in a narrow domain",
  4: "Independently replicated, AI-originated discovery",
  5: "Broad, verified, clearly autonomous result meeting a definition outright",
} as const;

export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
