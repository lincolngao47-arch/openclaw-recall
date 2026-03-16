import type { MemoryRecord, MemoryScope } from "../types/domain.js";

export type MemoryBackendMode = "local" | "cloud" | "reconnect";

export type MemoryBackendPing = {
  ok: boolean;
  detail: string;
  mode: MemoryBackendMode;
  backendType: string;
};

export type MemoryWriteResult = {
  candidateCount: number;
  written: number;
  updated: number;
  superseded: number;
};

export type MemoryPruneResult = {
  scanned: number;
  pruned: number;
  ids: string[];
  dryRun: boolean;
};

export type MemoryDeleteResult = {
  deleted: boolean;
};

export type MemorySpaceSummary = {
  id: string;
  backend: string;
  memoryCount: number;
  updatedAt?: string;
  scopeCounts?: Partial<Record<MemoryScope, number>>;
};

export interface MemoryBackend {
  readonly mode: MemoryBackendMode;
  readonly backendType: string;
  listActive(): Promise<MemoryRecord[]>;
  searchMemory(query?: string): Promise<MemoryRecord[]>;
  getMemory(id: string): Promise<MemoryRecord | null>;
  listBySession(sessionId: string, limit?: number): Promise<MemoryRecord[]>;
  writeMemory(records: MemoryRecord[]): Promise<MemoryWriteResult>;
  updateMemory(id: string, patch: Partial<MemoryRecord>): Promise<MemoryRecord | null>;
  deleteMemory(id: string): Promise<MemoryDeleteResult>;
  touchMemory(ids: string[]): Promise<void>;
  pruneNoise(dryRun: boolean): Promise<MemoryPruneResult>;
  listMemorySpaces(): Promise<MemorySpaceSummary[]>;
  ping(): Promise<MemoryBackendPing>;
}
