import { test } from "node:test";
import assert from "node:assert/strict";
import { formValues, parseReview, parseSubmission } from "../form.ts";

const TODAY = "2026-10-26";
const ID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

function fd(entries: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of [v].flat()) f.append(k, x);
  return f;
}

const goodSubmission = {
  title: "  Lab reports autonomous discovery ",
  summary: "Short summary",
  source_url: "https://example.com/paper",
  source_type: "peer_reviewed",
  event_date: "2026-10-22",
  rationale: "Looks autonomous",
  tag_A: "on",
  direction_A: "YES",
  strength_A: "4",
  // Untagged claims are ignored even if their selects have values.
  direction_C: "NO",
  strength_C: "2",
};

test("A valid submission is trimmed and keeps only tagged claims", () => {
  const r = parseSubmission(fd(goodSubmission), TODAY);
  assert.ok(r.ok);
  assert.equal(r.value.title, "Lab reports autonomous discovery");
  assert.deepEqual(r.value.claims, [{ claim: "A", direction: "YES", strength: 4 }]);
});

test("Submission errors are reported per field", () => {
  const r = parseSubmission(
    fd({ title: "x", source_url: "ftp://example.com", source_type: "blog", event_date: "2026-02-30", rationale: " " }),
    TODAY,
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(Object.keys(r.errors).sort(), ["claims", "event_date", "rationale", "source_type", "source_url", "title"]);
  assert.equal(r.errors.claims, "Tag at least one claim.");
});

test("Event dates in the future are refused; today is fine", () => {
  const future = parseSubmission(fd({ ...goodSubmission, event_date: "2026-10-27" }), TODAY);
  assert.equal(future.ok, false);
  assert.ok(parseSubmission(fd({ ...goodSubmission, event_date: TODAY }), TODAY).ok);
});

test("A tagged claim needs a direction and strength", () => {
  const r = parseSubmission(fd({ ...goodSubmission, tag_B_LOOSE: "on", strength_B_LOOSE: "9" }), TODAY);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.errors.claims, /direction and strength/);
});

test("Approval carries final values and discounts; empty discount means none", () => {
  const r = parseReview(
    fd({
      decision: "approved",
      note: "",
      tag_A: "on", direction_A: "YES", strength_A: "3", discount_A: "0.5",
      tag_C: "on", direction_C: "NO", strength_C: "1", discount_C: "",
      is_expert_forecast: "on",
      links: [OTHER, ID, OTHER, "not-a-uuid"],
    }),
    ID,
  );
  assert.ok(r.ok);
  assert.deepEqual(r.value.claims, [
    { claim: "A", direction: "YES", strength: 3, discount: 0.5 },
    { claim: "C", direction: "NO", strength: 1, discount: 1 },
  ]);
  assert.equal(r.value.isExpertForecast, true);
  // Self-links, duplicates and junk are dropped.
  assert.deepEqual(r.value.links, [OTHER]);
});

test("Approval needs at least one tag and discounts within 0..1", () => {
  const none = parseReview(fd({ decision: "approved" }), ID);
  assert.equal(none.ok, false);
  const bad = parseReview(fd({ decision: "approved", tag_A: "on", direction_A: "NO", strength_A: "2", discount_A: "1.5" }), ID);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.errors.claims, /between 0 and 1/);
});

test("Reject and request-changes need a note; tag fields are ignored", () => {
  assert.equal(parseReview(fd({ decision: "rejected", note: "  " }), ID).ok, false);
  const r = parseReview(fd({ decision: "needs_changes", note: "Link the paper" }), ID);
  assert.ok(r.ok);
  assert.deepEqual(r.value.claims, []);
  assert.equal(parseReview(fd({ decision: "maybe" }), ID).ok, false);
});

test("formValues echoes input, keeps links as a list, skips React's fields", () => {
  const v = formValues(fd({ title: "T", links: [OTHER, ID], $ACTION_ID_abc: "" }));
  assert.deepEqual(v, { title: "T", links: [OTHER, ID] });
});
