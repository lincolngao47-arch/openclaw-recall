import type { ResolvedPluginConfig } from "../config/schema.js";
import type { MemoryRecord } from "../types/domain.js";
import { RecallHttpBackendClient } from "./RecallHttpBackend.js";
import type {
  MemoryBackend,
  MemoryBackendMode,
  MemoryBackendPing,
  MemoryDeleteResult,
  MemoryPruneResult,
  MemorySpaceSummary,
  MemoryWriteResult,
} from "./MemoryBackend.js";

export class CloudBackend implements MemoryBackend {
  readonly mode: MemoryBackendMode = "cloud";
  readonly backendType: string;
  private readonly client: RecallHttpBackendClient;

  constructor(protected readonly config: ResolvedPluginConfig) {
    this.backendType = config.identity.backendType;
    this.client = new RecallHttpBackendClient(config);
  }

  async listActive(): Promise<MemoryRecord[]> {
    return await this.client.listActive();
  }

  async searchMemory(query?: string): Promise<MemoryRecord[]> {
    return await this.client.searchMemory(query);
  }

  async getMemory(id: string): Promise<MemoryRecord | null> {
    return await this.client.getMemory(id);
  }

  async listBySession(sessionId: string, limit = 25): Promise<MemoryRecord[]> {
    return (await this.listActive()).filter((memory) => memory.sourceSessionId === sessionId).slice(0, limit);
  }

  async writeMemory(records: MemoryRecord[]): Promise<MemoryWriteResult> {
    return await this.client.writeMemory(records);
  }

  async updateMemory(id: string, patch: Partial<MemoryRecord>): Promise<MemoryRecord | null> {
    return await this.client.updateMemory(id, patch);
  }

  async deleteMemory(id: string): Promise<MemoryDeleteResult> {
    return await this.client.deleteMemory(id);
  }

  async touchMemory(ids: string[]): Promise<void> {
    await this.client.touchMemory(ids);
  }

  async pruneNoise(dryRun: boolean): Promise<MemoryPruneResult> {
    return await this.client.pruneNoise(dryRun);
  }

  async listMemorySpaces(): Promise<MemorySpaceSummary[]> {
    return await this.client.listMemorySpaces();
  }

  async ping(): Promise<MemoryBackendPing> {
    const result = await this.client.ping();
    return { ...result, mode: this.mode, backendType: this.backendType };
  }
}
