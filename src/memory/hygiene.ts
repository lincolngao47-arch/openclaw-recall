import type { MemoryRecord } from "../types/domain.js";
import { explainSuppressedMemory } from "../shared/safety.js";
import { tokenize } from "../shared/text.js";
import type { ResolvedPluginConfig } from "../config/schema.js";
import { defaultScopeFor, defaultScopeKey } from "./scopes.js";
import { buildMemoryFingerprint } from "./identity.js";

export type HygieneSummary = {
  score: number;
  noisyActiveCount: number;
  supersededStaleCount: number;
  expiredActiveCount: number;
  duplicateClusters: number;
  staleSemanticCount: number;
  retrievalIneligibleCount: number;
};

export function analyzeMemoryHygiene(memories: MemoryRecord[]): HygieneSummary {
  const noisyActiveCount = memories.filter((memory) => memory.active !== false && explainSuppressedMemory(toText(memory)).length > 0).length;
  const supersededStaleCount = memories.filter((memory) => memory.active === false && Boolean(memory.supersededAt)).length;
  const expiredActiveCount = memories.filter((memory) => memory.active !== false && isExpired(memory)).length;
  const staleSemanticCount = memories.filter((memory) => lifecycleState(memory) === "stale").length;
  const retrievalIneligibleCount = memories.filter((memory) => !isRetrievalEligible(memory)).length;
  const duplicateClusters = countDuplicateClusters(memories);
  const penalties =
    noisyActiveCount * 12 +
    supersededStaleCount * 2 +
    expiredActiveCount * 6 +
    staleSemanticCount * 5 +
    retrievalIneligibleCount * 2 +
    duplicateClusters * 8;
  return {
    score: Math.max(0, 100 - penalties),
    noisyActiveCount,
    supersededStaleCount,
    expiredActiveCount,
    duplicateClusters,
    staleSemanticCount,
    retrievalIneligibleCount,
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
  const nextFingerprint = buildMemoryFingerprint(scoped);
  return {
    ...scoped,
    fingerprint: nextFingerprint,
    suppressedReasons: explainLifecycleSuppression(scoped),
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
  const lifecycle = lifecycleState(memory);
  if (memory.active !== false && lifecycle !== "stale" && !memory.supersededAt && !isExpired(memory)) {
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
    suppressedReasons: explainLifecycleSuppression(memory),
  };
}

export function lifecycleState(memory: MemoryRecord): "active" | "stale" | "expired" | "superseded" {
  if (memory.active === false || memory.supersededAt) {
    return "superseded";
  }
  if (isExpired(memory)) {
    return "expired";
  }
  if (isStaleSemantic(memory)) {
    return "stale";
  }
  return "active";
}

export function isStaleSemantic(memory: MemoryRecord): boolean {
  if (memory.kind !== "semantic") {
    return false;
  }
  const lastSeen = new Date(memory.lastSeenAt).getTime();
  const lastTouched = memory.lastAccessedAt ? new Date(memory.lastAccessedAt).getTime() : lastSeen;
  const ageDays = (Date.now() - lastSeen) / (1000 * 60 * 60 * 24);
  const idleDays = (Date.now() - lastTouched) / (1000 * 60 * 60 * 24);
  const importance = memory.importance ?? memory.salience;
  return ageDays > 45 && idleDays > 21 && importance < 8.8;
}

export function effectiveImportance(memory: MemoryRecord): number {
  const base = memory.importance ?? memory.salience;
  const lifecycle = lifecycleState(memory);
  if (lifecycle === "superseded") {
    return Math.max(0, base - 6);
  }
  if (lifecycle === "expired") {
    return Math.max(0, base - 5);
  }
  if (lifecycle === "stale") {
    return Math.max(0, base - 3.5);
  }
  return base;
}

export function isRetrievalEligible(memory: MemoryRecord): boolean {
  const lifecycle = lifecycleState(memory);
  return lifecycle === "active";
}

export function explainLifecycleSuppression(memory: MemoryRecord): string[] {
  const reasons = explainSuppressedMemory(toText(memory));
  const lifecycle = lifecycleState(memory);
  if (lifecycle === "stale") {
    reasons.push("stale-semantic");
  } else if (lifecycle === "expired") {
    reasons.push("expired");
  } else if (lifecycle === "superseded") {
    reasons.push("superseded");
  }
  return Array.from(new Set(reasons));
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
