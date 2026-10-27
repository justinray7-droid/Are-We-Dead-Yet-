import { test } from "node:test";
import assert from "node:assert/strict";
import { projectUrl } from "../url.ts";

test("The project URL works however it was pasted", () => {
  const want = "https://abc.supabase.co";
  for (const raw of [want, `${want}/`, `${want}/rest/v1`, `${want}/rest/v1/`, `  ${want}/rest/v1/ `]) {
    assert.equal(projectUrl(raw), want, raw);
  }
  assert.equal(projectUrl(undefined), "");
});
