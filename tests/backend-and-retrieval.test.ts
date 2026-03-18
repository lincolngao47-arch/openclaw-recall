import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import path from "node:path";
import { startRecallHttpBackendServer } from "../src/backend/RecallHttpBackend.js";
import { defaultPluginConfig } from "../src/config/defaults.js";
import { createEmbeddingProvider } from "../src/memory/EmbeddingProvider.js";
import { MemoryExtractor } from "../src/memory/MemoryExtractor.js";
import { MemoryRanker } from "../src/memory/MemoryRanker.js";
import { MemoryRetriever } from "../src/memory/MemoryRetriever.js";
import { MemoryStore } from "../src/memory/MemoryStore.js";
import { PluginDatabase } from "../src/storage/PluginDatabase.js";
import type { ResolvedPluginConfig } from "../src/config/schema.js";
import type { MemoryRecord } from "../src/types/domain.js";
import type { EmbeddingProvider } from "../src/memory/EmbeddingProvider.js";
import { cleanupTempDir, createTempDir } from "./helpers/temp-db.js";

function buildConfig(overrides: Partial<ResolvedPluginConfig>): ResolvedPluginConfig {
  const base = {
    enabled: true,
    storageDir: ".tmp",
    databasePath: ".tmp/memory.sqlite",
    identity: {
      ...defaultPluginConfig.identity,
    },
    embedding: {
      ...defaultPluginConfig.embedding,
    },
    memory: {
      ...defaultPluginConfig.memory,
    },
    retrieval: {
      ...defaultPluginConfig.retrieval,
    },
    compression: {
      ...defaultPluginConfig.compression,
    },
    profile: {
      ...defaultPluginConfig.profile,
    },
    inspect: {
      ...defaultPluginConfig.inspect,
    },
    imports: {
      ...defaultPluginConfig.imports,
    },
    exports: {
      ...defaultPluginConfig.exports,
    },
  } satisfies ResolvedPluginConfig;
  return {
    ...base,
    ...overrides,
    identity: { ...base.identity, ...overrides.identity },
    embedding: { ...base.embedding, ...overrides.embedding },
    memory: { ...base.memory, ...overrides.memory },
    retrieval: { ...base.retrieval, ...overrides.retrieval },
    compression: { ...base.compression, ...overrides.compression },
    profile: { ...base.profile, ...overrides.profile },
    inspect: { ...base.inspect, ...overrides.inspect },
    imports: { ...base.imports, ...overrides.imports },
    exports: { ...base.exports, ...overrides.exports },
  };
}

function buildMemory(summary: string, extras: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = new Date().toISOString();
  return {
    id: extras.id ?? crypto.randomUUID(),
    kind: extras.kind ?? "preference",
    summary,
    content: extras.content ?? summary,
    topics: extras.topics ?? summary.toLowerCase().split(/\s+/),
    entityKeys: extras.entityKeys ?? [],
    salience: extras.salience ?? 7,
    fingerprint: extras.fingerprint ?? `fp:${summary}`,
    createdAt: extras.createdAt ?? now,
    lastSeenAt: extras.lastSeenAt ?? now,
    decayRate: extras.decayRate ?? 0.05,
    ttlDays: extras.ttlDays ?? 180,
    confidence: extras.confidence ?? 0.9,
    importance: extras.importance ?? 8,
    active: extras.active ?? true,
    scope: extras.scope ?? "private",
    scopeKey: extras.scopeKey ?? "user:default",
    memoryGroup: extras.memoryGroup,
    version: extras.version ?? 1,
    sourceSessionId: extras.sourceSessionId ?? "s1",
    sourceTurnIds: extras.sourceTurnIds ?? ["t1"],
    embedding: extras.embedding ?? [],
  };
}

function fixedEmbeddingProvider(vectors: Record<string, number[]>): EmbeddingProvider {
  return {
    providerId: "openai",
    dimensions: 3,
    available: true,
    availability: "exact",
    async embed(text: string): Promise<number[]> {
      return vectors[text] ?? [0, 0, 1];
    },
  };
}

function throwingEmbeddingProvider(): EmbeddingProvider {
  return {
    providerId: "openai",
    dimensions: 3,
    available: true,
    availability: "exact",
    async embed(): Promise<number[]> {
      throw new Error("embedding network failed");
    },
  };
}

test("recall-http backend persists and reconnects the same memory space", async () => {
  const tempDir = await createTempDir("openclaw-recall-http-");
  const server = await startRecallHttpBackendServer({
    dataDir: tempDir,
    port: 0,
  });
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const port = address.port;
    const config = buildConfig({
      storageDir: tempDir,
      databasePath: path.join(tempDir, "local.sqlite"),
      identity: {
        ...defaultPluginConfig.identity,
        mode: "cloud",
        backendType: "recall-http",
        endpoint: `http://127.0.0.1:${port}`,
        memorySpaceId: "team-space",
        apiKey: "demo-key",
      },
    });
    const embeddings = createEmbeddingProvider(config);
    const store = new MemoryStore(new PluginDatabase(config.databasePath), embeddings, 0.92, config);
    const memory = buildMemory("User prefers Chinese responses.");
    const write = await store.upsertMany([memory]);
    assert.equal(write.written, 1);

    const reconnectConfig = buildConfig({
      storageDir: tempDir,
      databasePath: path.join(tempDir, "local-2.sqlite"),
      identity: {
        ...defaultPluginConfig.identity,
        mode: "reconnect",
        backendType: "recall-http",
        endpoint: `http://127.0.0.1:${port}`,
        memorySpaceId: "team-space",
        identityKey: "recall_shared",
        apiKey: "demo-key",
      },
    });
    const reconnectStore = new MemoryStore(
      new PluginDatabase(reconnectConfig.databasePath),
      createEmbeddingProvider(reconnectConfig),
      0.92,
      reconnectConfig,
    );
    const listed = await reconnectStore.listActive();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].summary, memory.summary);
    const spaces = await reconnectStore.listMemorySpaces();
    assert.equal(spaces.length, 1);
    assert.equal(spaces[0].id, "team-space");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanupTempDir(tempDir);
  }
});

test("recall-http backend supports update and delete across reconnect clients", async () => {
  const tempDir = await createTempDir("openclaw-recall-http-crud-");
  const server = await startRecallHttpBackendServer({
    dataDir: tempDir,
    port: 0,
  });
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const port = address.port;
    const config = buildConfig({
      storageDir: tempDir,
      databasePath: path.join(tempDir, "memory.sqlite"),
      identity: {
        ...defaultPluginConfig.identity,
        mode: "cloud",
        backendType: "recall-http",
        endpoint: `http://127.0.0.1:${port}`,
        memorySpaceId: "team-space",
      },
    });
    const store = new MemoryStore(new PluginDatabase(config.databasePath), createEmbeddingProvider(config), 0.92, config);
    const memory = buildMemory("User prefers concise status updates.", {
      memoryGroup: "preference:status",
    });
    await store.upsertMany([memory]);
    const updated = await store.updateMemory(memory.id, {
      summary: "User prefers concise structured status updates.",
      content: "User prefers concise structured status updates.",
    });
    assert.equal(updated?.summary, "User prefers concise structured status updates.");

    const reconnectConfig = buildConfig({
      storageDir: tempDir,
      databasePath: path.join(tempDir, "memory-2.sqlite"),
      identity: {
        ...defaultPluginConfig.identity,
        mode: "reconnect",
        backendType: "recall-http",
        endpoint: `http://127.0.0.1:${port}`,
        memorySpaceId: "team-space",
        identityKey: "team-space",
      },
    });
    const reconnectStore = new MemoryStore(
      new PluginDatabase(reconnectConfig.databasePath),
      createEmbeddingProvider(reconnectConfig),
      0.92,
      reconnectConfig,
    );
    const afterUpdate = await reconnectStore.getById(memory.id);
    assert.equal(afterUpdate?.summary, "User prefers concise structured status updates.");
    const deleted = await reconnectStore.deleteMemory(memory.id);
    assert.equal(deleted.deleted, true);
    const active = await reconnectStore.listActive();
    assert.equal(active.length, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanupTempDir(tempDir);
  }
});

test("recall-http backend reports auth failure and unreachable status", async () => {
  const tempDir = await createTempDir("openclaw-recall-http-auth-");
  const server = await startRecallHttpBackendServer({
    dataDir: tempDir,
    port: 0,
    apiKey: "correct-token",
  });
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const port = address.port;
    const config = buildConfig({
      storageDir: tempDir,
      databasePath: path.join(tempDir, "memory.sqlite"),
      identity: {
        ...defaultPluginConfig.identity,
        mode: "cloud",
        backendType: "recall-http",
        endpoint: `http://127.0.0.1:${port}`,
        memorySpaceId: "team-space",
        apiKey: "wrong-token",
      },
    });
    const store = new MemoryStore(new PluginDatabase(config.databasePath), createEmbeddingProvider(config), 0.92, config);
    const ping = await store.pingBackend();
    assert.equal(ping.ok, false);
    assert.match(ping.detail, /401|Unauthorized/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanupTempDir(tempDir);
  }
});

test("embedding retrieval can surface semantic matches without lexical overlap", async () => {
  const tempDir = await createTempDir("openclaw-recall-semantic-candidates-");
  try {
    const config = buildConfig({
      storageDir: tempDir,
      databasePath: path.join(tempDir, "memory.sqlite"),
      retrieval: {
        mode: "embedding",
        fallbackToKeyword: false,
      },
    });
    const store = new MemoryStore(new PluginDatabase(config.databasePath), createEmbeddingProvider(config), 0.92, config);
    await store.upsertMany([
      buildMemory("Release playbook for backend rollout.", {
        kind: "semantic",
        topics: ["release", "playbook", "backend", "rollout"],
        embedding: [1, 0, 0],
      }),
    ]);
    const retriever = new MemoryRetriever(store, new MemoryRanker(), fixedEmbeddingProvider({
      "ship the launch": [1, 0, 0],
    }), 4, config);
    const result = await retriever.retrieveWithContext("ship the launch", 4, {
      sessionId: "s1",
      touch: false,
    });
    assert.equal(result.mode, "embedding");
    assert.equal(result.memories.length, 1);
    assert.match(result.memories[0].summary, /Release playbook/i);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("hybrid retrieval falls back to keyword when embedding requests fail at runtime", async () => {
  const tempDir = await createTempDir("openclaw-recall-hybrid-runtime-fallback-");
  try {
    const config = buildConfig({
      storageDir: tempDir,
      databasePath: path.join(tempDir, "memory.sqlite"),
      retrieval: {
        mode: "hybrid",
        fallbackToKeyword: true,
      },
    });
    const store = new MemoryStore(new PluginDatabase(config.databasePath), createEmbeddingProvider(config), 0.92, config);
    await store.upsertMany([
      buildMemory("User prefers concise terminal-first answers.", {
        topics: ["concise", "terminal", "answers"],
      }),
    ]);
    const retriever = new MemoryRetriever(store, new MemoryRanker(), throwingEmbeddingProvider(), 4, config);
    const result = await retriever.retrieveWithContext("concise terminal answers", 4, {
      sessionId: "s1",
      touch: false,
    });
    assert.equal(result.mode, "keyword");
    assert.equal(result.memories.length, 1);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("hybrid retrieval falls back to keyword when embeddings are unavailable", async () => {
  const tempDir = await createTempDir("openclaw-recall-hybrid-");
  try {
    const config = buildConfig({
      storageDir: tempDir,
      databasePath: path.join(tempDir, "memory.sqlite"),
      embedding: {
        ...defaultPluginConfig.embedding,
        provider: "openai",
        apiKey: undefined,
      },
      retrieval: {
        mode: "hybrid",
        fallbackToKeyword: true,
      },
    });
    const store = new MemoryStore(new PluginDatabase(config.databasePath), createEmbeddingProvider(config), 0.92, config);
    await store.upsertMany([
      buildMemory("User prefers concise terminal-first answers.", {
        topics: ["concise", "terminal", "answers"],
      }),
    ]);
    const retriever = new MemoryRetriever(store, new MemoryRanker(), createEmbeddingProvider(config), 4, config);
    const result = await retriever.retrieveWithContext("concise terminal answers", 4, { sessionId: "s1" });
    assert.equal(result.mode, "keyword");
    assert.equal(result.memories.length, 1);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("memory explain does not mutate access metadata", async () => {
  const tempDir = await createTempDir("openclaw-recall-explain-readonly-");
  try {
    const config = buildConfig({
      storageDir: tempDir,
      databasePath: path.join(tempDir, "memory.sqlite"),
    });
    const store = new MemoryStore(new PluginDatabase(config.databasePath), createEmbeddingProvider(config), 0.92, config);
    const seeded = buildMemory("User prefers concise terminal-first answers.", {
      topics: ["concise", "terminal", "answers"],
    });
    await store.upsertMany([seeded]);
    const retriever = new MemoryRetriever(store, new MemoryRanker(), createEmbeddingProvider(config), 4, config);

    await retriever.explain("concise terminal answers", 4, { sessionId: "s1" });
    const memory = await store.getById(seeded.id);

    assert.equal(memory?.lastAccessedAt, undefined);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("end-to-end chinese preference retrieval works without manual topic seeding", async () => {
  const tempDir = await createTempDir("openclaw-recall-chinese-e2e-");
  try {
    const config = buildConfig({
      storageDir: tempDir,
      databasePath: path.join(tempDir, "memory.sqlite"),
    });
    const extractor = new MemoryExtractor({
      writeThreshold: config.memory.writeThreshold,
      preferenceTtlDays: config.memory.preferenceTtlDays,
      semanticTtlDays: config.memory.semanticTtlDays,
      episodicTtlDays: config.memory.episodicTtlDays,
      sessionStateTtlDays: config.memory.sessionStateTtlDays,
    });
    const store = new MemoryStore(new PluginDatabase(config.databasePath), createEmbeddingProvider(config), 0.92, config);
    const extracted = extractor.extract({
      id: "turn-1",
      sessionId: "s1",
      role: "user",
      text: "以后默认用中文回答，尽量简洁。",
      createdAt: new Date().toISOString(),
    });
    await store.upsertMany(extracted.memories.map((memory) => ({
      ...memory,
      scope: "private",
      scopeKey: "user:default",
    })));
    const retriever = new MemoryRetriever(store, new MemoryRanker(), createEmbeddingProvider(config), 4, config);
    const result = await retriever.retrieveWithContext("之后继续用中文回答好吗", 4, {
      sessionId: "s1",
      touch: false,
    });
    assert.ok(result.memories.some((memory) => /Chinese responses/i.test(memory.summary)));
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("shared and private scope boundaries are enforced during retrieval", async () => {
  const tempDir = await createTempDir("openclaw-recall-scope-");
  try {
    const config = buildConfig({
      storageDir: tempDir,
      databasePath: path.join(tempDir, "memory.sqlite"),
      identity: {
        ...defaultPluginConfig.identity,
        mode: "shared",
        sharedScope: "team-alpha",
        workspaceScope: "workspace-a",
        userScope: "felix",
      },
    });
    const embeddings = createEmbeddingProvider(config);
    const store = new MemoryStore(new PluginDatabase(config.databasePath), embeddings, 0.92, config);
    await store.upsertMany([
      buildMemory("User prefers Chinese responses.", {
        scope: "private",
        scopeKey: "user:felix",
        topics: ["chinese", "responses"],
      }),
      buildMemory("Workspace project context is NovaClaw parity.", {
        kind: "semantic",
        scope: "workspace",
        scopeKey: "workspace:workspace-a",
        topics: ["project", "novaclaw", "parity"],
      }),
      buildMemory("Shared team style prefers concise standups.", {
        kind: "semantic",
        scope: "shared",
        scopeKey: "shared:team-alpha",
        topics: ["shared", "team", "concise", "standups"],
      }),
      buildMemory("Other user secret preference", {
        scope: "private",
        scopeKey: "user:someone-else",
        topics: ["secret"],
      }),
    ]);
    const retriever = new MemoryRetriever(store, new MemoryRanker(), embeddings, 4, config);
    const result = await retriever.retrieveWithContext("concise chinese project standup", 8, { sessionId: "s1" });
    const summaries = result.memories.map((memory) => memory.summary);
    assert(summaries.some((summary) => /Chinese/.test(summary)));
    assert(summaries.some((summary) => /NovaClaw parity/.test(summary)));
    assert(summaries.some((summary) => /Shared team style/.test(summary)));
    assert(!summaries.some((summary) => /Other user secret/.test(summary)));
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("memory explain exposes retrieval contributions and suppressed noisy rows", async () => {
  const tempDir = await createTempDir("openclaw-recall-explain-");
  try {
    const config = buildConfig({
      storageDir: tempDir,
      databasePath: path.join(tempDir, "memory.sqlite"),
      identity: {
        ...defaultPluginConfig.identity,
        mode: "shared",
        sharedScope: "team-alpha",
        workspaceScope: "workspace-a",
        userScope: "felix",
      },
    });
    const embeddings = createEmbeddingProvider(config);
    const store = new MemoryStore(new PluginDatabase(config.databasePath), embeddings, 0.92, config);
    await store.upsertMany([
      buildMemory("User prefers Chinese responses.", {
        scope: "private",
        scopeKey: "user:felix",
        topics: ["chinese", "responses"],
      }),
      buildMemory("Workspace project context is Recall v1.1.", {
        kind: "semantic",
        scope: "workspace",
        scopeKey: "workspace:workspace-a",
        topics: ["recall", "project", "v1.1"],
      }),
      buildMemory('Sender (untrusted metadata): {"label":"openclaw-control-ui"}', {
        kind: "session_state",
        scope: "session",
        scopeKey: "session:s1",
        topics: ["sender", "metadata"],
      }),
    ]);
    const retriever = new MemoryRetriever(store, new MemoryRanker(), embeddings, 4, config);
    const explained = await retriever.explainDetailed("Recall 中文 project", 8, { sessionId: "s1" });
    assert.equal(explained.retrievalMode, "hybrid");
    assert(explained.selected.length >= 2);
    assert(explained.keywordContribution >= 0);
    assert(explained.semanticContribution >= 0);
    assert(explained.selected.every((memory) => typeof memory.scoreBreakdown?.finalScore === "number"));
    assert(explained.suppressed.some((entry) => /metadata/.test(entry.summary)));
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("stale semantic facts remain inspectable but stop polluting retrieval", async () => {
  const tempDir = await createTempDir("openclaw-recall-stale-semantic-");
  try {
    const config = buildConfig({
      storageDir: tempDir,
      databasePath: path.join(tempDir, "memory.sqlite"),
      retrieval: {
        mode: "hybrid",
        fallbackToKeyword: true,
      },
    });
    const store = new MemoryStore(
      new PluginDatabase(config.databasePath),
      createEmbeddingProvider(config),
      0.92,
      config,
    );
    const now = Date.now();
    await store.upsertMany([
      buildMemory("Project context: old focus was legacy wrappers.", {
        kind: "semantic",
        memoryGroup: "semantic:project",
        scope: "workspace",
        scopeKey: "workspace:default",
        createdAt: new Date(now - 70 * 24 * 60 * 60 * 1000).toISOString(),
        lastSeenAt: new Date(now - 70 * 24 * 60 * 60 * 1000).toISOString(),
        lastAccessedAt: new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString(),
        importance: 6.5,
      }),
      buildMemory("Project context: current focus is backend, scope, and import quality.", {
        kind: "semantic",
        memoryGroup: "semantic:project-current",
        scope: "workspace",
        scopeKey: "workspace:default",
        importance: 9.2,
      }),
    ]);

    const ranker = new MemoryRanker();
    const retriever = new MemoryRetriever(store, ranker, createEmbeddingProvider(config), 4, config);
    const result = await retriever.retrieveWithContext("project current focus import quality", 5, {});
    const explain = await retriever.explainDetailed("project current focus import quality", 5, {});
    const all = await store.listAll();

    assert.equal(all.length, 2);
    assert.equal(result.memories.length, 1);
    assert.match(result.memories[0].summary, /current focus/i);
    assert(explain.suppressed.some((row) => row.reasons.includes("stale-semantic")));
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("recall-style queries prioritize stable preferences and current project context", async () => {
  const tempDir = await createTempDir("openclaw-recall-recall-priority-");
  try {
    const config = buildConfig({
      storageDir: tempDir,
      databasePath: path.join(tempDir, "memory.sqlite"),
      retrieval: {
        mode: "hybrid",
        fallbackToKeyword: true,
      },
    });
    const store = new MemoryStore(
      new PluginDatabase(config.databasePath),
      createEmbeddingProvider(config),
      0.92,
      config,
    );
    await store.upsertMany([
      buildMemory("User prefers Chinese responses and concise execution-oriented updates.", {
        kind: "preference",
        scope: "private",
        scopeKey: "user:default",
        importance: 9.5,
        salience: 9,
      }),
      buildMemory("Project focus is backend, scope, and import quality for Recall v1.1.", {
        kind: "semantic",
        memoryGroup: "semantic:project",
        scope: "workspace",
        scopeKey: "workspace:default",
        importance: 9,
        salience: 8.5,
      }),
      buildMemory("Session wrapper metadata for remote run.", {
        kind: "session_state",
        scope: "session",
        scopeKey: "session:s1",
        importance: 5,
        salience: 4,
      }),
    ]);

    const retriever = new MemoryRetriever(store, new MemoryRanker(), createEmbeddingProvider(config), 4, config);
    const result = await retriever.retrieveWithContext("你记得我的偏好和当前项目重点吗？", 3, {
      sessionId: "s1",
    });

    assert.equal(result.memories.length, 3);
    assert.match(result.memories[0].summary, /prefers Chinese|Chinese responses/i);
    assert.match(result.memories[1].summary, /Project focus is backend, scope, and import quality/i);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("retrieval diversifies near-duplicate preferences with current project context", async () => {
  const tempDir = await createTempDir("openclaw-recall-diversity-");
  try {
    const config = buildConfig({
      storageDir: tempDir,
      databasePath: path.join(tempDir, "memory.sqlite"),
      retrieval: {
        mode: "hybrid",
        fallbackToKeyword: true,
      },
    });
    const store = new MemoryStore(
      new PluginDatabase(config.databasePath),
      createEmbeddingProvider(config),
      0.92,
      config,
    );
    await store.upsertMany([
      buildMemory("User prefers concise Chinese replies.", {
        kind: "preference",
        scope: "private",
        scopeKey: "user:default",
        memoryGroup: "preference:language-style",
        topics: ["concise", "chinese", "replies"],
        importance: 9.4,
      }),
      buildMemory("User prefers concise execution-oriented updates in Chinese.", {
        kind: "preference",
        scope: "private",
        scopeKey: "user:default",
        topics: ["concise", "execution", "chinese", "updates"],
        importance: 9.2,
      }),
      buildMemory("Project focus is backend, scope, and import quality.", {
        kind: "semantic",
        scope: "workspace",
        scopeKey: "workspace:default",
        memoryGroup: "semantic:project",
        topics: ["backend", "scope", "import", "quality"],
        importance: 8.8,
      }),
    ]);

    const retriever = new MemoryRetriever(store, new MemoryRanker(), createEmbeddingProvider(config), 4, config);
    const result = await retriever.retrieveWithContext("你记得我的偏好和当前项目重点吗？", 2, {
      sessionId: "s1",
    });

    assert.equal(result.memories.length, 2);
    assert.equal(result.memories.some((memory) => memory.kind === "preference"), true);
    assert.equal(result.memories.some((memory) => memory.kind === "semantic"), true);
  } finally {
    await cleanupTempDir(tempDir);
  }
});
