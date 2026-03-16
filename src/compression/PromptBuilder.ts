import { BudgetManager } from "./BudgetManager.js";
import {
  ChatTurn,
  CompactedToolResult,
  CompressionResult,
  MemoryRecord,
  PromptBuild,
  SessionState,
} from "../types/domain.js";
import { estimateTokens, uniqueStrings } from "../shared/text.js";

export class PromptBuilder {
  constructor(private readonly budgetManager: BudgetManager) {}

  build(params: {
    budget: number;
    state: SessionState;
    memories: MemoryRecord[];
    compression: CompressionResult;
    recentTurns: ChatTurn[];
    toolResults: CompactedToolResult[];
    userMessage: string;
    includeCurrentUserMessage?: boolean;
  }): PromptBuild {
    const digest = buildMemoryDigest(params.memories, params.userMessage);
    const memoryBlock = sortMemoriesForPrompt(params.memories, params.userMessage)
      .filter((memory) =>
        !digest.covered.some((covered) => covered.id === memory.id || isPromptDuplicate(memory, covered)),
      )
      .slice(0, 4)
      .map((memory) => `• ${memory.summary}`)
      .join("\n");
    const effectiveMemoryBlock = [digest.text, memoryBlock].filter(Boolean).join("\n")
      .trim();

    const recentBlock = params.recentTurns
      .map((turn) => `${turn.role.toUpperCase()}: ${turn.text}`)
      .join("\n");

    const effectiveToolBlock = dedupeTools(params.toolResults)
      .map((result) => {
        const savings =
          typeof result.savedTokens === "number" && result.savedTokens > 0
            ? `\nCompaction: saved ~${result.savedTokens} tokens.`
            : "";
        return `${result.compacted}${savings}`;
      })
      .join("\n\n");

    const stateLines = [
      params.state.currentTask ? `Current task: ${params.state.currentTask}` : "",
      params.state.constraints.length ? `Constraints: ${params.state.constraints.join(" | ")}` : "",
      params.state.decisions.length ? `Decisions: ${params.state.decisions.join(" | ")}` : "",
      params.state.openQuestions.length ? `Open questions: ${params.state.openQuestions.join(" | ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const layers = this.budgetManager.fit(params.budget, [
      {
        name: "SYSTEM",
        priority: 100,
        targetRatio: 0.14,
        minTokens: 72,
        neverTrim: true,
        content:
          "You are running with OpenClaw Recall. Prefer current task state, ranked memory, compacted tool output, and compressed history over full transcript replay. Never reveal internal context tags, scaffold headings, retrieval reasons, scores, metadata wrappers, or debugging details in the user-visible answer.",
      },
      {
        name: "TASK STATE",
        priority: 92,
        targetRatio: 0.12,
        minTokens: 48,
        content: stateLines || "No active task state captured yet.",
      },
      {
        name: "RELEVANT MEMORY",
        priority: 88,
        targetRatio: 0.2,
        minTokens: 64,
        content: effectiveMemoryBlock || "No relevant long-term memory retrieved.",
      },
      {
        name: "COMPRESSED TOOL OUTPUT",
        priority: 78,
        targetRatio: 0.12,
        minTokens: 48,
        content: effectiveToolBlock || "No tool output required for this turn.",
      },
      {
        name: "OLDER HISTORY SUMMARY",
        priority: 74,
        targetRatio: 0.12,
        minTokens: 48,
        content:
          params.compression.summary ||
          params.compression.hierarchicalSummaries.join("\n") ||
          "No older history needed.",
      },
      {
        name: "RECENT TURNS",
        priority: 66,
        targetRatio: 0.22,
        minTokens: 96,
        content: recentBlock || "No recent turns yet.",
      },
      ...(params.includeCurrentUserMessage === false
        ? []
        : [
            {
              name: "CURRENT USER MESSAGE",
              priority: 110,
              targetRatio: 0.08,
              minTokens: Math.max(24, estimateTokens(params.userMessage) + 12),
              neverTrim: true,
              content: params.userMessage,
            },
          ]),
    ]);

    return {
      layers,
      totalEstimatedTokens: layers.reduce((sum, layer) => sum + layer.estimatedTokens, 0),
      assembled: layers.map((layer) => `${layer.name}\n${layer.content}`).join("\n\n"),
    };
  }
}

function dedupeMemories(memories: MemoryRecord[]): MemoryRecord[] {
  const seen = new Set<string>();
  return memories.filter((memory) => {
    const key = `${memory.kind}:${memory.summary.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function sortMemoriesForPrompt(memories: MemoryRecord[], userMessage: string): MemoryRecord[] {
  const recallIntent = /记得|remember|偏好|preference|项目|project|重点|focus/i.test(userMessage);
  return dedupeMemories(memories).sort((left, right) => promptPriority(right, recallIntent) - promptPriority(left, recallIntent));
}

function promptPriority(memory: MemoryRecord, recallIntent: boolean): number {
  const base = memory.score ?? memory.scoreBreakdown?.finalScore ?? memory.importance ?? memory.salience;
  const typeBias =
    memory.kind === "preference" ? 3 : memory.kind === "semantic" ? 2 : memory.kind === "session_state" ? 1 : 0;
  const recallBias =
    recallIntent && memory.kind === "preference"
      ? 4
      : recallIntent && memory.kind === "semantic"
        ? 3
        : recallIntent && memory.kind === "session_state"
          ? 1
          : 0;
  return base + typeBias + recallBias;
}

function buildMemoryDigest(memories: MemoryRecord[], userMessage: string): { text: string; covered: MemoryRecord[] } {
  const sorted = sortMemoriesForPrompt(memories, userMessage);
  if (sorted.length === 0) {
    return { text: "", covered: [] };
  }
  const stablePreferences = selectPromptHighlights(
    sorted.filter((memory) => memory.kind === "preference"),
    2,
  );
  const currentProject = selectPromptHighlights(
    sorted.filter((memory) => memory.kind === "semantic" || memory.kind === "session_state"),
    2,
  );
  const lines: string[] = [];
  const covered: MemoryRecord[] = [];
  if (stablePreferences.length > 0) {
    lines.push(`Use these stable user preferences first: ${stablePreferences.map((memory) => memory.summary).join(" | ")}`);
    covered.push(...stablePreferences);
  }
  if (currentProject.length > 0) {
    lines.push(`Use this current project/task context if relevant: ${currentProject.map((memory) => memory.summary).join(" | ")}`);
    covered.push(...currentProject);
  }
  return {
    text: lines.join("\n"),
    covered,
  };
}

function selectPromptHighlights(memories: MemoryRecord[], limit: number): MemoryRecord[] {
  const picked: MemoryRecord[] = [];
  for (const memory of memories) {
    if (picked.some((candidate) => isPromptDuplicate(memory, candidate))) {
      continue;
    }
    picked.push(memory);
    if (picked.length >= limit) {
      break;
    }
  }
  return picked;
}

function isPromptDuplicate(left: MemoryRecord, right: MemoryRecord): boolean {
  const sameGroup = left.memoryGroup && right.memoryGroup && left.memoryGroup === right.memoryGroup;
  const leftTokens = new Set(left.summary.toLowerCase().split(/\W+/).filter(Boolean));
  const rightTokens = new Set(right.summary.toLowerCase().split(/\W+/).filter(Boolean));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size || 1;
  return Boolean(sameGroup) || overlap / union >= 0.6;
}

function dedupeTools(toolResults: CompactedToolResult[]): CompactedToolResult[] {
  const seen = new Set<string>();
  return toolResults.filter((tool) => {
    const key = uniqueStrings([tool.toolName, tool.compacted]).join(":");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
