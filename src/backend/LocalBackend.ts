import { cosineSimilarity, EmbeddingProvider } from "../memory/EmbeddingProvider.js";
import { shouldSuppressMemory } from "../shared/safety.js";
import type { MemoryRecord } from "../types/domain.js";
import type {
  MemoryBackend,
  MemoryBackendPing,
  MemoryDeleteResult,
  MemoryPruneResult,
  MemorySpaceSummary,
  MemoryWriteResult,
} from "./MemoryBackend.js";
import { PluginDatabase } from "../storage/PluginDatabase.js";

export class LocalBackend implements MemoryBackend {
  readonly mode = "local" as const;
  readonly backendType = "local";

  constructor(
    private readonly database: PluginDatabase,
    private readonly embeddings: EmbeddingProvider,
    private readonly dedupeSimilarity: number,
  ) {}

  async listAllMemory(): Promise<MemoryRecord[]> {
    const rows = this.database.connection
      .prepare(`
        SELECT *
        FROM memories
        ORDER BY last_seen_at DESC, salience DESC
      `)
      .all() as MemoryRow[];
    return rows.map((row) => this.fromRow(row));
  }

  async listActive(): Promise<MemoryRecord[]> {
    return (await this.listAllMemory())
      .filter((memory) => memory.active !== false && !isExpired(memory) && !isEvicted(memory));
  }

  async searchMemory(query?: string): Promise<MemoryRecord[]> {
    const memories = (await this.listActive()).filter((memory) => !shouldSuppressMemory(memory));
    if (!query?.trim()) {
      return memories;
    }
    const queryTokens = new Set(query.toLowerCase().split(/\s+/).filter(Boolean));
    return memories.filter((memory) => {
      const haystack = `${memory.summary} ${memory.content} ${memory.topics.join(" ")} ${memory.entityKeys.join(" ")}`.toLowerCase();
      return Array.from(queryTokens).some((token) => haystack.includes(token));
    });
  }

  async getMemory(id: string): Promise<MemoryRecord | null> {
    const row = this.database.connection
      .prepare(`SELECT * FROM memories WHERE id = ? LIMIT 1`)
      .get(id) as MemoryRow | undefined;
    return row ? this.fromRow(row) : null;
  }

  async listBySession(sessionId: string, limit = 25): Promise<MemoryRecord[]> {
    const rows = this.database.connection
      .prepare(
        `
          SELECT *
          FROM memories
          WHERE source_session_id = ?
          ORDER BY last_seen_at DESC, salience DESC
          LIMIT ?
        `,
      )
      .all(sessionId, limit) as MemoryRow[];
    return rows
      .map((row) => this.fromRow(row))
      .filter((memory) => memory.active !== false && !isExpired(memory) && !isEvicted(memory));
  }

  async writeMemory(candidates: MemoryRecord[]): Promise<MemoryWriteResult> {
    let written = 0;
    let updated = 0;
    let superseded = 0;
    if (candidates.length === 0) {
      return { candidateCount: 0, written, updated, superseded };
    }

    for (const candidate of candidates) {
      const existing = this.database.connection
        .prepare(`SELECT * FROM memories WHERE fingerprint = ?`)
        .get(candidate.fingerprint) as MemoryRow | undefined;

      if (existing) {
        const previous = this.fromRow(existing);
        const merged = await this.mergeMemory(previous, candidate);
        this.updateByFingerprint(merged);
        updated += 1;
        continue;
      }

      const groupRow =
        candidate.memoryGroup
          ? (this.database.connection
              .prepare(`SELECT * FROM memories WHERE json_extract(meta_json, '$.memoryGroup') = ? ORDER BY created_at DESC LIMIT 1`)
              .get(candidate.memoryGroup) as MemoryRow | undefined)
          : undefined;

      if (groupRow) {
        const previous = this.fromRow(groupRow);
        if (shouldSupersede(previous, candidate)) {
          const embedding =
            candidate.embedding ??
            (await this.embeddings.embed([candidate.summary, candidate.content].join("\n")));
          const next = {
            ...candidate,
            embedding,
            version: (previous.version ?? 1) + 1,
            memoryGroup: candidate.memoryGroup ?? previous.memoryGroup,
            active: true,
          };
          this.insert(next);
          this.markSuperseded(previous.id, next.id);
          written += 1;
          superseded += 1;
          continue;
        }

        const merged = await this.mergeMemory(previous, candidate);
        this.updateByFingerprint(merged);
        updated += 1;
        continue;
      }

      const embedding =
        candidate.embedding ??
        (await this.embeddings.embed([candidate.summary, candidate.content].join("\n")));

      const similar = await this.findSimilarActive(candidate, embedding);
      if (similar) {
        const merged = await this.mergeMemory(similar, { ...candidate, embedding });
        this.updateByFingerprint(merged);
        updated += 1;
        continue;
      }

      this.insert({ ...candidate, embedding });
      written += 1;
    }

    return {
      candidateCount: candidates.length,
      written,
      updated,
      superseded,
    };
  }

  async updateMemory(id: string, patch: Partial<MemoryRecord>): Promise<MemoryRecord | null> {
    const current = await this.getMemory(id);
    if (!current) {
      return null;
    }
    const next: MemoryRecord = {
      ...current,
      ...patch,
      id: current.id,
      fingerprint: patch.fingerprint ?? current.fingerprint,
    };
    this.updateById(next);
    return await this.getMemory(id);
  }

  async deleteMemory(id: string): Promise<MemoryDeleteResult> {
    const result = this.database.connection.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    return { deleted: result.changes > 0 };
  }

  async touchMemory(ids: string[]): Promise<void> {
    const now = Date.now();
    for (const id of ids) {
      this.database.connection
        .prepare(`UPDATE memories SET last_accessed_at = ?, salience = MIN(10, salience + 0.08) WHERE id = ?`)
        .run(now, id);
    }
  }

  async pruneNoise(dryRun: boolean): Promise<MemoryPruneResult> {
    const memories = await this.listActive();
    const noisy = memories.filter((memory) => shouldSuppressMemory(memory));
    if (!dryRun) {
      for (const memory of noisy) {
        this.deactivate(memory.id);
      }
    }
    return {
      scanned: memories.length,
      pruned: noisy.length,
      ids: noisy.map((memory) => memory.id),
      dryRun,
    };
  }

  async listMemorySpaces(): Promise<MemorySpaceSummary[]> {
    const memories = await this.listActive();
    const scopeCounts = memories.reduce<Record<string, number>>((summary, memory) => {
      const key = memory.scope ?? "private";
      summary[key] = (summary[key] ?? 0) + 1;
      return summary;
    }, {});
    return [
      {
        id: "local",
        backend: "local",
        memoryCount: memories.length,
        updatedAt: memories[0]?.lastSeenAt,
        scopeCounts,
      },
    ];
  }

  async ping(): Promise<MemoryBackendPing> {
    return { ok: true, detail: "local sqlite backend", mode: "local", backendType: this.backendType };
  }

  private async findSimilarActive(
    candidate: MemoryRecord,
    embedding: number[],
  ): Promise<MemoryRecord | null> {
    const active = await this.listActive();
    let best: { memory: MemoryRecord; similarity: number } | null = null;
    for (const memory of active) {
      if (memory.kind !== candidate.kind) {
        continue;
      }
      const similarity = cosineSimilarity(embedding, memory.embedding ?? []);
      if (similarity < this.dedupeSimilarity) {
        continue;
      }
      if (!best || similarity > best.similarity) {
        best = { memory, similarity };
      }
    }
    return best?.memory ?? null;
  }

  private async mergeMemory(previous: MemoryRecord, candidate: MemoryRecord): Promise<MemoryRecord> {
    const merged: MemoryRecord = {
      ...previous,
      summary: preferSummary(previous.summary, candidate.summary),
      content: preferContent(previous.content, candidate.content),
      topics: Array.from(new Set([...previous.topics, ...candidate.topics])).slice(0, 18),
      entityKeys: Array.from(new Set([...previous.entityKeys, ...candidate.entityKeys])).slice(0, 18),
      salience: Math.min(10, Math.max(previous.salience, candidate.salience) + 0.35),
      lastSeenAt: candidate.lastSeenAt,
      ttlDays: candidate.ttlDays ?? previous.ttlDays,
      decayRate: Math.max(previous.decayRate, candidate.decayRate),
      confidence: Math.max(previous.confidence ?? 0, candidate.confidence ?? 0),
      importance: Math.max(previous.importance ?? 0, candidate.importance ?? 0),
      active: true,
      memoryGroup: candidate.memoryGroup ?? previous.memoryGroup,
      sourceSessionId: candidate.sourceSessionId,
      sourceTurnIds: Array.from(new Set([...previous.sourceTurnIds, ...candidate.sourceTurnIds])),
      embedding: previous.embedding?.length ? previous.embedding : candidate.embedding,
      version: Math.max(previous.version ?? 1, candidate.version ?? 1),
      supersededAt: undefined,
      supersededBy: undefined,
    };

    if (!merged.embedding?.length) {
      merged.embedding = await this.embeddings.embed([merged.summary, merged.content].join("\n"));
    }

    return merged;
  }

  private insert(memory: MemoryRecord): void {
    this.database.connection
      .prepare(`
        INSERT INTO memories (
          id,
          kind,
          summary,
          content,
          topics_json,
          entity_keys_json,
          salience,
          fingerprint,
          created_at,
          last_seen_at,
          last_accessed_at,
          ttl_days,
          decay_rate,
          meta_json,
          source_session_id,
          source_turn_ids_json,
          embedding_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        memory.id,
        memory.kind,
        memory.summary,
        memory.content,
        JSON.stringify(memory.topics),
        JSON.stringify(memory.entityKeys),
        memory.salience,
        memory.fingerprint,
        new Date(memory.createdAt).getTime(),
        new Date(memory.lastSeenAt).getTime(),
        memory.lastAccessedAt ? new Date(memory.lastAccessedAt).getTime() : null,
        memory.ttlDays ?? null,
        memory.decayRate,
        JSON.stringify(toMeta(memory)),
        memory.sourceSessionId,
        JSON.stringify(memory.sourceTurnIds),
        JSON.stringify(memory.embedding ?? []),
      );
  }

  private updateByFingerprint(memory: MemoryRecord): void {
    this.database.connection
      .prepare(`
        UPDATE memories
        SET
          summary = ?,
          content = ?,
          topics_json = ?,
          entity_keys_json = ?,
          salience = ?,
          last_seen_at = ?,
          last_accessed_at = ?,
          ttl_days = ?,
          decay_rate = ?,
          meta_json = ?,
          source_session_id = ?,
          source_turn_ids_json = ?,
          embedding_json = ?
        WHERE fingerprint = ?
      `)
      .run(
        memory.summary,
        memory.content,
        JSON.stringify(memory.topics),
        JSON.stringify(memory.entityKeys),
        memory.salience,
        new Date(memory.lastSeenAt).getTime(),
        memory.lastAccessedAt ? new Date(memory.lastAccessedAt).getTime() : null,
        memory.ttlDays ?? null,
        memory.decayRate,
        JSON.stringify(toMeta(memory)),
        memory.sourceSessionId,
        JSON.stringify(memory.sourceTurnIds),
        JSON.stringify(memory.embedding ?? []),
        memory.fingerprint,
      );
  }

  private updateById(memory: MemoryRecord): void {
    this.database.connection
      .prepare(`
        UPDATE memories
        SET
          summary = ?,
          content = ?,
          topics_json = ?,
          entity_keys_json = ?,
          salience = ?,
          fingerprint = ?,
          last_seen_at = ?,
          last_accessed_at = ?,
          ttl_days = ?,
          decay_rate = ?,
          meta_json = ?,
          source_session_id = ?,
          source_turn_ids_json = ?,
          embedding_json = ?
        WHERE id = ?
      `)
      .run(
        memory.summary,
        memory.content,
        JSON.stringify(memory.topics),
        JSON.stringify(memory.entityKeys),
        memory.salience,
        memory.fingerprint,
        new Date(memory.lastSeenAt).getTime(),
        memory.lastAccessedAt ? new Date(memory.lastAccessedAt).getTime() : null,
        memory.ttlDays ?? null,
        memory.decayRate,
        JSON.stringify(toMeta(memory)),
        memory.sourceSessionId,
        JSON.stringify(memory.sourceTurnIds),
        JSON.stringify(memory.embedding ?? []),
        memory.id,
      );
  }

  private markSuperseded(id: string, supersededBy: string): void {
    const row = this.database.connection
      .prepare(`SELECT * FROM memories WHERE id = ? LIMIT 1`)
      .get(id) as MemoryRow | undefined;
    if (!row) {
      return;
    }
    const previous = this.fromRow(row);
    const next: MemoryRecord = {
      ...previous,
      active: false,
      supersededAt: new Date().toISOString(),
      supersededBy,
    };
    this.database.connection
      .prepare(`UPDATE memories SET meta_json = ? WHERE id = ?`)
      .run(JSON.stringify(toMeta(next)), id);
  }

  private deactivate(id: string): void {
    const row = this.database.connection
      .prepare(`SELECT * FROM memories WHERE id = ? LIMIT 1`)
      .get(id) as MemoryRow | undefined;
    if (!row) {
      return;
    }
    const memory = this.fromRow(row);
    const next: MemoryRecord = {
      ...memory,
      active: false,
      supersededAt: new Date().toISOString(),
    };
    this.database.connection
      .prepare(`UPDATE memories SET meta_json = ? WHERE id = ?`)
      .run(JSON.stringify(toMeta(next)), id);
  }

  private fromRow(row: MemoryRow): MemoryRecord {
    const meta = safeJson(row.meta_json);
    return {
      id: row.id,
      kind: row.kind,
      summary: row.summary,
      content: row.content,
      topics: JSON.parse(row.topics_json) as string[],
      entityKeys: JSON.parse(row.entity_keys_json) as string[],
      salience: applyDecay(row.salience, row.created_at, row.decay_rate),
      fingerprint: row.fingerprint,
      createdAt: new Date(row.created_at).toISOString(),
      lastSeenAt: new Date(row.last_seen_at).toISOString(),
      lastAccessedAt: row.last_accessed_at ? new Date(row.last_accessed_at).toISOString() : undefined,
      ttlDays: row.ttl_days ?? undefined,
      decayRate: row.decay_rate,
      confidence: typeof meta.confidence === "number" ? meta.confidence : undefined,
      importance: typeof meta.importance === "number" ? meta.importance : undefined,
      active: meta.active !== false,
      scope: typeof meta.scope === "string" ? (meta.scope as MemoryRecord["scope"]) : "private",
      scopeKey: typeof meta.scopeKey === "string" ? meta.scopeKey : undefined,
      backend: typeof meta.backend === "string" ? (meta.backend as "local" | "remote") : "local",
      sensitive: meta.sensitive === true,
      memoryGroup: typeof meta.memoryGroup === "string" ? meta.memoryGroup : undefined,
      supersededAt: typeof meta.supersededAt === "string" ? meta.supersededAt : undefined,
      supersededBy: typeof meta.supersededBy === "string" ? meta.supersededBy : undefined,
      version: typeof meta.version === "number" ? meta.version : 1,
      suppressedReasons: Array.isArray(meta.suppressedReasons) ? (meta.suppressedReasons as string[]) : undefined,
      sourceSessionId: row.source_session_id,
      sourceTurnIds: JSON.parse(row.source_turn_ids_json) as string[],
      embedding: JSON.parse(row.embedding_json) as number[],
    };
  }
}

type MemoryRow = {
  id: string;
  kind: MemoryRecord["kind"];
  summary: string;
  content: string;
  topics_json: string;
  entity_keys_json: string;
  salience: number;
  fingerprint: string;
  created_at: number;
  last_seen_at: number;
  last_accessed_at: number | null;
  ttl_days: number | null;
  decay_rate: number;
  meta_json: string | null;
  source_session_id: string;
  source_turn_ids_json: string;
  embedding_json: string;
};

function safeJson(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toMeta(memory: MemoryRecord): Record<string, unknown> {
  return {
    confidence: memory.confidence ?? 0.7,
    importance: memory.importance ?? memory.salience,
    active: memory.active !== false,
    scope: memory.scope ?? "private",
    scopeKey: memory.scopeKey,
    backend: memory.backend ?? "local",
    sensitive: memory.sensitive === true,
    memoryGroup: memory.memoryGroup,
    supersededAt: memory.supersededAt,
    supersededBy: memory.supersededBy,
    version: memory.version ?? 1,
    suppressedReasons: memory.suppressedReasons ?? [],
  };
}

function isExpired(memory: MemoryRecord): boolean {
  if (!memory.ttlDays) {
    return false;
  }
  const ageDays = (Date.now() - new Date(memory.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > memory.ttlDays;
}

function isEvicted(memory: MemoryRecord): boolean {
  return memory.salience < 1.1;
}

function applyDecay(salience: number, createdAtMs: number, decayRate: number): number {
  const ageDays = (Date.now() - createdAtMs) / (1000 * 60 * 60 * 24);
  return Math.max(0.5, salience - ageDays * decayRate);
}

function preferSummary(left: string, right: string): string {
  return right.length >= left.length ? right : left;
}

function preferContent(left: string, right: string): string {
  return right.length >= left.length ? right : left;
}

function shouldSupersede(previous: MemoryRecord, candidate: MemoryRecord): boolean {
  if (!previous.memoryGroup || !candidate.memoryGroup || previous.memoryGroup !== candidate.memoryGroup) {
    return false;
  }
  if (previous.summary === candidate.summary) {
    return false;
  }
  const previousText = `${previous.summary} ${previous.content}`.toLowerCase();
  const nextText = `${candidate.summary} ${candidate.content}`.toLowerCase();
  return (
    ((/detailed|verbose|详细|展开/.test(previousText)) && (/concise|brief|简洁|精简/.test(nextText))) ||
    ((/concise|brief|简洁|精简/.test(previousText)) && (/detailed|verbose|详细|展开/.test(nextText))) ||
    ((/english|英文/.test(previousText)) && (/chinese|中文/.test(nextText))) ||
    ((/chinese|中文/.test(previousText)) && (/english|英文/.test(nextText))) ||
    (previous.memoryGroup === "semantic:project" && previous.summary !== candidate.summary)
  );
}
