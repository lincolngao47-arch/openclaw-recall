import type { MemoryRecord } from "../types/domain.js";
import { explainSuppressedMemory } from "../shared/safety.js";
import { fingerprint, tokenize } from "../shared/text.js";
import type { ResolvedPluginConfig } from "../config/schema.js";
import { defaultScopeFor, defaultScopeKey } from "./scopes.js";

export type HygieneSummary = {
  score: number;
  noisyActiveCount: number;
  supersededStaleCount: number;
  expiredActiveCount: number;
  duplicateClusters: number;
};

export function analyzeMemoryHygiene(memories: MemoryRecord[]): HygieneSummary {
  const noisyActiveCount = memories.filter((memory) => memory.active !== false && explainSuppressedMemory(toText(memory)).length > 0).length;
  const supersededStaleCount = memories.filter((memory) => memory.active === false && Boolean(memory.supersededAt)).length;
  const expiredActiveCount = memories.filter((memory) => memory.active !== false && isExpired(memory)).length;
  const duplicateClusters = countDuplicateClusters(memories);
  const penalties = noisyActiveCount * 12 + supersededStaleCount * 2 + expiredActiveCount * 6 + duplicateClusters * 8;
  return {
    score: Math.max(0, 100 - penalties),
    noisyActiveCount,
    supersededStaleCount,
    expiredActiveCount,
    duplicateClusters,
  };
}

export function buildReindexedMemory(memory: MemoryRecord, config: ResolvedPluginConfig): MemoryRecord {
  const scope = defaultScopeFor(memory.kind, config);
  const scopeKey = defaultScopeKey(scope, config, memory.sourceSessionId);
  const scoped = {
    ...memory,
    scope,
    scopeKey,
  };
  const nextFingerprint = fingerprint([
    scoped.kind,
    scoped.memoryGroup ?? "",
    scoped.summary.toLowerCase(),
    scoped.content.toLowerCase(),
  ].join("|"));
  return {
    ...scoped,
    fingerprint: nextFingerprint,
    suppressedReasons: explainSuppressedMemory(toText(scoped)),
  };
}

export function isExpired(memory: MemoryRecord): boolean {
  if (!memory.ttlDays) {
    return false;
  }
  const ageDays = (Date.now() - new Date(memory.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > memory.ttlDays;
}

export function buildCompactedMemory(memory: MemoryRecord): MemoryRecord {
  if (memory.active !== false || (!memory.supersededAt && !isExpired(memory))) {
    return memory;
  }
  const content = memory.content.length > 280 ? `${memory.content.slice(0, 277)}...` : memory.content;
  const topics = memory.topics.length > 12 ? memory.topics.slice(0, 12) : memory.topics;
  const entityKeys = memory.entityKeys.length > 12 ? memory.entityKeys.slice(0, 12) : memory.entityKeys;
  return {
    ...memory,
    content,
    topics,
    entityKeys,
    suppressedReasons: explainSuppressedMemory(toText(memory)),
  };
}

function countDuplicateClusters(memories: MemoryRecord[]): number {
  const clusters = new Map<string, number>();
  for (const memory of memories) {
    const key = `${memory.kind}:${memory.memoryGroup ?? memory.fingerprint}`;
    clusters.set(key, (clusters.get(key) ?? 0) + 1);
  }
  return Array.from(clusters.values()).filter((count) => count > 1).length;
}

function toText(memory: Pick<MemoryRecord, "summary" | "content">): string {
  return `${memory.summary}\n${memory.content}`;
}

export function keywordMatchCount(query: string, memory: MemoryRecord): { topicOverlap: number; entityOverlap: number } {
  const queryTokens = new Set(tokenize(query));
  return {
    topicOverlap: memory.topics.filter((topic) => queryTokens.has(topic)).length,
    entityOverlap: memory.entityKeys.filter((entity) => queryTokens.has(entity.toLowerCase())).length,
  };
}
