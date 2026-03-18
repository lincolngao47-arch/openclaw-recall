import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";
import type { ResolvedPluginConfig } from "../config/schema.js";
import { buildMemoryFingerprint } from "../memory/identity.js";
import type { MemoryRecord } from "../types/domain.js";
import { shouldSuppressMemory } from "../shared/safety.js";
import { tokenize } from "../shared/text.js";
import type {
  MemoryDeleteResult,
  MemoryPruneResult,
  MemorySpaceSummary,
  MemoryWriteResult,
} from "./MemoryBackend.js";

export class RecallHttpBackendClient {
  constructor(private readonly config: ResolvedPluginConfig) {}

  async ping(): Promise<{ ok: boolean; detail: string }> {
    if (!this.config.identity.endpoint?.trim()) {
      return { ok: false, detail: "No recall-http endpoint configured." };
    }
    try {
      const response = await fetch(this.resolve("/health"), {
        headers: this.headers(),
      });
      if (!response.ok) {
        return { ok: false, detail: `${response.status} ${response.statusText}` };
      }
      return { ok: true, detail: "reachable" };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async listAllMemory(): Promise<MemoryRecord[]> {
    return await this.request<MemoryRecord[]>("GET", this.spacePath("/memories?includeInactive=1"));
  }

  async listActive(): Promise<MemoryRecord[]> {
    return await this.request<MemoryRecord[]>("GET", this.spacePath("/memories"));
  }

  async searchMemory(query?: string): Promise<MemoryRecord[]> {
    const suffix = query?.trim() ? `/memories/search?q=${encodeURIComponent(query.trim())}` : "/memories";
    return await this.request<MemoryRecord[]>("GET", this.spacePath(suffix));
  }

  async getMemory(id: string): Promise<MemoryRecord | null> {
    return await this.request<MemoryRecord | null>("GET", this.spacePath(`/memories/${id}`));
  }

  async writeMemory(records: MemoryRecord[]): Promise<MemoryWriteResult> {
    return await this.request<MemoryWriteResult>("POST", this.spacePath("/memories/upsert"), {
      records,
    });
  }

  async updateMemory(id: string, patch: Partial<MemoryRecord>): Promise<MemoryRecord | null> {
    return await this.request<MemoryRecord | null>("PATCH", this.spacePath(`/memories/${id}`), { patch });
  }

  async deleteMemory(id: string): Promise<MemoryDeleteResult> {
    return await this.request<MemoryDeleteResult>("DELETE", this.spacePath(`/memories/${id}`));
  }

  async touchMemory(ids: string[]): Promise<void> {
    await this.request("POST", this.spacePath("/memories/touch"), { ids });
  }

  async pruneNoise(dryRun: boolean): Promise<MemoryPruneResult> {
    return await this.request<MemoryPruneResult>("POST", this.spacePath("/memories/prune-noise"), { dryRun });
  }

  async listMemorySpaces(): Promise<MemorySpaceSummary[]> {
    return await this.request<MemorySpaceSummary[]>("GET", "/v1/spaces");
  }

  private async request<T = unknown>(method: string, pathname: string, body?: unknown): Promise<T> {
    const response = await fetch(this.resolve(pathname), {
      method,
      headers: {
        ...this.headers(),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new Error(`recall-http request failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  }

  private resolve(pathname: string): string {
    return `${this.config.identity.endpoint?.replace(/\/$/, "")}${pathname}`;
  }

  private spacePath(suffix: string): string {
    const spaceId =
      this.config.identity.memorySpaceId?.trim() ||
      this.config.identity.identityKey?.trim() ||
      "default";
    return `/v1/spaces/${encodeURIComponent(spaceId)}${suffix}`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.config.identity.apiKey?.trim()) {
      headers.Authorization = `Bearer ${this.config.identity.apiKey.trim()}`;
    }
    return headers;
  }
}

export async function startRecallHttpBackendServer(params: {
  dataDir: string;
  port: number;
  apiKey?: string;
}): Promise<http.Server> {
  await fs.mkdir(params.dataDir, { recursive: true });
  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.writeHead(400).end(JSON.stringify({ error: "missing url" }));
        return;
      }
      if (params.apiKey) {
        const auth = req.headers.authorization?.replace(/^Bearer\s+/i, "").trim();
        if (auth !== params.apiKey) {
          res.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
      }

      const url = new URL(req.url, `http://127.0.0.1:${params.port}`);
      if (url.pathname === "/health") {
        reply(res, 200, { ok: true, mode: "recall-http" });
        return;
      }
      if (url.pathname === "/v1/spaces" && req.method === "GET") {
        reply(res, 200, await listSpaces(params.dataDir));
        return;
      }

      const match = url.pathname.match(/^\/v1\/spaces\/([^/]+)\/memories(?:\/([^/]+))?(?:\/([^/]+))?$/);
      if (!match) {
        reply(res, 404, { error: "not found" });
        return;
      }
      const [, encodedSpace, maybeId, maybeAction] = match;
      const spaceId = decodeURIComponent(encodedSpace);
      const filePath = path.join(params.dataDir, `${spaceId}.json`);
      const payload = req.method === "POST" || req.method === "PATCH" ? await readBody(req) : undefined;
      const records = await readSpace(filePath);

      if (req.method === "GET" && !maybeId) {
        const includeInactive = url.searchParams.get("includeInactive") === "1";
        reply(res, 200, includeInactive ? records : records.filter((record) => record.active !== false));
        return;
      }
      if (req.method === "GET" && maybeId === "search") {
        const query = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
        const tokens = tokenize(query);
        if (tokens.length === 0) {
          reply(res, 200, records.filter((record) => record.active !== false && !shouldSuppressMemory(record)));
          return;
        }
        const filtered = records.filter((record) => {
          if (record.active === false || shouldSuppressMemory(record)) {
            return false;
          }
          const haystack = `${record.summary} ${record.content} ${record.topics.join(" ")} ${record.entityKeys.join(" ")}`.toLowerCase();
          return tokens.some((token) => haystack.includes(token));
        });
        reply(res, 200, filtered);
        return;
      }
      if (req.method === "GET" && maybeId && !maybeAction) {
        reply(res, 200, records.find((record) => record.id === maybeId) ?? null);
        return;
      }
      if (req.method === "POST" && maybeId === "upsert") {
        const result = upsertRecords(records, Array.isArray(payload?.records) ? payload.records as MemoryRecord[] : []);
        await writeSpace(filePath, records);
        reply(res, 200, result);
        return;
      }
      if (req.method === "POST" && maybeId === "touch") {
        const ids = Array.isArray(payload?.ids) ? payload.ids as string[] : [];
        const now = new Date().toISOString();
        for (const record of records) {
          if (ids.includes(record.id)) {
            record.lastAccessedAt = now;
          }
        }
        await writeSpace(filePath, records);
        reply(res, 200, { ok: true });
        return;
      }
      if (req.method === "PATCH" && maybeId && !maybeAction) {
        const record = records.find((entry) => entry.id === maybeId);
        if (!record) {
          reply(res, 200, null);
          return;
        }
        const patch = (payload?.patch ?? {}) as Partial<MemoryRecord>;
        Object.assign(record, patch, { id: record.id });
        record.fingerprint = patch.fingerprint ?? buildMemoryFingerprint(record);
        await writeSpace(filePath, records);
        reply(res, 200, record);
        return;
      }
      if (req.method === "DELETE" && maybeId && !maybeAction) {
        const next = records.filter((record) => record.id !== maybeId);
        const deleted = next.length !== records.length;
        if (deleted) {
          await writeSpace(filePath, next);
        }
        reply(res, 200, { deleted });
        return;
      }
      if (req.method === "POST" && maybeId === "prune-noise") {
        const dryRun = Boolean(payload?.dryRun);
        const noisy = records.filter((record) => record.active !== false && shouldSuppressMemory(record));
        if (!dryRun) {
          const now = new Date().toISOString();
          for (const record of noisy) {
            record.active = false;
            record.supersededAt ??= now;
          }
          await writeSpace(filePath, records);
        }
        reply(res, 200, {
          scanned: records.length,
          pruned: noisy.length,
          ids: noisy.map((record) => record.id),
          dryRun,
        });
        return;
      }

      reply(res, 404, { error: "unsupported route" });
    } catch (error) {
      reply(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(params.port, "127.0.0.1", () => resolve());
  });
  return server;
}

function upsertRecords(store: MemoryRecord[], incoming: MemoryRecord[]): MemoryWriteResult {
  let written = 0;
  let updated = 0;
  let superseded = 0;
  for (const incomingCandidate of incoming) {
    const candidate = {
      ...incomingCandidate,
      fingerprint: buildMemoryFingerprint(incomingCandidate),
    };
    const existing = store.find((record) => record.active !== false && record.fingerprint === candidate.fingerprint);
    if (existing) {
      Object.assign(existing, mergeRecord(existing, candidate));
      updated += 1;
      continue;
    }
    const groupExisting = candidate.memoryGroup
      ? store.find((record) => record.active !== false && record.memoryGroup === candidate.memoryGroup)
      : undefined;
    if (groupExisting && shouldSupersede(groupExisting, candidate)) {
      groupExisting.active = false;
      groupExisting.supersededAt = new Date().toISOString();
      groupExisting.supersededBy = candidate.id;
      store.push({ ...candidate, version: (groupExisting.version ?? 1) + 1, backend: "remote" });
      written += 1;
      superseded += 1;
      continue;
    }
    if (groupExisting) {
      Object.assign(groupExisting, mergeRecord(groupExisting, candidate));
      updated += 1;
      continue;
    }
    store.push({ ...candidate, backend: "remote" });
    written += 1;
  }
  return {
    candidateCount: incoming.length,
    written,
    updated,
    superseded,
  };
}

function mergeRecord(previous: MemoryRecord, candidate: MemoryRecord): MemoryRecord {
  return {
    ...previous,
    summary: candidate.summary.length >= previous.summary.length ? candidate.summary : previous.summary,
    content: candidate.content.length >= previous.content.length ? candidate.content : previous.content,
    topics: Array.from(new Set([...previous.topics, ...candidate.topics])),
    entityKeys: Array.from(new Set([...previous.entityKeys, ...candidate.entityKeys])),
    salience: Math.max(previous.salience, candidate.salience),
    importance: Math.max(previous.importance ?? 0, candidate.importance ?? 0),
    confidence: Math.max(previous.confidence ?? 0, candidate.confidence ?? 0),
    lastSeenAt: candidate.lastSeenAt,
    sourceTurnIds: Array.from(new Set([...previous.sourceTurnIds, ...candidate.sourceTurnIds])),
    active: true,
    scope: candidate.scope ?? previous.scope,
    scopeKey: candidate.scopeKey ?? previous.scopeKey,
    sensitive: candidate.sensitive ?? previous.sensitive,
    fingerprint: buildMemoryFingerprint({
      kind: previous.kind,
      summary: candidate.summary.length >= previous.summary.length ? candidate.summary : previous.summary,
      content: candidate.content.length >= previous.content.length ? candidate.content : previous.content,
      memoryGroup: candidate.memoryGroup ?? previous.memoryGroup,
    }),
  };
}

function shouldSupersede(previous: MemoryRecord, candidate: MemoryRecord): boolean {
  if (!previous.memoryGroup || previous.memoryGroup !== candidate.memoryGroup) {
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

async function readSpace(filePath: string): Promise<MemoryRecord[]> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as MemoryRecord[];
  } catch {
    return [];
  }
}

async function writeSpace(filePath: string, records: MemoryRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(records, null, 2));
}

async function listSpaces(dataDir: string): Promise<MemorySpaceSummary[]> {
  await fs.mkdir(dataDir, { recursive: true });
  const files = await fs.readdir(dataDir);
  const spaces: MemorySpaceSummary[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(dataDir, file);
    const spaceId = file.replace(/\.json$/, "");
    const records = await readSpace(filePath);
    const active = records.filter((record) => record.active !== false);
    const scopeCounts = active.reduce<Record<string, number>>((summary, record) => {
      const key = record.scope ?? "private";
      summary[key] = (summary[key] ?? 0) + 1;
      return summary;
    }, {});
    spaces.push({
      id: spaceId,
      backend: "recall-http",
      memoryCount: active.length,
      updatedAt: active[0]?.lastSeenAt,
      scopeCounts,
    });
  }
  return spaces.sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function reply(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}
