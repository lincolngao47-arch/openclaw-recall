import test from "node:test";
import assert from "node:assert/strict";
import { buildMemoryFingerprint } from "../src/memory/identity.js";

test("fingerprint differs when content differs even if summary and group match", () => {
  const left = buildMemoryFingerprint({
    kind: "semantic",
    summary: "Project context: current focus.",
    content: "Project context: backend migration is pending.",
    memoryGroup: "semantic:project",
  });
  const right = buildMemoryFingerprint({
    kind: "semantic",
    summary: "Project context: current focus.",
    content: "Project context: import quality is the current focus.",
    memoryGroup: "semantic:project",
  });

  assert.notEqual(left, right);
});
