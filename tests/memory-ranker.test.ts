import test from "node:test";
import assert from "node:assert/strict";
import { MemoryRanker } from "../src/memory/MemoryRanker.js";
import type { MemoryRecord } from "../src/types/domain.js";

test("preference memory outranks weak episodic memory for the same query", () => {
  const ranker = new MemoryRanker();
  const queryEmbedding = [1, 0, 0];
  const ranked = ranker.rank("concise chinese terminal replies", [
    memory({
      id: "pref",
      kind: "preference",
      summary: "User prefers concise Chinese terminal replies.",
      topics: ["concise", "chinese", "terminal", "replies"],
      embedding: [1, 0, 0],
      salience: 9.5,
      importance: 9,
    }),
    memory({
      id: "episodic",
      kind: "episodic",
      summary: "User mentioned terminal replies once.",
      topics: ["terminal", "replies"],
      embedding: [0.6, 0, 0],
      salience: 4,
      importance: 3,
    }),
  ], queryEmbedding);

  assert.equal(ranked[0].id, "pref");
  assert.ok((ranked[0].score ?? 0) > (ranked[1].score ?? 0));
});

test("suppresses noisy metadata memories during ranking", () => {
  const ranker = new MemoryRanker();
  const ranked = ranker.rank("你记得我的偏好吗", [
    memory({
      id: "noise",
      kind: "session_state",
      summary: 'Sender (untrusted metadata): {"label":"openclaw-control-ui"}',
      content: 'Sender (untrusted metadata): {"label":"openclaw-control-ui"}',
      topics: ["sender", "metadata"],
      embedding: [1, 0, 0],
      salience: 9,
      importance: 9,
    }),
    memory({
      id: "pref",
      kind: "preference",
      summary: "User prefers concise execution-oriented updates.",
      topics: ["concise", "execution", "updates"],
      embedding: [0.9, 0, 0],
      salience: 8,
      importance: 8,
    }),
  ], [1, 0, 0]);

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, "pref");
});

function memory(
  overrides: Partial<MemoryRecord> & Pick<MemoryRecord, "id" | "kind" | "summary">,
): MemoryRecord {
  const now = new Date().toISOString();
  return {
    id: overrides.id,
    kind: overrides.kind,
    summary: overrides.summary,
    content: overrides.content ?? overrides.summary,
    topics: overrides.topics ?? [],
    entityKeys: overrides.entityKeys ?? [],
    salience: overrides.salience ?? 5,
    fingerprint: overrides.id,
    createdAt: now,
    lastSeenAt: now,
    decayRate: 0.01,
    ttlDays: 180,
    sourceSessionId: "session-test",
    sourceTurnIds: ["turn-1"],
    embedding: overrides.embedding ?? [],
    confidence: overrides.confidence ?? 0.9,
    importance: overrides.importance ?? 5,
    active: true,
  };
}
