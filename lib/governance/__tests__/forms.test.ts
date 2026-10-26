import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFINITION_KEYS,
  parseConfigUpdate,
  parseDefinitionsProposal,
  parsePriorsProposal,
  parseSatisfied,
  parseWaiver,
  type Definitions,
  type StoredConfig,
} from "../forms.ts";
import { DEFAULT_CONFIG } from "../../engine/index.ts";

function fd(entries: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of [v].flat()) f.append(k, x);
  return f;
}

const DEFS = Object.fromEntries(DEFINITION_KEYS.map((k) => [k, { title: `T ${k}`, body: `B ${k}` }])) as Definitions;
const defFields = (overrides: Record<string, string> = {}) => ({
  ...Object.fromEntries(DEFINITION_KEYS.flatMap((k) => [[`title_${k}`, DEFS[k].title], [`body_${k}`, DEFS[k].body]])),
  change_log: "Clarify A",
  rationale: "Ambiguous wording",
  ...overrides,
});

test("Definitions: only changed fields are proposed", () => {
  const r = parseDefinitionsProposal(fd(defFields({ body_claim_a: "  New body  " })), DEFS);
  assert.ok(r.ok);
  assert.deepEqual(r.value.proposed, { change_log: "Clarify A", definitions: { claim_a: { body: "New body" } } });
});

test("Definitions: unchanged, blank or unexplained proposals are refused", () => {
  const same = parseDefinitionsProposal(fd(defFields()), DEFS);
  assert.equal(same.ok, false);
  if (!same.ok) assert.equal(same.errors.form, "Nothing has changed yet.");
  const blank = parseDefinitionsProposal(fd(defFields({ body_claim_c: " " })), DEFS);
  assert.equal(blank.ok, false);
  if (!blank.ok) assert.ok(blank.errors.claim_c);
  const noLog = parseDefinitionsProposal(fd(defFields({ body_claim_a: "x", change_log: "" })), DEFS);
  assert.equal(noLog.ok, false);
});

test("Priors: percentages in, probabilities out, only changes", () => {
  const r = parsePriorsProposal(
    fd({ prior_A: "60", prior_B_LOOSE: "40", prior_B_STRICT: "12.5", prior_C: "45.25", rationale: "Recalibrate" }),
    DEFAULT_CONFIG.priors,
  );
  assert.ok(r.ok);
  assert.deepEqual(r.value.proposed.priors, { A: 0.6, C: 0.453 });
  const bad = parsePriorsProposal(fd({ prior_A: "100", rationale: "x" }), DEFAULT_CONFIG.priors);
  assert.equal(bad.ok, false);
  const none = parsePriorsProposal(fd({ prior_A: "65", rationale: "x" }), DEFAULT_CONFIG.priors);
  assert.equal(none.ok, false);
});

const stored: StoredConfig = { ...DEFAULT_CONFIG, timeZone: "America/Chicago" };
const cfgFields = (overrides: Record<string, string> = {}) => ({
  lr_1: "1.25", lr_2: "1.5", lr_3: "2", lr_4: "3", lr_5: "5",
  decay_enabled: "on", decay_lr: "1.02", skip_threshold: "3",
  backdate_days: "30", forecast_max_lr: "1.25", cap_item: "", cap_day: "",
  note: "Recalibrate after first items",
  ...overrides,
});

test("Config: recalibration keeps priors, dates and time zone", () => {
  const r = parseConfigUpdate(fd(cfgFields({ decay_lr: "1.03", cap_item: "4" })), stored);
  assert.ok(r.ok);
  assert.equal(r.value.config.decay.lr, 1.03);
  assert.equal(r.value.config.caps.perItemLR, 4);
  assert.equal(r.value.config.caps.perDayLR, null);
  assert.deepEqual(r.value.config.priors, stored.priors);
  assert.equal(r.value.config.timeZone, "America/Chicago");
  assert.equal(r.value.config.resolutionDate, stored.resolutionDate);
});

test("Config: decay can be switched off; bad values and no-ops refused", () => {
  const { decay_enabled: _, ...withoutDecay } = cfgFields();
  const off = parseConfigUpdate(fd(withoutDecay), stored);
  assert.ok(off.ok);
  assert.equal(off.value.config.decay.enabled, false);
  const bads: Record<string, string>[] = [{ lr_2: "0.9" }, { skip_threshold: "6" }, { backdate_days: "-1" }, { cap_day: "0.5" }, { note: "" }];
  for (const bad of bads) {
    assert.equal(parseConfigUpdate(fd(cfgFields(bad)), stored).ok, false, JSON.stringify(bad));
  }
  const same = parseConfigUpdate(fd(cfgFields()), stored);
  assert.equal(same.ok, false);
});

test("Waiver needs an allowed month and a note", () => {
  assert.ok(parseWaiver(fd({ month: "2027-02", note: "conference" }), ["2027-01", "2027-02"]).ok);
  assert.equal(parseWaiver(fd({ month: "2026-10", note: "x" }), ["2027-01"]).ok, false);
  assert.equal(parseWaiver(fd({ month: "2027-01", note: " " }), ["2027-01"]).ok, false);
});

test("Satisfied needs a date in range, linked evidence and a note", () => {
  const id = "11111111-1111-1111-1111-111111111111";
  const ok = parseSatisfied(fd({ effective_on: "2027-05-01", evidence_ids: [id, id, "junk"], note: "Met" }), "2026-10-21", "2027-06-01");
  assert.ok(ok.ok);
  assert.deepEqual(ok.value.evidence_ids, [id]);
  const late = parseSatisfied(fd({ effective_on: "2027-07-01", evidence_ids: id, note: "Met" }), "2026-10-21", "2027-06-01");
  assert.equal(late.ok, false);
  const none = parseSatisfied(fd({ effective_on: "2027-05-01", note: "Met" }), "2026-10-21", "2027-06-01");
  assert.equal(none.ok, false);
});
