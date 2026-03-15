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
    const memoryBlock = dedupeMemories(params.memories)
      .map((memory) => `• ${memory.summary}`)
      .join("\n");

    const recentBlock = params.recentTurns
      .map((turn) => `${turn.role.toUpperCase()}: ${turn.text}`)
      .join("\n");

    const toolBlock = dedupeTools(params.toolResults)
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
        content: memoryBlock || "No relevant long-term memory retrieved.",
      },
      {
        name: "COMPRESSED TOOL OUTPUT",
        priority: 78,
        targetRatio: 0.12,
        minTokens: 48,
        content: toolBlock || "No tool output required for this turn.",
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
