import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
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
const testRoot = path.join(repoRoot, ".openclaw-remote-roundtrip");
const releaseDir = path.join(repoRoot, ".release");
const tarballPath = findLatestTarball(releaseDir);
const openclawVersion = readOpenClawVersion();

await main();
process.exit(0);

async function main(): Promise<void> {
  await fs.rm(testRoot, { recursive: true, force: true });
  const backendDir = path.join(testRoot, "backend");
  const backendPort = 45479;
  const server = startBackendServer(backendDir, backendPort, "roundtrip-token");
  await waitForHealth(`http://127.0.0.1:${backendPort}/health`, "roundtrip-token");

  try {
    const endpoint = `http://127.0.0.1:${backendPort}`;
    const first = await createConsumer("first", endpoint);
    const second = await createConsumer("second", endpoint);
    const mock = installOpenAiResponsesMock();
    try {
      const api1 = await importInstalledOpenClaw(first.consumerDir);
      const api2 = await importInstalledOpenClaw(second.consumerDir);

      await run(api1, {
        ...first.common,
        sessionId: "remote-1",
        sessionKey: "remote:1",
        runId: "remote-run-1",
        sessionFile: path.join(first.sessionDir, "remote-1.jsonl"),
        prompt: "以后默认叫我 Felix，用中文回答，并且尽量简洁。",
      });
      await run(api1, {
        ...first.common,
        sessionId: "remote-2",
        sessionKey: "remote:2",
        runId: "remote-run-2",
        sessionFile: path.join(first.sessionDir, "remote-2.jsonl"),
        prompt: "项目上下文：Recall v1.1 主要聚焦 backend、scope 和 import quality。",
      });

      const memoryExport = JSON.parse(
        execInstalledCli(["export", "memory", "--json"], first.consumerDir, first.openclawHome),
      ) as { outputPath: string };

      execInstalledCli(
        [
          "import",
          "run",
          memoryExport.outputPath,
          "--json",
        ],
        second.consumerDir,
        second.openclawHome,
      );

      const recall = await run(api2, {
        ...second.common,
        sessionId: "remote-3",
        sessionKey: "remote:3",
        runId: "remote-run-3",
        sessionFile: path.join(second.sessionDir, "remote-3.jsonl"),
        prompt: "你记得我的偏好和当前项目重点吗？",
      });

      const doctor = JSON.parse(execInstalledCli(["doctor", "--json"], second.consumerDir, second.openclawHome)) as {
        checks?: Array<{ name?: string; status?: string; detail?: string }>;
      };
      const status = JSON.parse(execInstalledCli(["status", "--json"], second.consumerDir, second.openclawHome)) as Record<string, unknown>;
      const explain = JSON.parse(
        execInstalledCli(["memory", "explain", "Felix 中文 backend import quality", "--json"], second.consumerDir, second.openclawHome),
      ) as Record<string, unknown>;
      const memoryList = JSON.parse(
        execInstalledCli(["memory", "list", "--json"], second.consumerDir, second.openclawHome),
      ) as Array<Record<string, unknown>>;
      const recallReply = extractText(recall);

      assert((doctor.checks ?? []).every((check) => check.status !== "fail"));
      assert.equal(status["backendType"], "recall-http");
      assert.equal(status["memorySpaceId"], "shared-space");
      assert.ok((status["memoryCount"] as number) >= 2);
      assert.ok(Array.isArray(status["availableMemorySpaces"]));
      assert.ok(Array.isArray(memoryList) && memoryList.length >= 2);
      assert.equal((memoryList[0].scope === "private" || memoryList[0].scope === "workspace" || memoryList[0].scope === "shared" || memoryList[0].scope === "session"), true);
      assert.equal(explain["retrievalMode"], "hybrid");
      assert.match(recallReply, /Felix|中文|简洁|backend|scope|import quality|项目重点/i);
      assert.doesNotMatch(recallReply, /没有检索到稳定记忆/);

      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            tarball: tarballPath,
            endpoint,
            recallReply,
            memoryCount: status["memoryCount"],
            backendType: status["backendType"],
            memorySpaceId: status["memorySpaceId"],
            availableMemorySpaces: status["availableMemorySpaces"],
            importStats: status["recentImportStats"],
            hygiene: status["hygiene"],
          },
          null,
          2,
        )}\n`,
      );
    } finally {
      mock.restore();
    }
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await stopBackendServer(server);
  }
}

async function createConsumer(name: string, endpoint: string) {
  const root = path.join(testRoot, name);
  const consumerDir = path.join(root, "consumer");
  const openclawHome = path.join(root, "openclaw-home");
  const workspaceDir = path.join(root, "workspace");
  const agentDir = path.join(root, "agent");
  const sessionDir = path.join(root, "sessions");
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(consumerDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(agentDir, { recursive: true });
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(path.join(workspaceDir, "README.md"), "# Remote Roundtrip\n\nbackend scope import quality\n", "utf8");
  await fs.writeFile(path.join(agentDir, "AGENTS.md"), "# Agent\nUse concise Chinese replies.\n", "utf8");

  exec("npm", ["init", "-y"], consumerDir);
  exec("npm", ["install", tarballPath, `openclaw@${openclawVersion}`], consumerDir);
  const installedPluginDir = path.join(consumerDir, "node_modules", "@felix201209", "openclaw-recall");
  runOpenClaw(["plugins", "install", "--link", installedPluginDir], openclawHome, consumerDir);
  execInstalledCli(
    [
      "config",
      "init",
      "--mode",
      "reconnect",
      "--backend-type",
      "recall-http",
      "--endpoint",
      endpoint,
      "--memory-space",
      "shared-space",
      "--identity-key",
      "team-alpha-key",
      "--api-key",
      "roundtrip-token",
      "--workspace-scope",
      "workspace-alpha",
      "--shared-scope",
      "team-alpha",
      "--user-scope",
      name,
      "--write-openclaw",
    ],
    consumerDir,
    openclawHome,
  );
  runOpenClaw(["plugins", "info", "openclaw-recall"], openclawHome, consumerDir);

  const configPath = path.join(openclawHome, ".openclaw", "openclaw.json");
  const installedConfig = JSON.parse(await fs.readFile(configPath, "utf8")) as Record<string, unknown>;
  return {
    consumerDir,
    openclawHome,
    workspaceDir,
    sessionDir,
    common: {
      openclawHome,
      workspaceDir,
      agentDir,
      config: withModelConfig(installedConfig),
      provider: "openai",
      model: "gpt-4.1-mini",
      timeoutMs: 10_000,
      trigger: "user",
      messageChannel: "cli",
    },
  };
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
  execFileSync("node", [path.join(cwd, "node_modules", "openclaw", "openclaw.mjs"), ...args], {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      OPENCLAW_HOME: home,
      OPENCLAW_RUNNER_LOG: "0",
    },
  });
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
  const home = typeof params.openclawHome === "string" ? params.openclawHome : undefined;
  const previousHome = process.env.OPENCLAW_HOME;
  if (home) {
    process.env.OPENCLAW_HOME = home;
  }
  try {
    return await api.runEmbeddedPiAgent(params);
  } finally {
    if (home) {
      if (previousHome) {
        process.env.OPENCLAW_HOME = previousHome;
      } else {
        delete process.env.OPENCLAW_HOME;
      }
    }
  }
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
  const version = packageJson.openclaw;
  assert(version, "missing openclaw devDependency");
  return version.replace(/^[^\d]*/, "");
}

function extractText(result: EmbeddedRunResult): string {
  return (result.payloads ?? []).map((item) => item.text ?? "").join("\n").trim();
}

function startBackendServer(dataDir: string, port: number, apiKey: string): ChildProcess {
  return spawn(
    "node",
    [path.join(repoRoot, "dist", "src", "cli", "index.js"), "backend", "serve", "--port", String(port), "--data-dir", dataDir, "--api-key", apiKey],
    {
      cwd: repoRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        OPENCLAW_RUNNER_LOG: "0",
      },
    },
  );
}

async function stopBackendServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null || server.killed) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      server.kill("SIGKILL");
    }, 2_000);
    server.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    server.kill("SIGTERM");
  });
}

async function waitForHealth(url: string, apiKey: string, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the backend comes up.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for recall-http backend at ${url}`);
}
