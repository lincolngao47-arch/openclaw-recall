import test from "node:test";
import assert from "node:assert/strict";
import { MemoryExtractor } from "../src/memory/MemoryExtractor.js";
import type { ChatTurn } from "../src/types/domain.js";

function extractor() {
  return new MemoryExtractor({
    writeThreshold: 5.2,
    preferenceTtlDays: 180,
    semanticTtlDays: 120,
    episodicTtlDays: 14,
    sessionStateTtlDays: 21,
  });
}

test("extracts durable preference memories from explicit user preferences", () => {
  const result = extractor().extract(turn("以后默认叫我 Felix，用中文回答，并且尽量简洁。"));
  assert.equal(result.memories.length, 3);
  assert.deepEqual(
    result.memories.map((memory) => memory.kind),
    ["preference", "preference", "preference"],
  );
  assert.ok(result.memories.some((memory) => /Felix/.test(memory.summary)));
  assert.ok(result.memories.every((memory) => (memory.ttlDays ?? 0) >= 180));
});

test("captures open questions as session state instead of stable memory", () => {
  const result = extractor().extract(turn("你记得我的偏好吗？"));
  assert.equal(result.memories.length, 0);
  assert.deepEqual(result.statePatch.openQuestions, ["你记得我的偏好吗？"]);
});

test("rejects noisy metadata and heartbeat wrappers from memory writes", () => {
  const result = extractor().extract(
    turn('Sender (untrusted metadata): {"label":"openclaw-control-ui","id":"cron:12345678-abcd"} heartbeat'),
  );
  assert.equal(result.memories.length, 0);
  assert.deepEqual(result.statePatch.constraints, []);
  assert.deepEqual(result.statePatch.decisions, []);
  assert.deepEqual(result.statePatch.openQuestions, []);
});

test("extracts collaboration preferences as durable human-readable memory", () => {
  const result = extractor().extract(
    turn("之后跟我协作时偏直接、偏执行导向，汇报时用结论、进度、风险、下一步这种结构。"),
  );
  assert.ok(result.memories.length >= 2);
  assert.ok(
    result.memories.some((memory) =>
      /direct|execution-oriented|structured updates|结论|进度|风险|下一步/i.test(memory.summary),
    ),
  );
  assert.ok(result.memories.every((memory) => memory.kind === "preference"));
});

function turn(text: string): ChatTurn {
  return {
    id: "turn-1",
    sessionId: "session-1",
    role: "user",
    text,
    createdAt: new Date().toISOString(),
  };
}
