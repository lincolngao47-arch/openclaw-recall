import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, readJsonFile, writeJsonFile } from "../shared/fileStore.js";
import { fingerprint, tokenize } from "../shared/text.js";
import { sanitizeIncomingUserText, shouldSuppressMemory } from "../shared/safety.js";
import type {
  ChatTurn,
  ImportFileReport,
  ImportJobReport,
  MemoryRecord,
  MemoryScope,
} from "../types/domain.js";
import type { PluginContainer } from "../plugin/runtime-state.js";
import type { ResolvedPluginConfig } from "../config/schema.js";
import { resolvePluginPaths } from "../storage/paths.js";
import { assignMemoryScope } from "../memory/scopes.js";

export class ImportService {
  private readonly paths = resolvePluginPaths();

  constructor(
    private readonly container: PluginContainer,
    private readonly config: ResolvedPluginConfig,
    private readonly cwd: string = process.cwd(),
  ) {}

  async dryRun(extraRoots: string[] = []): Promise<ImportJobReport> {
    return await this.execute("dry-run", extraRoots, {});
  }

  async run(extraRoots: string[] = [], options: { scopeMapping?: Partial<Record<MemoryRecord["kind"], MemoryScope>> } = {}): Promise<ImportJobReport> {
    return await this.execute("run", extraRoots, options);
  }

  async dryRunWithOptions(
    extraRoots: string[] = [],
    options: { scopeMapping?: Partial<Record<MemoryRecord["kind"], MemoryScope>> } = {},
  ): Promise<ImportJobReport> {
    return await this.execute("dry-run", extraRoots, options);
  }

  async status(): Promise<ImportJobReport | null> {
    return await readJsonFile<ImportJobReport | null>(this.paths.latestImportPath, null);
  }

  private async execute(
    mode: "dry-run" | "run",
    extraRoots: string[],
    options: { scopeMapping?: Partial<Record<MemoryRecord["kind"], MemoryScope>> },
  ): Promise<ImportJobReport> {
    const roots = await this.resolveRoots(extraRoots);
    const files = await scanRoots(roots, this.config.imports.maxFiles);
    const job: ImportJobReport = {
      jobId: crypto.randomUUID(),
      mode,
      createdAt: new Date().toISOString(),
      status: "planned",
      rootPaths: roots,
      scannedFiles: files.length,
      processedFiles: 0,
      imported: 0,
      merged: 0,
      superseded: 0,
      skippedDuplicates: 0,
      rejectedNoise: 0,
      rejectedSensitive: 0,
      uncertainCandidates: 0,
      files: [],
      notes: [],
      scopeMapping: {
        preference: "private",
        semantic:
          this.config.identity.mode === "shared" && this.config.identity.sharedScope ? "shared" : "workspace",
        session_state: "session",
        episodic: "private",
        ...options.scopeMapping,
      },
      scopeCounts: {},
    };

    if (mode === "run") {
      await ensureDir(this.paths.importsDir);
      const snapshotPath = path.join(this.paths.importsDir, `${job.jobId}-snapshot.json`);
      await writeJsonFile(snapshotPath, await this.container.memoryStore.listActive());
      job.snapshotPath = snapshotPath;
      job.notes.push("Snapshot written before import so the previous memory state can be restored manually.");
    }

    for (const filePath of files) {
      const fileReport = await this.processFile(filePath, mode, job.scopeMapping ?? {});
      job.files.push(fileReport);
      job.processedFiles += 1;
      job.imported += fileReport.imported;
      job.merged += fileReport.merged;
      job.superseded += fileReport.superseded;
      job.skippedDuplicates += fileReport.skipped;
      job.rejectedNoise += fileReport.rejected;
      job.rejectedSensitive += fileReport.rejectedSensitive;
      job.uncertainCandidates += fileReport.uncertain;
      for (const [scope, count] of Object.entries(fileReport.scopeCounts ?? {})) {
        if (count) {
          job.scopeCounts![scope as MemoryScope] = (job.scopeCounts![scope as MemoryScope] ?? 0) + count;
        }
      }
    }

    job.completedAt = new Date().toISOString();
    job.status = job.files.some((file) => file.status === "failed") ? "failed" : "completed";
    if (mode === "dry-run") {
      job.notes.push("Dry-run does not write any memory rows.");
    }

    await ensureDir(this.paths.importsDir);
    await writeJsonFile(path.join(this.paths.importsDir, `${job.jobId}.json`), job);
    await writeJsonFile(this.paths.latestImportPath, job);
    return job;
  }

  private async resolveRoots(extraRoots: string[]): Promise<string[]> {
    const defaults = this.config.imports.defaultRoots.map((root) =>
      path.resolve(this.cwd, root),
    );
    const pluginArtifacts = [this.paths.pluginRoot, this.paths.exportsDir];
    return Array.from(new Set([...defaults, ...pluginArtifacts, ...extraRoots.map((root) => path.resolve(this.cwd, root))]));
  }

  private async processFile(
    filePath: string,
    mode: "dry-run" | "run",
    scopeMapping: Record<string, MemoryScope>,
  ): Promise<ImportFileReport> {
    const kind = classifyPath(filePath);
    try {
      const { candidates, rejectedByNormalization } = await this.readCandidates(filePath, kind);
      const filtered = candidates
        .map((candidate) =>
          applyImportScopeMapping(
            assignMemoryScope(candidate, this.config, candidate.sourceSessionId),
            scopeMapping,
          ),
        )
        .filter((candidate) => !shouldSuppressMemory(candidate));
      const rejected = rejectedByNormalization + (candidates.length - filtered.length);
      if (mode === "dry-run") {
        const scopeCounts = summarizeScopes(filtered);
        return {
          path: filePath,
          kind,
          status: filtered.length > 0 ? "imported" : rejected > 0 ? "rejected" : "skipped",
          imported: filtered.length,
          merged: 0,
          superseded: 0,
          skipped: 0,
          rejected,
          rejectedSensitive: 0,
          uncertain: 0,
          scopeCounts,
        };
      }

      const result = await this.container.memoryStore.upsertMany(filtered);
      const scopeCounts = summarizeScopes(filtered);
      return {
        path: filePath,
        kind,
        status: filtered.length > 0 ? "imported" : rejected > 0 ? "rejected" : "skipped",
        imported: result.written + result.superseded,
        merged: result.updated,
        superseded: result.superseded,
        skipped: result.updated,
        rejected,
        rejectedSensitive: 0,
        uncertain: 0,
        scopeCounts,
      };
    } catch (error) {
      return {
        path: filePath,
        kind,
        status: "failed",
        imported: 0,
        merged: 0,
        superseded: 0,
        skipped: 0,
        rejected: 0,
        rejectedSensitive: 0,
        uncertain: 0,
        scopeCounts: {},
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async readCandidates(
    filePath: string,
    kind: ImportFileReport["kind"],
  ): Promise<{ candidates: MemoryRecord[]; rejectedByNormalization: number }> {
    if (filePath.endsWith(".jsonl")) {
      return await this.readTranscriptJsonl(filePath);
    }

    const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    if (kind === "memory") {
      return normalizeMemoryObjects(raw);
    }
    return normalizeSessionObjects(raw, this.container);
  }

  private async readTranscriptJsonl(filePath: string): Promise<{ candidates: MemoryRecord[]; rejectedByNormalization: number }> {
    const raw = await fs.readFile(filePath, "utf8");
    const turns = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    return normalizeTurnsIntoMemories(turns, this.container);
  }
}

function summarizeScopes(records: MemoryRecord[]): Partial<Record<MemoryScope, number>> {
  return records.reduce<Partial<Record<MemoryScope, number>>>((summary, record) => {
    const scope = record.scope;
    if (scope) {
      summary[scope] = (summary[scope] ?? 0) + 1;
    }
    return summary;
  }, {});
}

function applyImportScopeMapping(
  memory: MemoryRecord,
  scopeMapping: Record<string, MemoryScope>,
): MemoryRecord {
  const mappedScope = scopeMapping[memory.kind];
  if (!mappedScope || mappedScope === memory.scope) {
    return memory;
  }
  return {
    ...memory,
    scope: mappedScope,
    scopeKey: undefined,
  };
}

function classifyPath(filePath: string): ImportFileReport["kind"] {
  const normalized = filePath.toLowerCase();
  const base = path.basename(normalized);
  if (normalized.includes("/memories/")) {
    return "memory";
  }
  if (base.startsWith("memory-")) {
    return "memory";
  }
  if (normalized.endsWith(".jsonl")) {
    return "transcript";
  }
  if (normalized.includes("/sessions/")) {
    return "session";
  }
  if (base.startsWith("session-")) {
    return "session";
  }
  if (normalized.includes("/plugins/openclaw-recall") || normalized.includes("/exports/")) {
    return "artifact";
  }
  return "unknown";
}

async function scanRoots(roots: string[], maxFiles: number): Promise<string[]> {
  const results: Array<{ path: string; mtimeMs: number }> = [];
  for (const root of roots) {
    await walk(root, results, maxFiles);
    if (results.length >= maxFiles) {
      break;
    }
  }
  return results
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, maxFiles)
    .map((entry) => entry.path);
}

async function walk(root: string, results: Array<{ path: string; mtimeMs: number }>, maxFiles: number): Promise<void> {
  try {
    const stat = await fs.stat(root);
    if (stat.isFile()) {
      if (/\.(json|jsonl)$/i.test(root)) {
        results.push({ path: root, mtimeMs: stat.mtimeMs });
      }
      return;
    }
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxFiles) {
        return;
      }
      if (entry.name.startsWith(".") && entry.name !== ".exports") {
        continue;
      }
      await walk(path.join(root, entry.name), results, maxFiles);
    }
  } catch {
    return;
  }
}

function normalizeMemoryObjects(raw: unknown): { candidates: MemoryRecord[]; rejectedByNormalization: number } {
  const list = Array.isArray(raw) ? raw : typeof raw === "object" && raw ? [raw] : [];
  const candidates: MemoryRecord[] = [];
  let rejectedByNormalization = 0;
  for (const entry of list) {
    const record = entry as Record<string, unknown>;
    const summary = String(record.summary ?? record.title ?? "").trim();
    const content = String(record.content ?? summary).trim();
    if (!summary || !content) {
      rejectedByNormalization += 1;
      continue;
    }
    const kind = normalizeKind(String(record.kind ?? "semantic"));
    const text = sanitizeIncomingUserText(content);
    if (!text) {
      rejectedByNormalization += 1;
      continue;
    }
    candidates.push(buildMemoryRecord(kind, summary, text, String(record.sourceSessionId ?? "imported-memory")));
  }
  return { candidates, rejectedByNormalization };
}

function normalizeSessionObjects(
  raw: unknown,
  container: PluginContainer,
): { candidates: MemoryRecord[]; rejectedByNormalization: number } {
  if (!raw || typeof raw !== "object") {
    return { candidates: [], rejectedByNormalization: 0 };
  }
  const record = raw as Record<string, unknown>;
  const turns = Array.isArray(record.turns)
    ? record.turns
    : Array.isArray(record.messages)
      ? record.messages
    : Array.isArray(record.transcript)
        ? record.transcript
        : [];
  return normalizeTurnsIntoMemories(turns as Array<Record<string, unknown>>, container);
}

function normalizeTurnsIntoMemories(
  turns: Array<Record<string, unknown>>,
  container: PluginContainer,
): { candidates: MemoryRecord[]; rejectedByNormalization: number } {
  const imported: MemoryRecord[] = [];
  let rejectedByNormalization = 0;
  for (const turn of turns) {
    const role = normalizeRole(turn.role);
    if (!role) {
      rejectedByNormalization += 1;
      continue;
    }
    const text = sanitizeIncomingUserText(String(turn.text ?? turn.content ?? ""));
    if (!text) {
      rejectedByNormalization += 1;
      continue;
    }
    const extracted = container.memoryExtractor.extract({
      id: String(turn.id ?? crypto.randomUUID()),
      sessionId: String(turn.sessionId ?? turn.session_id ?? "imported-session"),
      role,
      text,
      createdAt: String(turn.createdAt ?? turn.created_at ?? new Date().toISOString()),
    } as ChatTurn);
    imported.push(...container.memoryExtractor.limit(extracted.memories, 6));
  }
  return { candidates: imported, rejectedByNormalization };
}

function normalizeRole(value: unknown): ChatTurn["role"] | null {
  if (value === "user" || value === "assistant" || value === "tool" || value === "system") {
    return value;
  }
  return null;
}

function normalizeKind(value: string): MemoryRecord["kind"] {
  if (value === "preference" || value === "semantic" || value === "session_state" || value === "episodic") {
    return value;
  }
  return "semantic";
}

function buildMemoryRecord(
  kind: MemoryRecord["kind"],
  summary: string,
  content: string,
  sourceSessionId: string,
): MemoryRecord {
  const now = new Date().toISOString();
  const normalizedSummary = sanitizeIncomingUserText(summary) || summary.trim();
  const topics = tokenize(`${normalizedSummary} ${content}`).slice(0, 24);
  return {
    id: crypto.randomUUID(),
    kind,
    summary: normalizedSummary,
    content,
    topics,
    entityKeys: topics.slice(0, 12),
    salience: kind === "preference" ? 8.5 : kind === "session_state" ? 7.2 : 6.8,
    fingerprint: fingerprint(`${kind}:${normalizedSummary}`),
    createdAt: now,
    lastSeenAt: now,
    ttlDays: kind === "episodic" ? 14 : kind === "session_state" ? 21 : 180,
    decayRate: kind === "episodic" ? 0.18 : 0.06,
    confidence: 0.82,
    importance: kind === "preference" ? 8.8 : 7.1,
    active: true,
    sourceSessionId,
    sourceTurnIds: [sourceSessionId],
  };
}
