// Pure Bayesian recompute. Given config, approved evidence, arbiter state and
// an as-of date, rebuilds the full probability chain from the priors.

import type {
  ArbiterState,
  ClaimId,
  Direction,
  EngineConfig,
  EngineResult,
  EvidenceInput,
  HeadlinePoint,
  ISODate,
  Step,
} from "./types.ts";
import { CLAIMS } from "./types.ts";
import { assertDate, daysBetween, decayMonthEnds, monthOf } from "./dates.ts";

// ---------- core math ----------

export function toOdds(p: number): number {
  if (p >= 1) return Infinity;
  return p / (1 - p);
}

export function toProb(odds: number): number {
  if (odds === Infinity) return 1;
  return odds / (1 + odds);
}

/** Apply one update. YES multiplies odds by LR, NO divides. */
export function update(p: number, direction: Direction, lr: number): number {
  const odds = toOdds(p);
  return toProb(direction === "YES" ? odds * lr : odds / lr);
}

/** Correlation discount on the log of the LR: effective = LR ^ discount. */
export function discountedLR(lr: number, discount = 1): number {
  if (discount < 0 || discount > 1) throw new Error(`Discount must be 0..1, got ${discount}`);
  return Math.pow(lr, discount);
}

// ---------- recompute ----------

interface Pending {
  kind: Step["kind"];
  id: string;
  label: string;
  date: ISODate;
  claim: ClaimId;
  direction: Direction;
  lr: number;
  effectiveLR: number;
  status: Step["status"];
  order: number; // tie-break within a date: evidence 0, satisfied 1, decay 2
  seq: number; // stable input order
  backdated?: boolean;
  approvedDate?: ISODate;
  note?: string;
}

export function validateConfig(config: EngineConfig): void {
  for (const c of CLAIMS) {
    const p = config.priors[c];
    if (!(p > 0 && p < 1)) throw new Error(`Prior for ${c} must be between 0 and 1, got ${p}`);
  }
  for (const s of [1, 2, 3, 4, 5] as const) {
    if (!(config.strengthLR[s] >= 1)) throw new Error(`Strength ${s} LR must be >= 1`);
  }
  if (!(config.decay.lr >= 1)) throw new Error("Decay LR must be >= 1");
  assertDate(config.startDate, "startDate");
  assertDate(config.resolutionDate, "resolutionDate");
  if (config.resolutionDate <= config.startDate) throw new Error("Resolution date must be after start date");
}

export function recompute(
  config: EngineConfig,
  evidence: EvidenceInput[],
  arbiter: ArbiterState,
  asOf: ISODate,
): EngineResult {
  validateConfig(config);
  assertDate(asOf, "asOf");

  const horizon = asOf < config.resolutionDate ? asOf : config.resolutionDate;
  const satisfied = arbiter.claimASatisfied;
  if (satisfied) assertDate(satisfied.date, "claimASatisfied.date");

  const pending: Pending[] = [];
  const excluded: string[] = [];
  let seq = 0;

  // Evidence steps, one per claim tag.
  for (const ev of evidence) {
    assertDate(ev.eventDate, `eventDate of ${ev.id}`);
    if (ev.approvedDate) assertDate(ev.approvedDate, `approvedDate of ${ev.id}`);
    if (ev.eventDate > horizon) continue;
    // Priors already reflect everything known at the start of the bet.
    if (ev.eventDate < config.startDate) {
      excluded.push(ev.id);
      continue;
    }
    const backdated =
      ev.approvedDate !== undefined && daysBetween(ev.eventDate, ev.approvedDate) > config.backdateFlagDays;
    for (const tag of ev.tags) {
      let lr = config.strengthLR[tag.strength];
      if (lr === undefined) throw new Error(`Unknown strength ${tag.strength} on ${ev.id}`);
      let eff = ev.isExpertForecast ? Math.min(lr, config.forecastMaxLR) : lr;
      eff = discountedLR(eff, tag.discount ?? 1);
      if (config.caps.perItemLR !== null) eff = Math.min(eff, config.caps.perItemLR);
      const ignored = tag.claim === "A" && satisfied !== null && ev.eventDate >= satisfied.date;
      pending.push({
        kind: "evidence",
        id: ev.id,
        label: ev.title,
        date: ev.eventDate,
        claim: tag.claim,
        direction: tag.direction,
        lr,
        effectiveLR: ignored ? 1 : eff,
        status: ignored ? "ignored_satisfied" : "applied",
        order: 0,
        seq: seq++,
        backdated,
        approvedDate: ev.approvedDate,
      });
    }
  }

  // Decay steps on Claim A.
  if (config.decay.enabled) {
    const qualifyingMonths = new Set<string>();
    for (const ev of evidence) {
      for (const t of ev.tags) {
        if (t.claim === "A" && t.direction === "YES" && t.strength >= config.decay.skipThreshold) {
          qualifyingMonths.add(monthOf(ev.eventDate));
        }
      }
    }
    const waivers = new Map(arbiter.decayWaivers.map((w) => [w.month, w.note]));
    for (const end of decayMonthEnds(config.startDate, horizon)) {
      if (satisfied && end >= satisfied.date) break; // decay stops once A is satisfied
      const month = monthOf(end);
      const status: Step["status"] = qualifyingMonths.has(month)
        ? "skipped"
        : waivers.has(month)
          ? "waived"
          : "applied";
      pending.push({
        kind: "decay",
        id: `decay:${month}`,
        label: `Monthly decay, ${month}`,
        date: end,
        claim: "A",
        direction: "NO",
        lr: config.decay.lr,
        effectiveLR: status === "applied" ? config.decay.lr : 1,
        status,
        order: 2,
        seq: seq++,
        note: status === "waived" ? waivers.get(month) : undefined,
      });
    }
  }

  // Claim A satisfied override.
  if (satisfied && satisfied.date <= horizon) {
    pending.push({
      kind: "satisfied",
      id: "satisfied",
      label: "Claim A marked satisfied",
      date: satisfied.date,
      claim: "A",
      direction: "YES",
      lr: Infinity,
      effectiveLR: Infinity,
      status: "applied",
      order: 1,
      seq: seq++,
      note: satisfied.note,
    });
  }

  pending.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order || a.seq - b.seq));

  // Walk the chain.
  const p: Record<ClaimId, number> = { ...config.priors };
  const dayUsed = new Map<string, number>(); // claim|date -> |ln odds| moved
  const steps: Step[] = [];
  const history: HeadlinePoint[] = [];
  const headlineOf = () => ({ loose: p.A * p.B_LOOSE, strict: p.A * p.B_STRICT });
  history.push({ date: config.startDate, ...headlineOf(), stepIds: [] });

  for (const s of pending) {
    const before = p[s.claim];
    let after = before;
    let eff = s.effectiveLR;

    if (s.kind === "satisfied") {
      after = 1;
    } else if (s.status === "applied" && !(s.claim === "A" && before === 1)) {
      if (config.caps.perDayLR !== null) {
        const key = `${s.claim}|${s.date}`;
        const used = dayUsed.get(key) ?? 0;
        const room = Math.max(0, Math.log(config.caps.perDayLR) - used);
        const want = Math.log(eff);
        const take = Math.min(want, room);
        eff = Math.exp(take);
        dayUsed.set(key, used + take);
      }
      after = update(before, s.direction, eff);
    } else if (s.status === "applied") {
      eff = 1; // A already at 100%
    }

    p[s.claim] = after;
    steps.push({
      kind: s.kind,
      id: s.id,
      label: s.label,
      date: s.date,
      claim: s.claim,
      direction: s.direction,
      lr: s.lr,
      effectiveLR: eff,
      status: s.status,
      before,
      after,
      backdated: s.backdated,
      approvedDate: s.approvedDate,
      note: s.note,
    });

    const last = history[history.length - 1];
    const h = headlineOf();
    if (last.date === s.date) {
      last.loose = h.loose;
      last.strict = h.strict;
      last.stepIds.push(s.id);
    } else {
      history.push({ date: s.date, ...h, stepIds: [s.id] });
    }
  }

  return {
    asOf,
    probabilities: { ...p },
    headline: headlineOf(),
    claimASatisfied: satisfied !== null && satisfied.date <= horizon,
    steps,
    history,
    excludedEvidenceIds: excluded,
  };
}
