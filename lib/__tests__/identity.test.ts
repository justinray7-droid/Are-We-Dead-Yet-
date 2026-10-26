import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMemberId } from "../identity.ts";

test("Only a well-formed member id counts as a picked name", () => {
  assert.equal(parseMemberId("00000000-0000-0000-0000-00000000000A"), "00000000-0000-0000-0000-00000000000a");
  for (const bad of [undefined, null, "", "alex", "00000000-0000-0000-0000-00000000000", "x' or 1=1 --"]) {
    assert.equal(parseMemberId(bad), null, String(bad));
  }
});
