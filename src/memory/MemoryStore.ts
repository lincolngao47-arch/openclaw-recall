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

  async listActive(): Promise<MemoryRecord[]> {
    return await this.backend.listActive();
  }

  async search(query?: string): Promise<MemoryRecord[]> {
    const memories = await this.backend.searchMemory(query);
    return memories.filter((memory) => !shouldSuppressMemory(memory));
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
      .filter((memory) =>
        memory.kind === "preference" ||
        memory.kind === "semantic" ||
        (memory.kind === "session_state" && memory.sourceSessionId === sessionId),
      )
      .sort((left, right) => {
        const leftBoost = left.kind === "preference" ? 3 : left.kind === "semantic" ? 2 : 1;
        const rightBoost = right.kind === "preference" ? 3 : right.kind === "semantic" ? 2 : 1;
        return right.salience + rightBoost - (left.salience + leftBoost);
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

  async touch(memories: MemoryRecord[]): Promise<void> {
    await this.backend.touchMemory(memories.map((memory) => memory.id));
  }

  async explain(query: string, limit: number): Promise<MemoryRecord[]> {
    const memories = await this.search(query);
    return memories.slice(0, limit).map((memory) => ({
      ...memory,
      retrievalReason: `Candidate memory for query "${query}".`,
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
