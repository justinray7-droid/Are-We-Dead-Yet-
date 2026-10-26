// Parses the governance forms: definition and prior change requests, the
// arbiter's direct settings changes, decay waivers and the Claim A satisfied
// mark. Pure, so it runs under node --test; the database repeats the rules.

import { CLAIMS, validateConfig, type ClaimId, type EngineConfig, type ISODate, type Strength } from "../engine/index.ts";
import type { FormLike, Parsed } from "../evidence/form.ts";

export const DEFINITION_KEYS = ["autonomous", "claim_a", "claim_b_loose", "claim_b_strict", "claim_c", "deciding_rule"] as const;
export type DefinitionKey = (typeof DEFINITION_KEYS)[number];
export type Definitions = Record<DefinitionKey, { title: string; body: string }>;

/** The engine config as stored, which also carries the time zone. */
export type StoredConfig = EngineConfig & { timeZone?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(form: FormLike, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

function result<T>(errors: Record<string, string>, value: () => T): Parsed<T> {
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: value() };
}

export interface DefinitionsProposal {
  rationale: string;
  proposed: { change_log: string; definitions: Partial<Record<DefinitionKey, { title?: string; body?: string }>> };
}

/** Only fields that differ from the current version are proposed. */
export function parseDefinitionsProposal(form: FormLike, current: Definitions): Parsed<DefinitionsProposal> {
  const errors: Record<string, string> = {};
  const definitions: DefinitionsProposal["proposed"]["definitions"] = {};
  for (const key of DEFINITION_KEYS) {
    const title = text(form, `title_${key}`);
    const body = text(form, `body_${key}`);
    const change: { title?: string; body?: string } = {};
    if (title && title !== current[key].title) change.title = title;
    if (body && body !== current[key].body) change.body = body;
    if (!title || !body) errors[key] = "A definition needs a title and text.";
    if (change.title !== undefined || change.body !== undefined) definitions[key] = change;
  }
  if (Object.keys(definitions).length === 0 && Object.keys(errors).length === 0) errors.form = "Nothing has changed yet.";
  const change_log = text(form, "change_log");
  if (!change_log) errors.change_log = "Summarise the change for the change log.";
  const rationale = text(form, "rationale");
  if (!rationale) errors.rationale = "Explain why the change is needed.";
  return result(errors, () => ({ rationale, proposed: { change_log, definitions } }));
}

export interface PriorsProposal {
  rationale: string;
  proposed: { note: string; priors: Partial<Record<ClaimId, number>> };
}

/** Priors are entered as percentages; only changed ones are proposed. */
export function parsePriorsProposal(form: FormLike, current: Record<ClaimId, number>): Parsed<PriorsProposal> {
  const errors: Record<string, string> = {};
  const priors: Partial<Record<ClaimId, number>> = {};
  for (const c of CLAIMS) {
    const raw = text(form, `prior_${c}`);
    if (raw === "") continue;
    const pctValue = Number(raw);
    if (!(pctValue > 0 && pctValue < 100)) {
      errors[`prior_${c}`] = "Enter a percentage between 0 and 100.";
      continue;
    }
    const p = Math.round(pctValue * 10) / 1000; // one decimal place of a percent
    if (Math.abs(p - current[c]) > 1e-9) priors[c] = p;
  }
  if (Object.keys(priors).length === 0 && Object.keys(errors).length === 0) errors.form = "Nothing has changed yet.";
  const rationale = text(form, "rationale");
  if (!rationale) errors.rationale = "Explain why the change is needed.";
  return result(errors, () => ({ rationale, proposed: { note: rationale, priors } }));
}

export interface ConfigUpdate {
  config: StoredConfig;
  note: string;
}

/**
 * The arbiter's direct recalibration: strength LRs, decay, backdate flag,
 * forecast cap and movement caps. Priors and the bet's terms are untouched.
 */
export function parseConfigUpdate(form: FormLike, current: StoredConfig): Parsed<ConfigUpdate> {
  const errors: Record<string, string> = {};
  const num = (name: string, min: number, label: string): number => {
    const v = Number(text(form, name));
    if (text(form, name) === "" || !(v >= min)) errors[name] = `${label} must be at least ${min}.`;
    return v;
  };
  const optionalCap = (name: string): number | null => {
    if (text(form, name) === "") return null;
    return num(name, 1, "A cap");
  };

  const strengthLR = { ...current.strengthLR };
  for (const s of [1, 2, 3, 4, 5] as const) strengthLR[s] = num(`lr_${s}`, 1, `The LR for strength ${s}`);
  const skip = Number(text(form, "skip_threshold"));
  if (!Number.isInteger(skip) || skip < 1 || skip > 5) errors.skip_threshold = "Pick a strength from 1 to 5.";
  const backdate = Number(text(form, "backdate_days"));
  if (text(form, "backdate_days") === "" || !Number.isInteger(backdate) || backdate < 0) {
    errors.backdate_days = "Enter a whole number of days.";
  }

  const config: StoredConfig = {
    ...current,
    strengthLR,
    decay: {
      enabled: form.get("decay_enabled") !== null,
      lr: num("decay_lr", 1, "The decay LR"),
      skipThreshold: skip as Strength,
    },
    backdateFlagDays: backdate,
    forecastMaxLR: num("forecast_max_lr", 1, "The forecast cap"),
    caps: { perItemLR: optionalCap("cap_item"), perDayLR: optionalCap("cap_day") },
  };

  const note = text(form, "note");
  if (!note) errors.note = "Say why the settings changed.";
  if (Object.keys(errors).length === 0) {
    try {
      validateConfig(config);
    } catch (e) {
      errors.form = (e as Error).message;
    }
    if (JSON.stringify(config) === JSON.stringify(current)) errors.form = "Nothing has changed yet.";
  }
  return result(errors, () => ({ config, note }));
}

export interface Waiver {
  month: string;
  note: string;
}

export function parseWaiver(form: FormLike, allowedMonths: readonly string[]): Parsed<Waiver> {
  const errors: Record<string, string> = {};
  const month = text(form, "month");
  if (!allowedMonths.includes(month)) errors.month = "Pick a month with a decay step.";
  const note = text(form, "note");
  if (!note) errors.note = "A note is required.";
  return result(errors, () => ({ month, note }));
}

export interface SatisfiedMark {
  effective_on: ISODate;
  evidence_ids: string[];
  note: string;
}

export function parseSatisfied(form: FormLike, startDate: ISODate, today: ISODate): Parsed<SatisfiedMark> {
  const errors: Record<string, string> = {};
  const effective_on = text(form, "effective_on");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective_on) || effective_on < startDate || effective_on > today) {
    errors.effective_on = `Pick a date between ${startDate} and today.`;
  }
  const evidence_ids = [
    ...new Set(form.getAll("evidence_ids").filter((v): v is string => typeof v === "string" && UUID_RE.test(v))),
  ];
  if (evidence_ids.length === 0) errors.evidence_ids = "Link at least one approved evidence item.";
  const note = text(form, "note");
  if (!note) errors.note = "Explain why Claim A is met.";
  return result(errors, () => ({ effective_on, evidence_ids, note }));
}

export function parseNote(form: FormLike, message = "A note is required."): Parsed<{ note: string }> {
  const note = text(form, "note");
  return note ? { ok: true, value: { note } } : { ok: false, errors: { note: message } };
}
