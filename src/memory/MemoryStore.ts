import { EmbeddingProvider } from "./EmbeddingProvider.js";
import { PluginDatabase } from "../storage/PluginDatabase.js";
import { shouldSuppressMemory } from "../shared/safety.js";
import { MemoryRecord } from "../types/domain.js";
import type { ResolvedPluginConfig } from "../config/schema.js";
import { CloudBackend } from "../backend/CloudBackend.js";
import { LocalBackend } from "../backend/LocalBackend.js";
import type {
  MemoryBackend,
  MemoryDeleteResult,
  MemoryPruneResult,
  MemorySpaceSummary,
  MemoryWriteResult,
} from "../backend/MemoryBackend.js";
import { ReconnectBackend } from "../backend/ReconnectBackend.js";
import {
  analyzeMemoryHygiene,
  buildCompactedMemory,
  buildReindexedMemory,
  effectiveImportance,
  explainLifecycleSuppression,
  isRetrievalEligible,
  type HygieneSummary,
} from "./hygiene.js";

export class MemoryStore {
  private readonly backend: MemoryBackend;

  constructor(
    database: PluginDatabase,
    embeddings: EmbeddingProvider,
    dedupeSimilarity: number,
    private readonly config?: ResolvedPluginConfig,
  ) {
    this.backend = createMemoryBackend(database, embeddings, dedupeSimilarity, config);
  }

  async listAll(): Promise<MemoryRecord[]> {
    return await this.backend.listAllMemory();
  }

  async listActive(): Promise<MemoryRecord[]> {
    return await this.backend.listActive();
  }

  async search(query?: string): Promise<MemoryRecord[]> {
    const memories = await this.backend.searchMemory(query);
    return memories
      .filter((memory) => isRetrievalEligible(memory))
      .filter((memory) => !shouldSuppressMemory(memory));
  }

  async listRetrievable(): Promise<MemoryRecord[]> {
    return (await this.listActive())
      .filter((memory) => isRetrievalEligible(memory))
      .filter((memory) => !shouldSuppressMemory(memory));
  }

  async getById(id: string): Promise<MemoryRecord | null> {
    return await this.backend.getMemory(id);
  }

  async listBySession(sessionId: string, limit = 25): Promise<MemoryRecord[]> {
    return await this.backend.listBySession(sessionId, limit);
  }

  async listBootCandidates(sessionId: string, limit = 8): Promise<MemoryRecord[]> {
    const memories = await this.listActive();
    return memories
      .filter((memory) => !shouldSuppressMemory(memory))
      .filter((memory) => isRetrievalEligible(memory))
      .filter((memory) =>
        memory.kind === "preference" ||
        memory.kind === "semantic" ||
        (memory.kind === "session_state" && memory.sourceSessionId === sessionId),
      )
      .sort((left, right) => {
        const leftBoost = left.kind === "preference" ? 3 : left.kind === "semantic" ? 2 : 1;
        const rightBoost = right.kind === "preference" ? 3 : right.kind === "semantic" ? 2 : 1;
        return effectiveImportance(right) + rightBoost - (effectiveImportance(left) + leftBoost);
      })
      .slice(0, limit);
  }

  async pruneNoise(options?: { dryRun?: boolean }): Promise<MemoryPruneResult> {
    return await this.backend.pruneNoise(options?.dryRun === true);
  }

  async upsertMany(candidates: MemoryRecord[]): Promise<MemoryWriteResult> {
    return await this.backend.writeMemory(candidates);
  }

  async updateMemory(id: string, patch: Partial<MemoryRecord>): Promise<MemoryRecord | null> {
    return await this.backend.updateMemory(id, patch);
  }

  async deleteMemory(id: string): Promise<MemoryDeleteResult> {
    return await this.backend.deleteMemory(id);
  }

  async listMemorySpaces(): Promise<MemorySpaceSummary[]> {
    return await this.backend.listMemorySpaces();
  }

  async reindex(options?: { dryRun?: boolean }): Promise<{
    scanned: number;
    changed: number;
    ids: string[];
    dryRun: boolean;
    hygiene: HygieneSummary;
  }> {
    const all = await this.listAll();
    const changed: string[] = [];
    for (const memory of all) {
      if (!this.config) {
        continue;
      }
      const next = buildReindexedMemory(memory, this.config);
      if (
        next.fingerprint !== memory.fingerprint ||
        next.scope !== memory.scope ||
        next.scopeKey !== memory.scopeKey ||
        JSON.stringify(next.suppressedReasons ?? []) !== JSON.stringify(memory.suppressedReasons ?? [])
      ) {
        changed.push(memory.id);
        if (!options?.dryRun) {
          await this.backend.updateMemory(memory.id, {
            fingerprint: next.fingerprint,
            scope: next.scope,
            scopeKey: next.scopeKey,
            suppressedReasons: next.suppressedReasons,
          });
        }
      }
    }
    const latest = options?.dryRun ? all : await this.listAll();
    return {
      scanned: all.length,
      changed: changed.length,
      ids: changed,
      dryRun: options?.dryRun === true,
      hygiene: analyzeMemoryHygiene(latest),
    };
  }

  async compact(options?: { dryRun?: boolean }): Promise<{
    scanned: number;
    compacted: number;
    ids: string[];
    dryRun: boolean;
    hygiene: HygieneSummary;
  }> {
    const all = await this.listAll();
    const compacted: string[] = [];
    for (const memory of all) {
      const next = buildCompactedMemory(memory);
      if (
        next.content !== memory.content ||
        JSON.stringify(next.topics) !== JSON.stringify(memory.topics) ||
        JSON.stringify(next.entityKeys) !== JSON.stringify(memory.entityKeys) ||
        JSON.stringify(next.suppressedReasons ?? []) !== JSON.stringify(memory.suppressedReasons ?? [])
      ) {
        compacted.push(memory.id);
        if (!options?.dryRun) {
          await this.backend.updateMemory(memory.id, {
            content: next.content,
            topics: next.topics,
            entityKeys: next.entityKeys,
            suppressedReasons: next.suppressedReasons,
          });
        }
      }
    }
    const latest = options?.dryRun ? all : await this.listAll();
    return {
      scanned: all.length,
      compacted: compacted.length,
      ids: compacted,
      dryRun: options?.dryRun === true,
      hygiene: analyzeMemoryHygiene(latest),
    };
  }

  async hygieneSummary(): Promise<HygieneSummary> {
    return analyzeMemoryHygiene(await this.listAll());
  }

  async touch(memories: MemoryRecord[]): Promise<void> {
    await this.backend.touchMemory(memories.map((memory) => memory.id));
  }

  async explain(query: string, limit: number): Promise<MemoryRecord[]> {
    const memories = await this.search(query);
    return memories.slice(0, limit).map((memory) => ({
      ...memory,
      retrievalReason: `Candidate memory for query "${query}".`,
      suppressedReasons: explainLifecycleSuppression(memory),
    }));
  }

  async pingBackend(): Promise<{ ok: boolean; detail: string; mode: string; backendType: string }> {
    return await this.backend.ping();
  }
}

function createMemoryBackend(
  database: PluginDatabase,
  embeddings: EmbeddingProvider,
  dedupeSimilarity: number,
  config?: ResolvedPluginConfig,
): MemoryBackend {
  if (!config || config.identity.backendType === "local" || config.identity.mode === "local") {
    return new LocalBackend(database, embeddings, dedupeSimilarity);
  }
  if (config.identity.backendType === "recall-http") {
    return config.identity.mode === "reconnect"
      ? new ReconnectBackend(config)
      : new CloudBackend(config);
  }
  return new LocalBackend(database, embeddings, dedupeSimilarity);
}
