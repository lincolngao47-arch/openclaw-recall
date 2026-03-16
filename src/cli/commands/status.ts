import { Command } from "commander";
import { addJsonFlag, createCliContainer, pluginConfigSources, printOutput } from "../shared.js";
import { readJsonFile } from "../../shared/fileStore.js";
import { explainSuppression } from "../../memory/MemoryRanker.js";
import type { MaintenanceReport, PruneReport } from "../../types/domain.js";

export function registerStatusCommands(program: Command): void {
  addJsonFlag(
    program.command("status").description("Show plugin status").action(async function action() {
      const { container, resolved, enabled, openclawHome, identity, importService, exportService, pluginPaths } =
        await createCliContainer();
      const memories = await container.memoryStore.listActive();
      const profiles = await container.profileStore.list(5);
      const sessions = await container.eventStore.listSessions(5);
      const latestProfile = profiles[0] ?? null;
      const latestImport = await importService.status();
      const latestExport = await exportService.latest();
      const latestPrune = await readJsonFile<PruneReport | null>(pluginPaths.latestPrunePath, null);
      const latestReindex = await readJsonFile<MaintenanceReport | null>(pluginPaths.latestReindexPath, null);
      const latestCompact = await readJsonFile<MaintenanceReport | null>(pluginPaths.latestCompactPath, null);
      const identityStatus = identity.status();
      const backendHealth = await container.memoryStore.pingBackend();
      const memorySpaces = await container.memoryStore.listMemorySpaces();
      const hygiene = await container.memoryStore.hygieneSummary();
      const noisyCandidates = memories
        .map((memory) => ({ id: memory.id, reasons: explainSuppression(memory) }))
        .filter((entry) => entry.reasons.length > 0);
      const scopeCounts = memories.reduce<Record<string, number>>((summary, memory) => {
        const key = memory.scope ?? "private";
        summary[key] = (summary[key] ?? 0) + 1;
        return summary;
      }, {});
      printOutput(this, {
        enabled,
        mode: identityStatus.mode,
        identity: identityStatus,
        backendHealth,
        backendType: resolved.identity.backendType,
        memorySpaceId: resolved.identity.memorySpaceId ?? identityStatus.memorySpaceId ?? null,
        availableMemorySpaces: memorySpaces.map((space) => ({
          id: space.id,
          backend: space.backend,
          memoryCount: space.memoryCount,
          updatedAt: space.updatedAt ?? null,
        })),
        retrievalMode: resolved.retrieval.mode,
        autoWriteEnabled: resolved.memory.autoWrite,
        openclawHome,
        databasePath: container.database.path,
        embeddingProvider: resolved.embedding.provider,
        embeddingAvailability: container.memoryRetriever.embeddingAvailability(),
        inspectPath: resolved.inspect.httpPath,
        configSources: pluginConfigSources(),
        memoryCount: memories.length,
        profileCount: profiles.length,
        sessionCount: sessions.length,
        lastHookExecutionAt: latestProfile?.createdAt ?? sessions[0]?.updatedAt ?? null,
        recentRetrievalCount: latestProfile?.retrievalCount ?? 0,
        recentRetrievalMode: latestProfile?.retrievalMode ?? resolved.retrieval.mode,
        recentKeywordContribution: latestProfile?.keywordContribution ?? 0,
        recentSemanticContribution: latestProfile?.semanticContribution ?? 0,
        recentCompressionSavings: latestProfile?.compressionSavings ?? 0,
        recentMemoryWrites: latestProfile?.memoryWritten ?? 0,
        lastImportTime: latestImport?.completedAt ?? null,
        recentImportStats: latestImport
          ? {
              imported: latestImport.imported,
              skippedDuplicates: latestImport.skippedDuplicates,
              rejectedNoise: latestImport.rejectedNoise,
              scopeCounts: latestImport.scopeCounts ?? {},
            }
          : null,
        lastExportPath: latestExport?.outputPath ?? null,
        lastPrune: latestPrune,
        lastReindex: latestReindex,
        lastCompact: latestCompact,
        hygiene,
        noisyActiveMemoryCount: noisyCandidates.length,
        scopeCounts,
        lastRecoveryWarning: identityStatus.warnings[0] ?? null,
        lastError:
          typeof latestProfile?.details?.error === "string" ? latestProfile.details.error : null,
        latestSession: sessions[0] ?? null,
        latestProfile,
      });
    }),
  );
}
