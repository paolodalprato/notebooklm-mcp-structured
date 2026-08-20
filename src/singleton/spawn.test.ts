import { test } from "node:test";
import assert from "node:assert/strict";
import { decideOnHealth } from "./spawn.js";

test("matching version connects", () => {
  assert.equal(decideOnHealth({ ok: true, version: "1.1.0" }, "1.1.0"), "connect");
});

test("different version is replaced", () => {
  assert.equal(decideOnHealth({ ok: true, version: "1.0.0" }, "1.1.0"), "replace");
});

test("no health response is unreachable", () => {
  assert.equal(decideOnHealth(null, "1.1.0"), "unreachable");
  assert.equal(decideOnHealth({ ok: false, version: "1.1.0" }, "1.1.0"), "unreachable");
});
