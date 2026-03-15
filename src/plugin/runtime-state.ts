import { EventStore } from "../profiling/EventStore.js";
import { TurnProfileStore } from "../profiling/TurnProfileStore.js";
import { ContextCompressor } from "../compression/ContextCompressor.js";
import { PromptBuilder } from "../compression/PromptBuilder.js";
import { ToolOutputCompactor } from "../compression/ToolOutputCompactor.js";
import { ToolOutputStore } from "../compression/ToolOutputStore.js";
import { BudgetManager } from "../compression/BudgetManager.js";
import { createEmbeddingProvider } from "../memory/EmbeddingProvider.js";
import { MemoryExtractor } from "../memory/MemoryExtractor.js";
import { MemoryRanker } from "../memory/MemoryRanker.js";
import { MemoryRetriever } from "../memory/MemoryRetriever.js";
import { MemoryStore } from "../memory/MemoryStore.js";
import { SessionStateStore } from "../memory/SessionStateStore.js";
import { PluginDatabase } from "../storage/PluginDatabase.js";
import type {
  ChatTurn,
  CompactedToolResult,
  CompressionResult,
  MetricSource,
  MemoryRecord,
  PluginRunContext,
  PromptBuild,
  SessionState,
  TurnProfile,
} from "../types/domain.js";
import type { ResolvedPluginConfig } from "../config/schema.js";
import { sanitizeIncomingUserText, sanitizeTurnForStorage } from "../shared/safety.js";

export type PluginLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type PendingSessionContext = {
  sessionId: string;
  sessionKey?: string;
  prompt: string;
  promptBuild: PromptBuild;
  state: SessionState;
  memories: MemoryRecord[];
  compression: CompressionResult;
  toolResults: CompactedToolResult[];
  memoryCandidates: number;
  preparedAt: string;
};

type RunContextInternal = PluginRunContext & {
  sessionKey?: string;
  compactedToolResults: CompactedToolResult[];
  compactionEvents: Array<{ phase: "start" | "end"; willRetry?: boolean }>;
  historyMessages: ChatTurn[];
  promptText: string;
  pendingTasks: Array<Promise<unknown>>;
};

export class PluginContainer {
  readonly database: PluginDatabase;
  readonly eventStore: EventStore;
  readonly stateStore: SessionStateStore;
  readonly memoryStore: MemoryStore;
  readonly memoryExtractor: MemoryExtractor;
  readonly memoryRetriever: MemoryRetriever;
  readonly contextCompressor: ContextCompressor;
  readonly promptBuilder: PromptBuilder;
  readonly toolOutputCompactor: ToolOutputCompactor;
  readonly toolOutputStore: ToolOutputStore;
  readonly profileStore: TurnProfileStore;
  readonly logger: PluginLogger;
  readonly config: ResolvedPluginConfig;

  private readonly pendingBySession = new Map<string, PendingSessionContext>();
  private readonly runById = new Map<string, RunContextInternal>();
  private readonly latestRunBySession = new Map<string, string>();

  constructor(config: ResolvedPluginConfig, logger: PluginLogger) {
    this.config = config;
    this.logger = logger;
    this.database = new PluginDatabase(config.databasePath);
    const embeddings = createEmbeddingProvider(config);

    this.eventStore = new EventStore(this.database);
    this.stateStore = new SessionStateStore(this.database);
    this.memoryStore = new MemoryStore(this.database, embeddings, config.memory.dedupeSimilarity);
    this.memoryExtractor = new MemoryExtractor({
      writeThreshold: config.memory.writeThreshold,
      preferenceTtlDays: config.memory.preferenceTtlDays,
      semanticTtlDays: config.memory.semanticTtlDays,
      episodicTtlDays: config.memory.episodicTtlDays,
      sessionStateTtlDays: config.memory.sessionStateTtlDays,
    });
    this.memoryRetriever = new MemoryRetriever(
      this.memoryStore,
      new MemoryRanker(),
      embeddings,
      config.memory.bootTopK,
    );
    this.contextCompressor = new ContextCompressor(
      config.compression.recentTurns,
      config.compression.historySummaryThreshold,
    );
    this.promptBuilder = new PromptBuilder(new BudgetManager());
    this.toolOutputCompactor = new ToolOutputCompactor(config.compression.toolCompactionThresholdChars);
    this.toolOutputStore = new ToolOutputStore(this.database);
    this.profileStore = new TurnProfileStore(this.database);
  }

  async prepareSessionContext(params: {
    sessionId: string;
    sessionKey?: string;
    prompt: string;
    messages: ChatTurn[];
  }): Promise<PendingSessionContext> {
    const cleanedPrompt = sanitizeIncomingUserText(params.prompt);
    const historyMessages = stripCurrentPrompt(params.messages, params.prompt).map((turn) =>
      sanitizeTurnForStorage(turn),
    );
    const preparedAt = new Date().toISOString();

    const state = await this.stateStore.get(params.sessionId);
    const toolResults = await this.toolOutputStore.listRecent(params.sessionId, 6);
    const memories = await this.memoryRetriever.retrieve(cleanedPrompt, this.config.memory.topK, {
        sessionId: params.sessionId,
      });
    const compression = this.contextCompressor.compress(historyMessages, state);
    const promptBuild = this.promptBuilder.build({
      budget: this.config.compression.contextBudget,
      state,
      memories,
      compression,
      recentTurns: compression.keptRecentTurns,
      toolResults,
      userMessage: cleanedPrompt,
      includeCurrentUserMessage: false,
    });

    const pending: PendingSessionContext = {
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      prompt: cleanedPrompt,
      promptBuild,
      state,
      memories,
      compression,
      toolResults,
      memoryCandidates: memories.length,
      preparedAt,
    };

    this.pendingBySession.set(params.sessionId, pending);
    return pending;
  }

  bindRun(params: {
    runId: string;
    sessionId: string;
    sessionKey?: string;
    provider: string;
    model: string;
  }): RunContextInternal | null {
    const pending = this.pendingBySession.get(params.sessionId);
    if (!pending) {
      return null;
    }

    const runContext: RunContextInternal = {
      runId: params.runId,
      sessionId: params.sessionId,
      sessionKey: params.sessionKey ?? pending.sessionKey,
      prompt: pending.promptBuild,
      state: pending.state,
      memories: pending.memories,
      compression: pending.compression,
      toolResults: pending.toolResults,
      compactedToolResults: [],
      memoryCandidates: pending.memoryCandidates,
      memoryWriteCount: 0,
      toolTokensSaved: pending.toolResults.reduce((sum, item) => sum + (item.savedTokens ?? 0), 0),
      provider: params.provider,
      model: params.model,
      usage: undefined,
      compactionEvents: [],
      historyMessages: pending.compression.keptRecentTurns,
      promptText: pending.prompt,
      pendingTasks: [],
      lastUpdatedAt: new Date().toISOString(),
    };

    this.runById.set(params.runId, runContext);
    this.latestRunBySession.set(params.sessionId, params.runId);
    this.pendingBySession.delete(params.sessionId);
    return runContext;
  }

  getRunContext(runId: string): RunContextInternal | null {
    return this.runById.get(runId) ?? null;
  }

  getRunContextBySession(sessionId: string): RunContextInternal | null {
    const runId = this.latestRunBySession.get(sessionId);
    return runId ? this.runById.get(runId) ?? null : null;
  }

  recordToolResult(params: {
    sessionId: string;
    runId?: string;
    toolName: string;
    toolCallId?: string;
    result: unknown;
    error?: string;
    durationMs?: number;
  }): CompactedToolResult {
    const compacted = this.toolOutputCompactor.compact(params.toolName, params.result);
    const enriched: CompactedToolResult = {
      ...compacted,
      sessionId: params.sessionId,
      runId: params.runId,
      toolName: params.toolName,
      toolCallId: params.toolCallId,
      status: params.error ? "failed" : "completed",
      durationMs: params.durationMs,
      error: params.error,
      createdAt: new Date().toISOString(),
      rawPayload: params.result,
      rawTrimmed: true,
    };

    const writeTask = this.toolOutputStore.record({
      sessionId: params.sessionId,
      runId: params.runId,
      toolName: params.toolName,
      compacted: enriched,
      rawPayload: {
        result: params.result,
        error: params.error,
        durationMs: params.durationMs,
      },
    });

    const run = params.runId ? this.getRunContext(params.runId) : null;
    if (run) {
      run.pendingTasks.push(writeTask);
      run.compactedToolResults.push(enriched);
      run.toolTokensSaved += compacted.savedTokens ?? 0;
      run.lastUpdatedAt = new Date().toISOString();
    }

    return enriched;
  }

  noteCompaction(sessionId: string, phase: "start" | "end", willRetry?: boolean): void {
    const run = this.getRunContextBySession(sessionId);
    if (!run) {
      return;
    }
    run.compactionEvents.push({ phase, willRetry });
    run.lastUpdatedAt = new Date().toISOString();
  }

  async finalizeRun(params: {
    sessionId: string;
    success: boolean;
    error?: string;
    durationMs?: number;
    messages: ChatTurn[];
  }): Promise<{ profile: TurnProfile | null; state: SessionState; written: number }> {
    const run = this.getRunContextBySession(params.sessionId);
    const sanitizedMessages = params.messages.map((turn) =>
      sanitizeTurnForStorage(turn, run?.promptText),
    );
    const relevantTurns = buildExtractionTurns(params.sessionId, sanitizedMessages, run);

    for (const turn of sanitizedMessages) {
      await this.eventStore.appendTurn(turn);
    }

    let state = await this.stateStore.get(params.sessionId);
    let candidateCount = 0;
    let written = 0;
    let updated = 0;
    let superseded = 0;

    for (const turn of relevantTurns) {
      const extraction = this.memoryExtractor.extract(turn);
      candidateCount += extraction.candidateCount;
      state = await this.stateStore.applyPatch(params.sessionId, extraction.statePatch);
      if (this.config.memory.autoWrite) {
        const limited = this.memoryExtractor.limit(
          extraction.memories,
          this.config.memory.maxWritesPerTurn,
        );
        const writeResult = await this.memoryStore.upsertMany(limited);
        written += writeResult.written;
        updated += writeResult.updated;
        superseded += writeResult.superseded;
      }
    }

    if (!run) {
      return { profile: null, state, written };
    }

    const promptTokens = run.usage?.input ?? run.prompt.totalEstimatedTokens;
    const promptTokensSource: MetricSource =
      typeof run.usage?.input === "number" ? "exact" : "estimated";
    const outputTokens = run.usage?.output ?? 0;
    await Promise.all(run.pendingTasks);
    const toolTokens = run.compactedToolResults.reduce((sum, item) => sum + item.estimatedTokens, 0);
    const toolTokensSource: MetricSource = toolTokens > 0 ? "estimated" : "exact";
    const toolTokensSavedSource: MetricSource = run.toolTokensSaved > 0 ? "estimated" : "exact";
    const historySummaryTokensSource: MetricSource =
      run.compression.estimatedTokens > 0 ? "estimated" : "exact";
    const compressionSavingsValue =
      (run.compression.savedTokens ?? 0) +
      run.compactedToolResults.reduce((sum, item) => sum + (item.savedTokens ?? 0), 0);
    const compressionSavingsSource: MetricSource =
      compressionSavingsValue > 0 ? "estimated" : "exact";
    const profile: TurnProfile = {
      runId: run.runId,
      sessionId: run.sessionId,
      createdAt: new Date().toISOString(),
      promptTokens,
      promptTokensSource,
      promptBudget: this.config.compression.contextBudget,
      memoryInjected: run.memories.length,
      memoryCandidates: candidateCount,
      memoryWritten: written,
      toolTokens,
      toolTokensSource,
      toolTokensSaved: run.toolTokensSaved,
      toolTokensSavedSource,
      historySummaryTokens: run.compression.estimatedTokens,
      historySummaryTokensSource,
      compressionSavings: compressionSavingsValue,
      compressionSavingsSource,
      retrievalCount: run.memories.length,
    };

    await this.profileStore.record(
      profile,
      this.config.profile.storeDetails
        ? {
            success: params.success,
            error: params.error,
            durationMs: params.durationMs,
            outputTokens,
            promptLayers: run.prompt.layers,
            recalledMemories: run.memories.map((memory) => ({
              id: memory.id,
              kind: memory.kind,
              summary: memory.summary,
              reason: memory.retrievalReason,
              score: memory.score,
            })),
            toolResults: run.compactedToolResults,
            state,
            compactionEvents: run.compactionEvents,
            memoryWrite: {
              written,
              updated,
              superseded,
            },
            metricSources: {
              promptTokens: promptTokensSource,
              toolTokens: toolTokensSource,
              toolTokensSaved: toolTokensSavedSource,
              historySummaryTokens: historySummaryTokensSource,
              compressionSavings: compressionSavingsSource,
            },
          }
        : {
            success: params.success,
            error: params.error,
            durationMs: params.durationMs,
            outputTokens,
            layerCount: run.prompt.layers.length,
            retrievalCount: run.memories.length,
            toolCompactionCount: run.compactedToolResults.length,
            memoryWrite: {
              written,
              updated,
              superseded,
            },
            metricSources: {
              promptTokens: promptTokensSource,
              toolTokens: toolTokensSource,
              toolTokensSaved: toolTokensSavedSource,
              historySummaryTokens: historySummaryTokensSource,
              compressionSavings: compressionSavingsSource,
            },
          },
    );
    await this.profileStore.prune(this.config.profile.retainRuns);
    this.persistSessionRuntime(run.runId, params.sessionId, run.promptText, profile);
    this.runById.delete(run.runId);
    this.latestRunBySession.delete(params.sessionId);

    return { profile, state, written };
  }

  setUsage(runId: string, usage: { input?: number; output?: number; total?: number }): void {
    const run = this.getRunContext(runId);
    if (!run) {
      return;
    }
    run.usage = usage;
    run.lastUpdatedAt = new Date().toISOString();
  }

  clearSession(sessionId: string): void {
    this.pendingBySession.delete(sessionId);
    const runId = this.latestRunBySession.get(sessionId);
    if (runId) {
      this.runById.delete(runId);
      this.latestRunBySession.delete(sessionId);
    }
  }

  private persistSessionRuntime(
    runId: string,
    sessionId: string,
    prompt: string,
    profile: TurnProfile,
  ): void {
    this.database.connection
      .prepare(
        `
          INSERT INTO session_runtime (session_id, last_run_id, last_user_prompt, last_profile_json, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            last_run_id = excluded.last_run_id,
            last_user_prompt = excluded.last_user_prompt,
            last_profile_json = excluded.last_profile_json,
            updated_at = excluded.updated_at
        `,
      )
      .run(sessionId, runId, prompt, JSON.stringify(profile), Date.now());
  }
}

const STATE_KEY = Symbol.for("openclaw-recall.state");

export function getOrCreatePluginContainer(params: {
  config: ResolvedPluginConfig;
  logger: PluginLogger;
}): PluginContainer {
  const globalState = globalThis as typeof globalThis & {
    [STATE_KEY]?: Map<string, PluginContainer>;
  };
  if (!globalState[STATE_KEY]) {
    globalState[STATE_KEY] = new Map();
  }
  const key = params.config.databasePath;
  const existing = globalState[STATE_KEY]?.get(key);
  if (existing) {
    return existing;
  }
  const container = new PluginContainer(params.config, params.logger);
  globalState[STATE_KEY]?.set(key, container);
  return container;
}

function stripCurrentPrompt(messages: ChatTurn[], prompt: string): ChatTurn[] {
  const last = messages.at(-1);
  if (last?.role === "user" && last.text.trim() === prompt.trim()) {
    return messages.slice(0, -1);
  }
  return messages;
}

function buildExtractionTurns(
  sessionId: string,
  messages: ChatTurn[],
  run: RunContextInternal | null,
): ChatTurn[] {
  const turns: ChatTurn[] = [];
  if (run?.promptText?.trim()) {
    turns.push({
      id: `${run.runId}-user`,
      sessionId,
      role: "user",
      text: run.promptText.trim(),
      createdAt: new Date().toISOString(),
    });
  }
  const lastAssistant = [...messages].reverse().find((turn) => turn.role === "assistant");
  if (lastAssistant?.text?.trim()) {
    turns.push(lastAssistant);
  }
  return turns;
}
