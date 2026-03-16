import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { PluginContainer } from "../src/plugin/runtime-state.js";
import { resolvePluginConfig } from "../src/config/loader.js";
import { createTempDir, cleanupTempDir } from "./helpers/temp-db.js";

function createTestContainer(openclawHome: string): PluginContainer {
  return new PluginContainer(
    resolvePluginConfig({
      env: {
        ...process.env,
        OPENCLAW_HOME: openclawHome,
      },
      pluginConfig: {
        storageDir: path.join(openclawHome, ".openclaw", "plugins", "openclaw-recall"),
        identity: { mode: "local" },
      },
      openclawHome: path.join(openclawHome, ".openclaw"),
    }),
    {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  );
}

test("retrieval gate skips irrelevant memory work for command-like prompts but not recall prompts", async () => {
  const tempDir = await createTempDir("openclaw-recall-retrieval-gate-");
  try {
    const container = createTestContainer(tempDir);
    await container.memoryStore.upsertMany([
      {
        id: "pref-1",
        kind: "preference",
        summary: "User prefers concise Chinese replies.",
        content: "User prefers concise Chinese replies.",
        topics: ["concise", "chinese", "replies"],
        entityKeys: [],
        salience: 9,
        fingerprint: "pref-1",
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        ttlDays: 180,
        decayRate: 0.01,
        confidence: 0.9,
        importance: 9,
        active: true,
        sourceSessionId: "seed",
        sourceTurnIds: ["seed-1"],
      },
    ]);

    const skipped = await container.prepareSessionContext({
      sessionId: "s1",
      prompt: "run tests",
      messages: [],
    });
    const recalled = await container.prepareSessionContext({
      sessionId: "s2",
      prompt: "你记得我的偏好吗？",
      messages: [],
    });

    assert.equal(skipped.memoryCandidates, 0);
    assert.equal(skipped.memories.length, 0);
    assert.ok(recalled.memoryCandidates >= 1);
    assert.ok(recalled.memories.some((memory) => memory.kind === "preference"));
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("recall retrieval mixes stable preference and current project context after import-style writes", async () => {
  const tempDir = await createTempDir("openclaw-recall-retrieval-mix-");
  try {
    const container = createTestContainer(tempDir);
    await container.memoryStore.upsertMany([
      {
        id: "pref-1",
        kind: "preference",
        summary: "User prefers Chinese responses and concise execution-oriented updates.",
        content: "User prefers Chinese responses and concise execution-oriented updates.",
        topics: ["chinese", "concise", "execution", "updates"],
        entityKeys: [],
        salience: 9,
        fingerprint: "pref-mixed",
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        ttlDays: 180,
        decayRate: 0.01,
        confidence: 0.9,
        importance: 9.4,
        active: true,
        scope: "private",
        scopeKey: "user:default",
        sourceSessionId: "imported",
        sourceTurnIds: ["imported-pref"],
      },
      {
        id: "proj-1",
        kind: "semantic",
        summary: "Project focus is backend, scope, and import quality for Recall v1.1.",
        content: "Project focus is backend, scope, and import quality for Recall v1.1.",
        topics: ["backend", "scope", "import", "quality", "recall"],
        entityKeys: [],
        salience: 8.6,
        fingerprint: "proj-focus",
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        ttlDays: 120,
        decayRate: 0.01,
        confidence: 0.9,
        importance: 9,
        active: true,
        scope: "workspace",
        scopeKey: "workspace:default",
        memoryGroup: "semantic:project",
        sourceSessionId: "imported",
        sourceTurnIds: ["imported-proj"],
      },
      {
        id: "pref-2",
        kind: "preference",
        summary: "User prefers concise terminal-first answers.",
        content: "User prefers concise terminal-first answers.",
        topics: ["concise", "terminal", "answers"],
        entityKeys: [],
        salience: 8.7,
        fingerprint: "pref-secondary",
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        ttlDays: 180,
        decayRate: 0.01,
        confidence: 0.9,
        importance: 9.1,
        active: true,
        scope: "private",
        scopeKey: "user:default",
        sourceSessionId: "imported",
        sourceTurnIds: ["imported-pref-2"],
      },
    ]);

    const result = await container.memoryRetriever.retrieveWithContext("你记得我的偏好和当前项目重点吗？", 2, {
      sessionId: "s1",
    });

    assert.equal(result.memories.length, 2);
    assert.equal(result.memories.some((memory) => memory.kind === "preference"), true);
    assert.equal(result.memories.some((memory) => memory.kind === "semantic"), true);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("relation-aware retrieval stitches active task state with project context instead of only returning preference duplicates", async () => {
  const tempDir = await createTempDir("openclaw-recall-retrieval-stitch-");
  try {
    const container = createTestContainer(tempDir);
    const now = new Date().toISOString();
    await container.memoryStore.upsertMany([
      {
        id: "pref-a",
        kind: "preference",
        summary: "User prefers concise Chinese execution-oriented updates.",
        content: "User prefers concise Chinese execution-oriented updates.",
        topics: ["chinese", "concise", "execution", "updates"],
        entityKeys: ["recall", "backend"],
        salience: 9,
        fingerprint: "pref-a",
        createdAt: now,
        lastSeenAt: now,
        ttlDays: 180,
        decayRate: 0.01,
        confidence: 0.9,
        importance: 9.4,
        active: true,
        scope: "private",
        scopeKey: "user:default",
        sourceSessionId: "imported",
        sourceTurnIds: ["pref-a"],
      },
      {
        id: "pref-b",
        kind: "preference",
        summary: "User prefers concise terminal-first answers.",
        content: "User prefers concise terminal-first answers.",
        topics: ["concise", "terminal", "answers"],
        entityKeys: ["recall"],
        salience: 8.8,
        fingerprint: "pref-b",
        createdAt: now,
        lastSeenAt: now,
        ttlDays: 180,
        decayRate: 0.01,
        confidence: 0.9,
        importance: 9.1,
        active: true,
        scope: "private",
        scopeKey: "user:default",
        sourceSessionId: "imported",
        sourceTurnIds: ["pref-b"],
      },
      {
        id: "proj-a",
        kind: "semantic",
        summary: "Project focus: Recall backend and import quality.",
        content: "Project focus: Recall backend and import quality.",
        topics: ["recall", "backend", "import", "quality"],
        entityKeys: ["recall", "backend"],
        salience: 8.7,
        fingerprint: "proj-a",
        createdAt: now,
        lastSeenAt: now,
        ttlDays: 120,
        decayRate: 0.01,
        confidence: 0.9,
        importance: 8.9,
        active: true,
        scope: "workspace",
        scopeKey: "workspace:default",
        memoryGroup: "semantic:project",
        sourceSessionId: "imported",
        sourceTurnIds: ["proj-a"],
      },
      {
        id: "task-a",
        kind: "session_state",
        summary: "Current task: finish backend import verification.",
        content: "Current task: finish backend import verification.",
        topics: ["backend", "import", "verification"],
        entityKeys: ["backend"],
        salience: 8.4,
        fingerprint: "task-a",
        createdAt: now,
        lastSeenAt: now,
        ttlDays: 21,
        decayRate: 0.08,
        confidence: 0.88,
        importance: 8.4,
        active: true,
        scope: "session",
        scopeKey: "session:s1",
        sourceSessionId: "s1",
        sourceTurnIds: ["task-a"],
      },
    ]);

    const result = await container.memoryRetriever.retrieveWithContext(
      "继续当前 backend import 任务，记得项目重点和我的协作偏好",
      3,
      { sessionId: "s1" },
    );

    assert.equal(result.memories.length, 3);
    assert.ok(result.memories.some((memory) => memory.kind === "preference"));
    assert.ok(result.memories.some((memory) => memory.kind === "semantic"));
    assert.ok(result.memories.some((memory) => memory.kind === "session_state"));
  } finally {
    await cleanupTempDir(tempDir);
  }
});
