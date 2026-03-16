import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { addJsonFlag, createCliContainer, printOutput } from "../shared.js";
import type { DoctorReport } from "../../types/domain.js";
import { listPluginEnvOverrides } from "../../config/loader.js";
import { validateResolvedConfig } from "../../config/validation.js";
import { resolvePluginPaths } from "../../storage/paths.js";
import { readJsonFile } from "../../shared/fileStore.js";
import { explainSuppression } from "../../memory/MemoryRanker.js";
import type { PruneReport } from "../../types/domain.js";

export function registerDoctorCommands(program: Command): void {
  addJsonFlag(
    program.command("doctor").description("Run plugin diagnostics").action(async function action() {
      const { container, resolved, enabled, configPath, configExists, openclawHome, identity, importService, exportService } =
        await createCliContainer();
      const profiles = await container.profileStore.list(5);
      const sessions = await container.eventStore.listSessions(5);
      const memories = await container.memoryStore.listActive();
      const identityStatus = identity.status();
      const validation = validateResolvedConfig(resolved, ["plugins.entries.openclaw-recall.config", "defaults"]);
      const latestImport = await importService.status();
      const latestExport = await exportService.latest();
      const pluginPaths = resolvePluginPaths();
      const latestProfile = profiles[0] ?? null;
      const toolResults = sessions[0]
        ? await container.toolOutputStore.listSession(sessions[0].sessionId, 10)
        : [];
      const packageRoot = resolvePackageRoot();
      const packageJson = await readJson(path.join(packageRoot, "package.json"));
      const pluginManifest = await readJson(path.join(packageRoot, "openclaw.plugin.json"));
      const buildIntegrity =
        fs.existsSync(path.join(packageRoot, "dist", "src", "plugin", "index.js")) &&
        fs.existsSync(path.join(packageRoot, "dist", "src", "cli", "index.js"));
      const manifestValid =
        packageJson?.name === "@felix201209/openclaw-recall" &&
        pluginManifest?.id === "openclaw-recall" &&
        typeof packageJson?.version === "string" &&
        packageJson.version === pluginManifest?.version;
      const writable = await isWritable(path.dirname(container.database.path));
      const sqliteHealthy = isSqliteHealthy(container.database);
      const envOverrides = listPluginEnvOverrides();
      const latestPrune = await readJsonFile<PruneReport | null>(pluginPaths.latestPrunePath, null);
      const noisyActiveMemories = memories.filter((memory) => explainSuppression(memory).length > 0);
      const promptLayers = Array.isArray(latestProfile?.details?.promptLayers)
        ? (latestProfile?.details?.promptLayers as Array<Record<string, unknown>>)
        : [];
      const hasCompressionLayer = promptLayers.some(
        (layer) => layer.name === "OLDER HISTORY SUMMARY" || layer.name === "COMPRESSED TOOL OUTPUT",
      );
      const report: DoctorReport = {
        generatedAt: new Date().toISOString(),
        dataDir: resolved.storageDir,
        databasePath: container.database.path,
        openclawHome,
        checks: [
          {
            name: "openclaw config",
            status: configExists ? "pass" : "warn",
            detail: configExists ? `Found ${configPath}` : `No config found at ${configPath}`,
          },
          {
            name: "plugin manifest",
            status: manifestValid ? "pass" : "fail",
            detail: manifestValid
              ? `package.json and openclaw.plugin.json agree on id/version (${packageJson?.version ?? "unknown"})`
              : "Package manifest and plugin manifest are missing or inconsistent",
          },
          {
            name: "build integrity",
            status: buildIntegrity ? "pass" : "fail",
            detail: buildIntegrity
              ? "Built plugin and CLI entrypoints are present in dist/"
              : "Missing dist plugin or CLI entrypoint; run npm run build",
          },
          {
            name: "plugin enabled",
            status: enabled ? "pass" : "warn",
            detail: enabled
              ? "plugins.entries.openclaw-recall.enabled is active or defaults to true"
              : "Plugin entry is disabled in OpenClaw config",
          },
          {
            name: "config parse",
            status: validation.valid ? "pass" : "warn",
            detail: `Resolved plugin config from ${configExists ? configPath : "defaults/env only"} (${validation.issues.length} issues)`,
          },
          {
            name: "identity / backend",
            status: identityStatus.reconnectReady ? "pass" : identityStatus.mode === "local" ? "pass" : "warn",
            detail: `mode=${identityStatus.mode}, backend=${identityStatus.backendType}, configured=${identityStatus.configured}, reachability=${identityStatus.reachability}`,
          },
          {
            name: "env/config precedence",
            status: envOverrides.length > 0 ? "warn" : "pass",
            detail:
              envOverrides.length > 0
                ? `Environment overrides active: ${envOverrides.join(", ")}`
                : "No env overrides detected; config comes from openclaw.json + defaults",
          },
          {
            name: "database path",
            status:
              fs.existsSync(container.database.path) && sqliteHealthy && writable ? "pass" : "warn",
            detail: `${container.database.path} (sqlite=${sqliteHealthy ? "ok" : "check failed"}, writable=${writable})`,
          },
          {
            name: "import system",
            status: resolved.imports.enabled ? "pass" : "warn",
            detail: latestImport
              ? `enabled=${resolved.imports.enabled}, latest=${latestImport.status}, imported=${latestImport.imported}, rejected=${latestImport.rejectedNoise}`
              : `enabled=${resolved.imports.enabled}, no import job recorded yet`,
          },
          {
            name: "export / backup",
            status: fs.existsSync(pluginPaths.pluginRoot) && (await isWritable(path.resolve(pluginPaths.pluginRoot, resolved.exports.directory)))
              ? "pass"
              : "warn",
            detail: latestExport
              ? `latest=${latestExport.outputPath}`
              : `export directory=${path.resolve(pluginPaths.pluginRoot, resolved.exports.directory)}`,
          },
          {
            name: "embedding provider",
            status:
              resolved.embedding.provider === "local" ||
              Boolean(resolved.embedding.apiKey?.trim())
                ? "pass"
                : "warn",
            detail:
              resolved.embedding.provider === "local"
                ? "Local hashed embeddings enabled"
                : "OpenAI-compatible embeddings selected but no API key detected",
          },
          {
            name: "inspect route",
            status: resolved.inspect.httpPath.startsWith("/plugins/") ? "pass" : "warn",
            detail: resolved.inspect.httpPath,
          },
          {
            name: "recent hook activity",
            status: latestProfile || sessions[0] ? "pass" : "warn",
            detail: latestProfile?.createdAt ?? sessions[0]?.updatedAt ?? "No recorded runs yet",
          },
          {
            name: "memory pipeline",
            status:
              resolved.memory.autoWrite === false
                ? "warn"
                : memories.length > 0 || (latestProfile?.memoryWritten ?? 0) > 0
                  ? "pass"
                  : "warn",
            detail:
              resolved.memory.autoWrite === false
                ? "Automatic memory writes are disabled by config"
                : memories.length > 0
                  ? `${memories.length} active memories stored`
                  : "No memory writes recorded yet",
          },
          {
            name: "memory hygiene",
            status:
              noisyActiveMemories.length === 0
                ? "pass"
                : latestPrune?.dryRun === false && (latestPrune.pruned ?? 0) > 0
                  ? "warn"
                  : "warn",
            detail:
              noisyActiveMemories.length === 0
                ? "No active memories currently match suppression rules"
                : latestPrune
                  ? `Detected ${noisyActiveMemories.length} active noisy memories; latest prune=${latestPrune.createdAt} (dryRun=${latestPrune.dryRun}, pruned=${latestPrune.pruned})`
                  : `Detected ${noisyActiveMemories.length} active noisy memories; run \`openclaw-recall memory prune-noise --dry-run\` first`,
          },
          {
            name: "retrieval pipeline",
            status: (latestProfile?.retrievalCount ?? 0) > 0 ? "pass" : "warn",
            detail:
              (latestProfile?.retrievalCount ?? 0) > 0
                ? `Latest run retrieved ${latestProfile?.retrievalCount} memories`
                : "No retrieval activity recorded yet",
          },
          {
            name: "compression pipeline",
            status:
              (latestProfile?.compressionSavings ?? 0) > 0 || hasCompressionLayer ? "pass" : "warn",
            detail:
              latestProfile
                ? `Latest savings=${latestProfile.compressionSavings} (${latestProfile.compressionSavingsSource}), layers=${promptLayers.length}`
                : "No compression profile recorded yet",
          },
          {
            name: "tool compaction",
            status: toolResults.length > 0 ? "pass" : "warn",
            detail:
              toolResults.length > 0
                ? `Recent session has ${toolResults.length} compacted tool outputs`
                : "No compacted tool outputs recorded yet",
          },
          {
            name: "profile path",
            status: latestProfile ? "pass" : "warn",
            detail: latestProfile
              ? `Latest profile=${latestProfile.runId}, prompt=${latestProfile.promptTokens} (${latestProfile.promptTokensSource})`
              : "No prompt profiles recorded yet",
          },
          {
            name: "recovery path",
            status: latestExport ? "pass" : "warn",
            detail: latestExport
              ? "Export exists; recovery can start from the latest export and config identity."
              : "Run `openclaw-recall export memory` after import so you have a restorable backup.",
          },
        ],
      };
      printOutput(this, report);
    }),
  );
}

function resolvePackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fsPromises.readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function isWritable(dirPath: string): Promise<boolean> {
  try {
    await fsPromises.mkdir(dirPath, { recursive: true });
    const probe = path.join(dirPath, ".write-test");
    await fsPromises.writeFile(probe, "ok");
    await fsPromises.rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

function isSqliteHealthy(database: { connection: { prepare: (sql: string) => { get: () => unknown } } }): boolean {
  try {
    database.connection.prepare("SELECT 1 AS ok").get();
    return true;
  } catch {
    return false;
  }
}
