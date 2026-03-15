import { cosineSimilarity } from "./EmbeddingProvider.js";
import { tokenize } from "../shared/text.js";
import { shouldSuppressMemory } from "../shared/safety.js";
import { MemoryRecord } from "../types/domain.js";

export class MemoryRanker {
  rank(query: string, memories: MemoryRecord[], queryEmbedding: number[]): MemoryRecord[] {
    const queryTokens = new Set(tokenize(query));
    const now = Date.now();

    return [...memories]
      .filter((memory) => !shouldSuppressMemory(memory))
      .map((memory) => {
        const overlap = memory.topics.filter((topic) => queryTokens.has(topic)).length;
        const entityOverlap = memory.entityKeys.filter((entity) => queryTokens.has(entity.toLowerCase())).length;
        const vectorScore = Math.max(0, cosineSimilarity(queryEmbedding, memory.embedding ?? []));
        const ageDays = (now - new Date(memory.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        const freshness = Math.max(0, 1.5 - ageDays * memory.decayRate);
        const ttlFactor = memory.ttlDays ? Math.max(0.15, 1 - ageDays / memory.ttlDays) : 1;
        const typeBias =
          memory.kind === "preference"
            ? 1.1
            : memory.kind === "semantic"
              ? 0.75
              : memory.kind === "session_state"
                ? 0.5
                : 0.18;
        const confidence = memory.confidence ?? 0.7;
        const importance = memory.importance ?? memory.salience;
        const redundancyPenalty = memory.active === false ? 5 : 0;
        const score =
          vectorScore * 7 +
          overlap * 2.8 +
          entityOverlap * 1.6 +
          memory.salience * 0.8 +
          importance * 0.45 +
          freshness * 2 +
          confidence * 1.5 +
          ttlFactor +
          typeBias -
          redundancyPenalty;
        return {
          memory: {
            ...memory,
            score,
            scoreBreakdown: {
              semanticSimilarity: vectorScore,
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
  vectorScore: number;
  overlap: number;
  entityOverlap: number;
  typeBias: number;
  confidence: number;
}): string {
  const reasons = [
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
