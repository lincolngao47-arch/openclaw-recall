import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PluginContainer } from "../src/plugin/runtime-state.js";
import { resolvePluginConfig } from "../src/config/loader.js";
import { createTempDir, cleanupTempDir } from "./helpers/temp-db.js";
import { resolveTsxCommand } from "./helpers/tsx-path.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsx = resolveTsxCommand(repoRoot);

function createTestContainer(openclawRoot: string): PluginContainer {
  return new PluginContainer(
    resolvePluginConfig({
      env: {
        ...process.env,
        OPENCLAW_HOME: openclawRoot,
      },
      pluginConfig: {
        storageDir: path.join(openclawRoot, ".openclaw", "plugins", "openclaw-recall"),
        identity: { mode: "local" },
      },
      openclawHome: path.join(openclawRoot, ".openclaw"),
    }),
    {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  );
}

test("status and profile inspect expose retrieval and hygiene outcomes for the integrated ideas", async () => {
  const tempDir = await createTempDir("openclaw-recall-operator-");
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
        salience: 8.8,
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
    await container.profileStore.record({
      runId: "run-operator-1",
      sessionId: "session-operator-1",
      createdAt: new Date().toISOString(),
      promptTokens: 128,
      promptTokensSource: "exact",
      promptBudget: 2400,
      memoryInjected: 2,
      memoryCandidates: 3,
      memoryWritten: 1,
      toolTokens: 42,
      toolTokensSource: "estimated",
      toolTokensSaved: 61,
      toolTokensSavedSource: "estimated",
      historySummaryTokens: 24,
      historySummaryTokensSource: "estimated",
      compressionSavings: 85,
      compressionSavingsSource: "estimated",
      retrievalCount: 2,
      retrievalMode: "hybrid",
      keywordContribution: 3.2,
      semanticContribution: 4.8,
    });
    const configDir = path.join(tempDir, ".openclaw");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, "openclaw.json"),
      JSON.stringify({
        plugins: {
          entries: {
            "openclaw-recall": {
              enabled: true,
              config: {
                storageDir: path.join(tempDir, ".openclaw", "plugins", "openclaw-recall"),
                identity: { mode: "local" },
              },
            },
          },
        },
      }, null, 2),
    );

    const status = runCli(["status", "--json"], tempDir);
    const profile = runCli(["profile", "inspect", "run-operator-1", "--json"], tempDir);

    assert.equal(status.health, "healthy");
    assert.equal(status.recentRetrievalMode, "hybrid");
    assert.ok(typeof status.hygiene.score === "number");
    assert.equal(profile.summary.retrieval.mode, "hybrid");
    assert.equal(profile.sources.promptTokens, "exact");
    assert.equal(profile.sources.compressionSavings, "estimated");
  } finally {
    await cleanupTempDir(tempDir);
  }
});

test("memory explain exposes rrf contribution after v1.3 retrieval fusion", async () => {
  const tempDir = await createTempDir("openclaw-recall-operator-rrf-");
  try {
    const container = createTestContainer(tempDir);
    const now = new Date().toISOString();
    await container.memoryStore.upsertMany([
      {
        id: "pref-1",
        kind: "preference",
        summary: "User prefers concise Chinese replies.",
        content: "User prefers concise Chinese replies.",
        topics: ["concise", "chinese", "replies"],
        entityKeys: ["recall"],
        salience: 8.8,
        fingerprint: "pref-1",
        createdAt: now,
        lastSeenAt: now,
        ttlDays: 180,
        decayRate: 0.01,
        confidence: 0.9,
        importance: 9,
        active: true,
        scope: "private",
        scopeKey: "user:default",
        sourceSessionId: "seed",
        sourceTurnIds: ["seed-1"],
        embedding: [0.9, 0.1, 0.2],
      },
      {
        id: "semantic-1",
        kind: "semantic",
        summary: "Project focus is Recall import and retrieval quality.",
        content: "Project focus is Recall import and retrieval quality.",
        topics: ["project", "import", "retrieval", "quality"],
        entityKeys: ["recall", "import"],
        salience: 8.7,
        fingerprint: "semantic-1",
        createdAt: now,
        lastSeenAt: now,
        ttlDays: 120,
        decayRate: 0.01,
        confidence: 0.9,
        importance: 8.9,
        active: true,
        scope: "workspace",
        scopeKey: "workspace:default",
        sourceSessionId: "seed",
        sourceTurnIds: ["seed-2"],
        embedding: [0.2, 0.9, 0.2],
      },
    ]);

    const explain = await container.memoryRetriever.explainDetailed("记得我的偏好和当前项目重点", 3, {
      sessionId: "s1",
    });

    assert.ok(explain.selected.some((memory) => typeof memory.scoreBreakdown?.rrfContribution === "number"));
  } finally {
    await cleanupTempDir(tempDir);
  }
});

function runCli(args: string[], openclawRoot: string): any {
  return JSON.parse(
    execFileSync(tsx.command, [...tsx.argsPrefix, "src/cli/index.ts", ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_HOME: openclawRoot,
      },
    }),
  );
}
