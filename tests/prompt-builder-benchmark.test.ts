import test from "node:test";
import assert from "node:assert/strict";
import { PromptBuilder } from "../src/compression/PromptBuilder.js";
import { BudgetManager } from "../src/compression/BudgetManager.js";
import type { CompressionResult, MemoryRecord, SessionState } from "../src/types/domain.js";

function buildMemory(
  id: string,
  kind: MemoryRecord["kind"],
  summary: string,
  extras: Partial<MemoryRecord> = {},
): MemoryRecord {
  const now = new Date().toISOString();
  return {
    id,
    kind,
    summary,
    content: extras.content ?? summary,
    topics: extras.topics ?? summary.toLowerCase().split(/\W+/).filter(Boolean),
    entityKeys: extras.entityKeys ?? [],
    salience: extras.salience ?? 8,
    fingerprint: extras.fingerprint ?? id,
    createdAt: extras.createdAt ?? now,
    lastSeenAt: extras.lastSeenAt ?? now,
    decayRate: extras.decayRate ?? 0.02,
    ttlDays: extras.ttlDays ?? 180,
    confidence: extras.confidence ?? 0.9,
    importance: extras.importance ?? 8.5,
    active: extras.active ?? true,
    scope: extras.scope ?? "private",
    scopeKey: extras.scopeKey ?? "user:default",
    memoryGroup: extras.memoryGroup,
    sourceSessionId: extras.sourceSessionId ?? "s1",
    sourceTurnIds: extras.sourceTurnIds ?? ["t1"],
    score: extras.score ?? 10,
  };
}

function emptyCompression(): CompressionResult {
  return {
    summary: "",
    hierarchicalSummaries: [],
    compressedTurns: [],
    keptRecentTurns: [],
    estimatedTokens: 0,
    savedTokens: 0,
  };
}

function emptyState(): SessionState {
  return {
    sessionId: "s1",
    constraints: [],
    decisions: [],
    openQuestions: [],
    updatedAt: new Date().toISOString(),
  };
}

test("prompt memory digest reduces duplicate preference context while keeping project/task context", () => {
  const builder = new PromptBuilder(new BudgetManager());
  const build = builder.build({
    budget: 2400,
    state: emptyState(),
    memories: [
      buildMemory("pref-1", "preference", "User prefers concise Chinese responses.", {
        topics: ["concise", "chinese", "responses"],
        memoryGroup: "preference:language-style",
      }),
      buildMemory("pref-2", "preference", "User prefers concise Chinese execution-oriented updates.", {
        topics: ["concise", "chinese", "execution", "updates"],
        memoryGroup: "preference:language-style",
      }),
      buildMemory("proj-1", "semantic", "Project focus: backend, import quality, and retrieval.", {
        scope: "workspace",
        scopeKey: "workspace:default",
        memoryGroup: "semantic:project",
      }),
      buildMemory("task-1", "session_state", "Current task: verify reconnect and import roundtrip.", {
        scope: "session",
        scopeKey: "session:s1",
      }),
    ],
    compression: emptyCompression(),
    recentTurns: [],
    toolResults: [],
    userMessage: "继续当前任务，记得我的偏好和项目重点",
  });

  const memoryLayer = build.layers.find((layer) => layer.name === "RELEVANT MEMORY");
  assert.ok(memoryLayer);
  assert.match(memoryLayer.content, /Use these stable user preferences first:/);
  assert.match(memoryLayer.content, /Use this current project\/task context if relevant:/);
  assert.match(memoryLayer.content, /Project focus:/);
  assert.match(memoryLayer.content, /Current task:/);
  assert.ok((memoryLayer.content.match(/User prefers concise Chinese/g) ?? []).length <= 1);
});
