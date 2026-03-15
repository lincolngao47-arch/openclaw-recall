import { EmbeddingProvider } from "./EmbeddingProvider.js";
import { MemoryStore } from "./MemoryStore.js";
import { MemoryRanker } from "./MemoryRanker.js";
import { MemoryRecord } from "../types/domain.js";
import { sanitizeIncomingUserText } from "../shared/safety.js";

export class MemoryRetriever {
  constructor(
    private readonly store: MemoryStore,
    private readonly ranker: MemoryRanker,
    private readonly embeddings: EmbeddingProvider,
    private readonly bootTopK: number,
  ) {}

  async retrieve(query: string, limit: number, options: { sessionId?: string } = {}): Promise<MemoryRecord[]> {
    const cleanQuery = sanitizeIncomingUserText(query);
    const memories = await this.store.search();
    const queryEmbedding = await this.embeddings.embed(cleanQuery);
    const ranked = this.ranker.rank(cleanQuery, memories, queryEmbedding).slice(0, limit);
    const boot = options.sessionId
      ? await this.store.listBootCandidates(
          options.sessionId,
          Math.min(limit, Math.max(2, this.bootTopK)),
        )
      : [];
    const merged = Array.from(
      new Map(
        [...boot, ...ranked]
          .map((memory) => [memory.id, memory] as const),
      ).values(),
    ).slice(0, limit);
    await this.store.touch(merged);
    return merged;
  }

  async explain(query: string, limit: number, options: { sessionId?: string } = {}): Promise<MemoryRecord[]> {
    return await this.retrieve(query, limit, options);
  }
}
