import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installOpenAiResponsesMock } from "../src/testing/mockOpenAIResponses.js";

type EmbeddedRunResult = {
  payloads?: Array<{ text?: string }>;
};

type OpenClawExtensionApi = {
  runEmbeddedPiAgent: (params: Record<string, unknown>) => Promise<EmbeddedRunResult>;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = path.join(repoRoot, ".openclaw-tarball-test");
const consumerDir = path.join(testRoot, "consumer");
const openclawHome = path.join(testRoot, "openclaw-home");
const workspaceDir = path.join(testRoot, "workspace");
const agentDir = path.join(testRoot, "agent");
const sessionDir = path.join(testRoot, "sessions");
const configDir = path.join(openclawHome, ".openclaw");
const configPath = path.join(configDir, "openclaw.json");
const tarballPath = findLatestTarball(path.join(repoRoot, ".release"));
const openclawVersion = readOpenClawVersion();

await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(consumerDir, { recursive: true });
await fs.mkdir(workspaceDir, { recursive: true });
await fs.mkdir(agentDir, { recursive: true });
await fs.mkdir(sessionDir, { recursive: true });
await fs.writeFile(
  path.join(workspaceDir, "README.md"),
  [
    "# Tarball Smoke Workspace",
    "",
    "This workspace exists to prove the published tarball works without relying on the source checkout.",
    "It should trigger memory write, cross-session recall, tool compaction, and profile persistence.",
    "This paragraph is intentionally verbose so compacted tool output has measurable savings.",
  ].join("\n"),
  "utf8",
);
await fs.writeFile(path.join(agentDir, "AGENTS.md"), "# Agent\nUse concise Chinese replies.\n", "utf8");

exec("npm", ["init", "-y"], consumerDir);
exec("npm", ["install", tarballPath, `openclaw@${openclawVersion}`], consumerDir);

const installedPluginDir = path.join(consumerDir, "node_modules", "@felix201209", "openclaw-recall");
runOpenClaw(["plugins", "install", "--link", installedPluginDir], openclawHome, consumerDir);
runOpenClaw(["plugins", "info", "openclaw-recall"], openclawHome, consumerDir);

process.env.OPENCLAW_HOME = openclawHome;
process.env.OPENCLAW_RUNNER_LOG = "0";

const installedConfig = JSON.parse(await fs.readFile(configPath, "utf8")) as Record<string, unknown>;
const mock = installOpenAiResponsesMock();
const api = await importInstalledOpenClaw(consumerDir);

try {
  const common = {
    workspaceDir,
    agentDir,
    config: withModelConfig(installedConfig),
    provider: "openai",
    model: "gpt-4.1-mini",
    timeoutMs: 10_000,
    trigger: "user",
    messageChannel: "cli",
  };

  await run(api, {
    ...common,
    sessionId: "tarball-smoke-1",
    sessionKey: "plugin:tarball:1",
    runId: "plugin-tarball-run-1",
    sessionFile: path.join(sessionDir, "tarball-smoke-1.jsonl"),
    prompt: "以后默认叫我 Felix，用中文回答，并且尽量简洁。",
  });

  const recall = await run(api, {
    ...common,
    sessionId: "tarball-smoke-2",
    sessionKey: "plugin:tarball:2",
    runId: "plugin-tarball-run-2",
    sessionFile: path.join(sessionDir, "tarball-smoke-2.jsonl"),
    prompt: "你记得我的偏好吗？",
  });

  await run(api, {
    ...common,
    sessionId: "tarball-smoke-3",
    sessionKey: "plugin:tarball:3",
    runId: "plugin-tarball-run-3",
    sessionFile: path.join(sessionDir, "tarball-smoke-3.jsonl"),
    prompt: 'read "README.md"',
  });

  const memoryList = JSON.parse(
    execInstalledCli(["memory", "list", "--json"], consumerDir, openclawHome),
  ) as Array<{ summary?: string }>;
  const profileList = JSON.parse(
    execInstalledCli(["profile", "list", "--json"], consumerDir, openclawHome),
  ) as Array<Record<string, unknown>>;
  const latestProfile = profileList[0] ?? null;
  const sessionInspect = JSON.parse(
    execInstalledCli(["session", "inspect", "tarball-smoke-3", "--json"], consumerDir, openclawHome),
  ) as { toolResults?: Array<{ savedTokens?: number }> };
  const doctor = JSON.parse(
    execInstalledCli(["doctor", "--json"], consumerDir, openclawHome),
  ) as { checks?: Array<{ status?: string }> };
  const status = JSON.parse(
    execInstalledCli(["status", "--json"], consumerDir, openclawHome),
  ) as { enabled?: boolean; profileCount?: number; memoryCount?: number };

  assert(memoryList.length >= 2, "expected tarball install to persist memories");
  assert(
    memoryList.some((memory) => /Felix|Chinese|concise/i.test(String(memory.summary ?? ""))),
    "expected tarball install to preserve stable user preferences in memory store",
  );
  assert(profileList.length >= 2, "expected tarball install to record profiles");
  assert.equal(
    latestProfile?.promptTokensSource,
    "exact",
    "expected installed tarball to record exact prompt token counts when provider usage is available",
  );
  assert(
    (sessionInspect.toolResults ?? []).some((result) => (result.savedTokens ?? 0) > 0),
    "expected tarball install to record tool compaction savings",
  );
  assert(
    (doctor.checks ?? []).every((check) => check.status !== "fail"),
    "expected doctor checks to avoid fail status for tarball install",
  );
  assert.equal(status.enabled, true);

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        tarball: tarballPath,
        installedPluginDir,
        memoryCount: memoryList.length,
        profileCount: profileList.length,
        toolCompactions: (sessionInspect.toolResults ?? []).length,
        latestProfile,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  mock.restore();
}

function exec(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      OPENCLAW_RUNNER_LOG: "0",
    },
  });
}

function runOpenClaw(args: string[], home: string, cwd: string): void {
  execFileSync(
    "node",
    [path.join(cwd, "node_modules", "openclaw", "openclaw.mjs"), ...args],
    {
      cwd,
      stdio: "pipe",
      env: {
        ...process.env,
        OPENCLAW_HOME: home,
        OPENCLAW_RUNNER_LOG: "0",
      },
    },
  );
}

function execInstalledCli(args: string[], cwd: string, home: string): string {
  return execFileSync(path.join(cwd, "node_modules", ".bin", "openclaw-recall"), args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    env: {
      ...process.env,
      OPENCLAW_HOME: home,
      OPENCLAW_RUNNER_LOG: "0",
    },
  });
}

function withModelConfig(installedConfig: Record<string, unknown>): Record<string, unknown> {
  const plugins = (installedConfig.plugins ?? {}) as Record<string, unknown>;
  return {
    ...installedConfig,
    plugins: {
      ...plugins,
      allow: ["openclaw-recall"],
    },
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
  };
}

async function run(
  api: OpenClawExtensionApi,
  params: Record<string, unknown>,
): Promise<EmbeddedRunResult> {
  return await api.runEmbeddedPiAgent(params);
}

async function importInstalledOpenClaw(cwd: string): Promise<OpenClawExtensionApi> {
  const modulePath = path.join(cwd, "node_modules", "openclaw", "dist", "extensionAPI.js");
  const importer = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<OpenClawExtensionApi>;
  return await importer(pathToFileURL(modulePath).href);
}

function findLatestTarball(releaseDir: string): string {
  const entries = execFileSync("bash", ["-lc", `ls -1t "${releaseDir}"/*.tgz | head -n 1`], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  assert(entries.length > 0, `no tarball found in ${releaseDir}`);
  return entries[0];
}

function readOpenClawVersion(): string {
  const packageJson = JSON.parse(
    execFileSync("node", ["-p", "JSON.stringify(require('./package.json').devDependencies)"], {
      cwd: repoRoot,
      encoding: "utf8",
    }),
  ) as Record<string, string>;
  return packageJson.openclaw ?? "^2026.3.13";
}
