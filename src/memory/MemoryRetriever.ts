import { EmbeddingProvider } from "./EmbeddingProvider.js";
import { MemoryStore } from "./MemoryStore.js";
import { MemoryRanker } from "./MemoryRanker.js";
import { MemoryRecord, RetrievalMode } from "../types/domain.js";
import { sanitizeIncomingUserText } from "../shared/safety.js";
import type { ResolvedPluginConfig } from "../config/schema.js";
import { isMemoryVisible } from "./scopes.js";
import { explainSuppression } from "./MemoryRanker.js";

export class MemoryRetriever {
  constructor(
    private readonly store: MemoryStore,
    private readonly ranker: MemoryRanker,
    private readonly embeddings: EmbeddingProvider,
    private readonly bootTopK: number,
    private readonly config: ResolvedPluginConfig,
  ) {}

  async retrieve(query: string, limit: number, options: { sessionId?: string } = {}): Promise<MemoryRecord[]> {
    const result = await this.retrieveWithContext(query, limit, options);
    return result.memories;
  }

  async retrieveWithContext(
    query: string,
    limit: number,
    options: { sessionId?: string } = {},
  ): Promise<{
    memories: MemoryRecord[];
    mode: RetrievalMode;
    keywordContribution: number;
    semanticContribution: number;
  }> {
    const cleanQuery = sanitizeIncomingUserText(query);
    const usedMode = this.resolveRetrievalMode();
    const memories = (await this.store.search(cleanQuery)).filter((memory) =>
      isMemoryVisible(memory, this.config, options.sessionId),
    );
    const queryEmbedding = usedMode === "keyword" ? [] : await this.embeddings.embed(cleanQuery);
    const ranked = this.ranker.rank(cleanQuery, memories, queryEmbedding, usedMode).slice(0, limit);
    const boot = options.sessionId
      ? await this.store.listBootCandidates(
          options.sessionId,
          Math.min(limit, Math.max(2, this.bootTopK)),
        )
      : [];
    const visibleBoot = boot.filter((memory) => isMemoryVisible(memory, this.config, options.sessionId));
    const merged = Array.from(
      new Map(
        [...visibleBoot, ...ranked]
          .map((memory) => [memory.id, memory] as const),
      ).values(),
    ).slice(0, limit);
    await this.store.touch(merged);
    return {
      memories: merged,
      mode: usedMode,
      keywordContribution: merged.reduce(
        (sum, memory) => sum + (memory.scoreBreakdown?.keywordContribution ?? 0),
        0,
      ),
      semanticContribution: merged.reduce(
        (sum, memory) => sum + (memory.scoreBreakdown?.semanticContribution ?? 0),
        0,
      ),
    };
  }

  async explain(query: string, limit: number, options: { sessionId?: string } = {}): Promise<MemoryRecord[]> {
    return (await this.retrieveWithContext(query, limit, options)).memories;
  }

  async explainDetailed(
    query: string,
    limit: number,
    options: { sessionId?: string } = {},
  ): Promise<{
    query: string;
    retrievalMode: RetrievalMode;
    selected: MemoryRecord[];
    suppressed: Array<{ id: string; summary: string; reasons: string[] }>;
    keywordContribution: number;
    semanticContribution: number;
  }> {
    const cleanQuery = sanitizeIncomingUserText(query);
    const usedMode = this.resolveRetrievalMode();
    const all = (await this.store.listAll()).filter((memory) =>
      isMemoryVisible(memory, this.config, options.sessionId),
    );
    const suppressed = all
      .map((memory) => ({ memory, reasons: explainSuppression(memory) }))
      .filter((entry) => entry.reasons.length > 0)
      .map((entry) => ({
        id: entry.memory.id,
        summary: entry.memory.summary,
        reasons: entry.reasons,
      }));
    const selected = (await this.retrieveWithContext(cleanQuery, limit, options));
    const selectedWithBreakdown = selected.memories.map((memory) =>
      memory.scoreBreakdown
        ? memory
        : {
            ...memory,
            scoreBreakdown: {
              retrievalMode: usedMode,
              semanticSimilarity: 0,
              semanticContribution: 0,
              keywordContribution: 0,
              salience: memory.salience,
              recency: 0,
              confidence: memory.confidence ?? 0,
              typeWeight: 0,
              overlap: 0,
              redundancyPenalty: 0,
              finalScore: memory.score ?? memory.salience,
            },
          },
    );
    return {
      query: cleanQuery,
      retrievalMode: usedMode,
      selected: selectedWithBreakdown,
      suppressed,
      keywordContribution: selected.keywordContribution,
      semanticContribution: selected.semanticContribution,
    };
  }

  embeddingAvailability(): "exact" | "local" | "unavailable" {
    return this.embeddings.availability;
  }

  private resolveRetrievalMode(): RetrievalMode {
    if (this.config.retrieval.mode === "keyword") {
      return "keyword";
    }
    if (this.config.retrieval.mode === "embedding") {
      if (this.embeddings.available) {
        return "embedding";
      }
      return this.config.retrieval.fallbackToKeyword ? "keyword" : "embedding";
    }
    if (this.embeddings.available) {
      return "hybrid";
    }
    return this.config.retrieval.fallbackToKeyword ? "keyword" : "embedding";
  }
}
