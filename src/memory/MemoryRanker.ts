import { cosineSimilarity } from "./EmbeddingProvider.js";
import { explainSuppressedMemory, hasStablePreferenceSignal, shouldSuppressMemory } from "../shared/safety.js";
import { MemoryRecord, RetrievalMode } from "../types/domain.js";
import { keywordMatchCount } from "./hygiene.js";

export class MemoryRanker {
  rank(
    query: string,
    memories: MemoryRecord[],
    queryEmbedding: number[],
    retrievalMode: RetrievalMode,
  ): MemoryRecord[] {
    const now = Date.now();

    return [...memories]
      .filter((memory) => !shouldSuppressMemory(memory))
      .map((memory) => {
        const { topicOverlap: overlap, entityOverlap } = keywordMatchCount(query, memory);
        const vectorScore =
          retrievalMode !== "keyword"
            ? Math.max(0, cosineSimilarity(queryEmbedding, memory.embedding ?? []))
            : 0;
        const ageDays = (now - new Date(memory.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        const freshness = Math.max(0, 1.5 - ageDays * memory.decayRate);
        const ttlFactor = memory.ttlDays ? Math.max(0.15, 1 - ageDays / memory.ttlDays) : 1;
        const typeBias =
          memory.kind === "preference"
            ? 1.55
            : memory.kind === "semantic"
              ? 1.05
              : memory.kind === "session_state"
                ? 0.72
                : 0.08;
        const confidence = memory.confidence ?? 0.7;
        const importance = memory.importance ?? memory.salience;
        const stablePreferenceBoost =
          memory.kind === "preference" && hasStablePreferenceSignal(`${memory.summary}\n${memory.content}`) ? 1.4 : 0;
        const reusableConstraintBoost =
          memory.kind === "session_state" &&
          /(constraint|decision|current task|project goal|working on|prefers|must|不要|不能|约束|决定)/i.test(
            `${memory.summary}\n${memory.content}`,
          )
            ? 0.9
            : 0;
        const redundancyPenalty = memory.active === false ? 5 : 0;
        const semanticContribution = vectorScore * 7;
        const keywordContribution = overlap * 2.8 + entityOverlap * 1.6;
        const score =
          semanticContribution +
          keywordContribution +
          memory.salience * 0.8 +
          importance * 0.45 +
          freshness * 2 +
          confidence * 1.5 +
          ttlFactor +
          stablePreferenceBoost +
          reusableConstraintBoost +
          typeBias -
          redundancyPenalty;
        return {
          memory: {
            ...memory,
            score,
            scoreBreakdown: {
              semanticSimilarity: vectorScore,
              retrievalMode,
              semanticContribution,
              keywordContribution,
              salience: memory.salience,
              recency: freshness,
              confidence,
              typeWeight: typeBias,
              overlap: overlap + entityOverlap,
              redundancyPenalty,
              finalScore: score,
            },
            retrievalReason: buildReason({
              query,
              retrievalMode,
              vectorScore,
              overlap,
              entityOverlap,
              typeBias,
              confidence,
            }),
          },
          score,
        };
      })
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.memory);
  }
}

function buildReason(params: {
  query: string;
  retrievalMode: RetrievalMode;
  vectorScore: number;
  overlap: number;
  entityOverlap: number;
  typeBias: number;
  confidence: number;
}): string {
  const reasons = [
    params.retrievalMode !== "keyword" ? `${params.retrievalMode} retrieval` : "keyword retrieval",
    params.vectorScore > 0.5 ? "strong semantic match" : params.vectorScore > 0.2 ? "semantic match" : "",
    params.overlap > 0 ? `${params.overlap} topic overlap` : "",
    params.entityOverlap > 0 ? `${params.entityOverlap} entity overlap` : "",
    params.typeBias >= 0.6 ? "high-value memory type" : "",
    params.confidence >= 0.8 ? "high confidence" : "",
  ].filter(Boolean);
  return reasons.length > 0
    ? `${reasons.join(", ")} for "${params.query}".`
    : `Retrieved as a fallback contextual memory for "${params.query}".`;
}

export function explainSuppression(memory: Pick<MemoryRecord, "summary" | "content" | "kind" | "active">): string[] {
  if (!shouldSuppressMemory(memory)) {
    return [];
  }
  return explainSuppressedMemory(`${memory.summary}\n${memory.content}`);
}
