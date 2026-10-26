import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, evidenceCsv, historyCsv, toCsv, type ExportEvidence } from "../export.ts";
import { describeAudit, type AuditRow } from "../../audit/describe.ts";
import { DEFAULT_CONFIG, EMPTY_ARBITER, recompute } from "../../engine/index.ts";

test("CSV quoting and formula guard", () => {
  assert.equal(csvCell('He said "hi", then left'), '"He said ""hi"", then left"');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("-1"), "'-1"); // text, so guarded
  assert.equal(csvCell(-0.5), "-0.5"); // numbers are not
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(Infinity), "");
  assert.equal(toCsv(["a", "b"], [[1, "x,y"]]), 'a,b\r\n1,"x,y"\r\n');
});

const item: ExportEvidence = {
  id: "e1", title: "Agent study", summary: "", source_url: "https://example.com", source_type: "peer_reviewed",
  event_date: "2026-11-02", status: "approved", is_expert_forecast: false, rationale: "r", decision_note: null,
  submitted_by: "u1", submitted_at: "2026-11-03T00:00:00Z", decided_at: null, approved_at: "2026-11-04T00:00:00Z",
  evidence_claims: [
    { claim: "A", proposed_direction: "YES", proposed_strength: 4, final_direction: "YES", final_strength: 3, discount: "1", dropped: false },
    { claim: "C", proposed_direction: "YES", proposed_strength: 2, final_direction: null, final_strength: null, discount: 1, dropped: true },
  ],
};
const result = recompute(
  DEFAULT_CONFIG,
  [{ id: "e1", title: "Agent study", eventDate: "2026-11-02", tags: [{ claim: "A", direction: "YES", strength: 3 }] }],
  EMPTY_ARBITER,
  "2026-12-05",
);

test("Evidence CSV: one row per tag, with the applied effect and names", () => {
  const lines = evidenceCsv([item], new Map([["u1", "Alex"]]), result.steps).trim().split("\r\n");
  assert.equal(lines.length, 3);
  const header = lines[0].split(",");
  const a = lines[1].split(",");
  assert.equal(a[header.indexOf("submitted_by")], "Alex");
  assert.equal(a[header.indexOf("claim_before")], "0.65");
  assert.equal(a[header.indexOf("claim_after")], "0.787879");
  assert.equal(lines[2].split(",")[header.indexOf("dropped")], "true");
});

test("History CSV lists every step including decay", () => {
  const lines = historyCsv(result).trim().split("\r\n");
  assert.deepEqual(lines.slice(1).map((l) => l.split(",")[1]), ["evidence", "decay"]);
});

const row = (entity: string, action: AuditRow["action"], details: AuditRow["details"], entity_id = "e1"): AuditRow => ({
  id: 1, at: "2027-01-01T00:00:00Z", actor: "u1", action, entity, entity_id, details,
});
const titles = new Map([["e1", "Agent study"], ["e2", "Press piece"]]);

test("Audit lines read as sentences", () => {
  assert.equal(describeAudit(row("evidence", "insert", { new: { title: "Agent study" } }), titles).text, "submitted “Agent study”");
  const review = describeAudit(row("evidence", "update", { old: { status: "pending" }, new: { status: "needs_changes", decision_note: "Link the paper" } }), titles);
  assert.deepEqual([review.category, review.text, review.detail], ["review", "requested changes on “Agent study”", "Link the paper"]);
  assert.equal(
    describeAudit(row("evidence_claims", "update", { old: { claim: "B_LOOSE", final_direction: null }, new: { claim: "B_LOOSE", final_direction: "YES", final_strength: 2, discount: 0.5 } }), titles).text,
    "set B-loose on “Agent study” to YES 2, discount 0.5",
  );
  assert.equal(describeAudit(row("evidence_claims", "update", { old: { claim: "C", dropped: false }, new: { claim: "C", dropped: true } }), titles).text, "dropped the C tag from “Agent study”");
  assert.equal(describeAudit(row("evidence_links", "insert", { new: { evidence_id: "e1", related_id: "e2" } }), titles).text, "linked “Agent study” to “Press piece”");
  assert.equal(describeAudit(row("arbiter_actions", "insert", { new: { kind: "decay_waiver_revoked", month: "2027-02", note: "oops" } }, "x"), titles).text, "revoked the 2027-02 decay waiver");
  assert.equal(describeAudit(row("change_requests", "update", { old: { status: "open" }, new: { kind: "priors", status: "applied" } }, "r1"), titles).href, "/rules#request-r1");
  assert.equal(describeAudit(row("comments", "insert", { new: { evidence_id: "e2", body: "Where is the paper?" } }, "c1"), titles).text, "commented on “Press piece”");
});
