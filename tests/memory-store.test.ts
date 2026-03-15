import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import crypto from "node:crypto";
import { PluginDatabase } from "../src/storage/PluginDatabase.js";
import { MemoryStore } from "../src/memory/MemoryStore.js";
import { createEmbeddingProvider } from "../src/memory/EmbeddingProvider.js";
import { cleanupTempDir, createTempDir } from "./helpers/temp-db.js";
import type { MemoryRecord } from "../src/types/domain.js";

const embeddingProvider = createEmbeddingProvider({
  enabled: true,
  storageDir: "",
  databasePath: "",
  embedding: {
    provider: "local",
    model: "text-embedding-3-small",
    baseUrl: "https://api.openai.com/v1",
    dimensions: 256,
  },
  memory: {
    autoWrite: true,
    topK: 6,
    bootTopK: 4,
    maxWritesPerTurn: 6,
    dedupeSimilarity: 0.85,
    writeThreshold: 5.2,
    preferenceTtlDays: 180,
    semanticTtlDays: 120,
    episodicTtlDays: 14,
    sessionStateTtlDays: 21,
  },
  compression: {
    recentTurns: 6,
    contextBudget: 2400,
    historySummaryThreshold: 6,
    toolCompactionThresholdChars: 600,
  },
  profile: {
    retainRuns: 500,
    storeDetails: true,
  },
  inspect: {
    httpPath: "/plugins/openclaw-recall",
  },
});

test("merges semantically similar memories instead of duplicating rows", async () => {
  const tempDir = await createTempDir("openclaw-memory-store-");
  try {
    const store = new MemoryStore(
      new PluginDatabase(path.join(tempDir, "memory.sqlite")),
      embeddingProvider,
      0.75,
    );

    await store.upsertMany([
      memory({
        kind: "preference",
        summary: "User prefers concise terminal-first answers.",
        memoryGroup: "preference:style",
      }),
    ]);
    const second = await store.upsertMany([
      memory({
        kind: "preference",
        summary: "User prefers concise terminal answers.",
      }),
    ]);

    const records = await store.listActive();
    assert.equal(records.length, 1);
    assert.equal(second.updated, 1);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("supersedes conflicting preference memories in the same group", async () => {
  const tempDir = await createTempDir("openclaw-memory-store-");
  try {
    const store = new MemoryStore(
      new PluginDatabase(path.join(tempDir, "memory.sqlite")),
      embeddingProvider,
      0.99,
    );

    await store.upsertMany([
      memory({
        kind: "preference",
        summary: "User prefers long detailed explanations.",
        memoryGroup: "preference:style",
      }),
    ]);

    const result = await store.upsertMany([
      memory({
        kind: "preference",
        summary: "User prefers concise brief answers.",
        memoryGroup: "preference:style",
      }),
    ]);

    const active = await store.listActive();
    assert.equal(result.written, 1);
    assert.equal(result.superseded, 1);
    assert.equal(active.length, 1);
    assert.match(active[0].summary, /concise brief answers/i);
    assert.equal(active[0].version, 2);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("prunes noisy memories that were previously stored", async () => {
  const tempDir = await createTempDir("openclaw-memory-store-");
  try {
    const store = new MemoryStore(
      new PluginDatabase(path.join(tempDir, "memory.sqlite")),
      embeddingProvider,
      0.92,
    );

    await store.upsertMany([
      memory({
        kind: "session_state",
        summary: 'Sender (untrusted metadata): {"label":"openclaw-control-ui"}',
      }),
      memory({
        kind: "preference",
        summary: "User prefers concise execution-oriented updates.",
        memoryGroup: "preference:style",
      }),
    ]);

    const result = await store.pruneNoise();
    const active = await store.listActive();
    assert.equal(result.pruned, 1);
    assert.equal(active.length, 1);
    assert.match(active[0].summary, /concise execution-oriented updates/i);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

function memory(params: {
  kind: MemoryRecord["kind"];
  summary: string;
  memoryGroup?: string;
}): MemoryRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind: params.kind,
    summary: params.summary,
    content: params.summary,
    topics: params.summary.toLowerCase().split(/\s+/),
    entityKeys: [],
    salience: 8,
    fingerprint: crypto.createHash("sha1").update(`${params.kind}:${params.summary}:${crypto.randomUUID()}`).digest("hex"),
    createdAt: now,
    lastSeenAt: now,
    ttlDays: 180,
    decayRate: 0.01,
    confidence: 0.9,
    importance: 8.5,
    active: true,
    memoryGroup: params.memoryGroup,
    version: 1,
    sourceSessionId: "session-test",
    sourceTurnIds: ["turn-1"],
  };
}
