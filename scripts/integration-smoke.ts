import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installOpenAiResponsesMock } from "../src/testing/mockOpenAIResponses.js";
import { getOrCreatePluginContainer } from "../src/plugin/runtime-state.js";
import { resolvePluginConfig } from "../src/config/loader.js";

type EmbeddedRunResult = {
  payloads?: Array<{ text?: string }>;
  meta?: { durationMs?: number; error?: { message?: string } };
};

type OpenClawExtensionApi = {
  runEmbeddedPiAgent: (params: Record<string, unknown>) => Promise<EmbeddedRunResult>;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = path.join(repoRoot, ".openclaw-plugin-test");
const openclawHome = path.join(testRoot, "openclaw-home");
const workspaceDir = path.join(testRoot, "workspace");
const agentDir = path.join(testRoot, "agent");
const sessionDir = path.join(testRoot, "sessions");

await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(workspaceDir, { recursive: true });
await fs.mkdir(agentDir, { recursive: true });
await fs.mkdir(sessionDir, { recursive: true });
await fs.writeFile(
  path.join(workspaceDir, "README.md"),
  [
    "# Plugin Smoke Workspace",
    "",
    "This file exists to exercise OpenClaw tool execution and force compaction savings.",
    "",
    "Sections:",
    "- runtime",
    "- memory",
    "- compression",
    "",
    "Details:",
    "OpenClaw Recall stores structured memory, compressed tool output, and prompt profiles.",
    "The integration smoke test deliberately reads a longer file so the plugin has a meaningful payload to compact.",
    "The file also repeats a few concepts: persistent memory, cross-session retrieval, prompt budgeting, context trimming, and inspectable profiling.",
    "Persistent memory matters because the model otherwise forgets stable user preferences across sessions.",
    "Context compression matters because raw tool output and long transcripts create token waste.",
    "Profile metrics matter because operators need to see prompt size, retrieval count, trim events, and tool savings.",
    "This paragraph is intentionally longer than the final compact summary should be, so the saved token count is non-zero.",
  ].join("\n"),
  "utf8",
);
await fs.writeFile(
  path.join(agentDir, "AGENTS.md"),
  "# Agent\nUse concise Chinese replies.\n",
  "utf8",
);

process.env.OPENCLAW_HOME = openclawHome;
process.env.OPENCLAW_RUNNER_LOG = "0";

const mock = installOpenAiResponsesMock();
const api = await importOpenClaw();

try {
  const common = {
    workspaceDir,
    agentDir,
    config: buildConfig(repoRoot),
    provider: "openai",
    model: "gpt-4.1-mini",
    timeoutMs: 10_000,
    trigger: "user",
    messageChannel: "cli",
  };

  await run(api, {
    ...common,
    sessionId: "plugin-smoke-1",
    sessionKey: "plugin:smoke:1",
    runId: "plugin-smoke-run-1",
    sessionFile: path.join(sessionDir, "plugin-smoke-1.jsonl"),
    prompt: "以后默认叫我 Felix，用中文回答，并且尽量简洁。",
  });

  const recall = await run(api, {
    ...common,
    sessionId: "plugin-smoke-2",
    sessionKey: "plugin:smoke:2",
    runId: "plugin-smoke-run-2",
    sessionFile: path.join(sessionDir, "plugin-smoke-2.jsonl"),
    prompt: "你记得我的偏好吗？",
  });

  const tools = await run(api, {
    ...common,
    sessionId: "plugin-smoke-3",
    sessionKey: "plugin:smoke:3",
    runId: "plugin-smoke-run-3",
    sessionFile: path.join(sessionDir, "plugin-smoke-3.jsonl"),
    prompt: 'read "README.md"',
  });

  const container = getOrCreatePluginContainer({
    config: resolvePluginConfig({ env: process.env }),
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  });

  const memories = await container.memoryStore.listActive();
  const explained = await container.memoryRetriever.explain("你记得我的偏好吗？", 8, {
    sessionId: "plugin-smoke-2",
  });
  const profiles = await container.profileStore.list(10);
  const latestProfile = profiles[0] ?? null;
  const toolResults = await container.toolOutputStore.listSession("plugin-smoke-3", 10);

  assert(memories.some((memory) => /Chinese|中文|concise|简洁/i.test(memory.summary)), "expected preference memory to be written");
  assert(explained.some((memory) => /preference/i.test(memory.kind)), "expected preference memory to be retrieved");
  assert.match(recall.payloads?.map((payload) => payload.text).join("\n") ?? "", /Felix|中文|简洁/i, "expected recall reply to surface restored stable preferences");
  assert(!/TASK STATE|RELEVANT MEMORY|COMPRESSED TOOL OUTPUT|OLDER HISTORY SUMMARY|RECENT TURNS/i.test(recall.payloads?.map((payload) => payload.text).join("\n") ?? ""), "expected recall reply to stay free of scaffold leakage");
  assert(profiles.length >= 2, "expected prompt profiles to be recorded");
  assert.equal(latestProfile?.promptTokensSource, "exact", "expected provider usage to produce exact prompt token counts");
  assert.equal(latestProfile?.compressionSavingsSource, "estimated", "expected compression savings to remain estimated");
  assert(toolResults.length >= 1, "expected tool compaction output to be stored");
  assert(toolResults.some((result) => (result.savedTokens ?? 0) > 0), "expected tool compaction to save tokens");

  process.stdout.write(
    `${JSON.stringify(
      {
        recallReply: recall.payloads?.map((payload) => payload.text).join("\n") ?? "",
        toolReply: tools.payloads?.map((payload) => payload.text).join("\n") ?? "",
        memoryCount: memories.length,
        profileCount: profiles.length,
        toolCompactions: toolResults.length,
        latestProfile,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  mock.restore();
}

async function run(
  api: OpenClawExtensionApi,
  params: Record<string, unknown>,
): Promise<EmbeddedRunResult> {
  return await api.runEmbeddedPiAgent(params);
}

function buildConfig(pluginPath: string): Record<string, unknown> {
  return {
    models: {
      providers: {
        openai: {
          baseUrl: "https://api.openai.com/v1",
          api: "openai-responses",
          apiKey: "sk-openclaw-recall-mock",
          models: [
            {
              id: "gpt-4.1-mini",
              name: "gpt-4.1-mini",
              api: "openai-responses",
              reasoning: true,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 4096,
            },
          ],
        },
      },
    },
    plugins: {
      enabled: true,
      load: { paths: [pluginPath] },
      allow: ["openclaw-recall"],
      entries: {
        "openclaw-recall": {
          enabled: true,
          hooks: { allowPromptInjection: true },
          config: {},
        },
      },
    },
  };
}

async function importOpenClaw(): Promise<OpenClawExtensionApi> {
  const modulePath = path.join(repoRoot, "node_modules", "openclaw", "dist", "extensionAPI.js");
  const importer = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<OpenClawExtensionApi>;
  return await importer(pathToFileURL(modulePath).href);
}
