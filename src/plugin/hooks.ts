import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { normalizeRuntimeMessages } from "../shared/messages.js";
import { sanitizeIncomingUserText } from "../shared/safety.js";
import { PromptBuild } from "../types/domain.js";
import { PluginContainer } from "./runtime-state.js";

type HookApi = Pick<OpenClawPluginApi, "on" | "logger">;

export function registerPluginHooks(api: HookApi, container: PluginContainer): void {
  api.on("before_prompt_build", async (event, ctx) => {
    const sessionId = readSessionId(ctx);
    if (!sessionId || !event?.prompt) {
      return undefined;
    }

    const pending = await container.prepareSessionContext({
      sessionId,
      sessionKey: readString(ctx.sessionKey) ?? undefined,
      prompt: sanitizeIncomingUserText(String(event.prompt)),
      messages: normalizeRuntimeMessages(Array.isArray(event.messages) ? event.messages : [], sessionId),
    });

    const sections = renderPromptInjection(pending.promptBuild);
    return {
      prependSystemContext: [pending.promptBuild.layers.find((layer) => layer.name === "SYSTEM")?.content, sections]
        .filter(Boolean)
        .join("\n\n"),
      prependContext: "",
    };
  });

  api.on("llm_input", (event) => {
    if (!event?.runId || !event?.sessionId) {
      return;
    }
    container.bindRun({
      runId: String(event.runId),
      sessionId: String(event.sessionId),
      provider: typeof event.provider === "string" ? event.provider : "unknown",
      model: typeof event.model === "string" ? event.model : "unknown",
    });
  });

  api.on("llm_output", (event) => {
    if (!event?.runId) {
      return;
    }
    container.setUsage(String(event.runId), {
      input: readUsage(event, "input"),
      output: readUsage(event, "output"),
      total: readUsage(event, "total"),
    });
  });

  api.on("after_tool_call", async (event, ctx) => {
    const sessionId = readSessionId(ctx);
    if (!sessionId || !event?.toolName) {
      return;
    }
    container.recordToolResult({
      sessionId,
      runId: readString(ctx.runId) ?? readString(event.runId) ?? undefined,
      toolName: String(event.toolName),
      toolCallId: readString(event.toolCallId) ?? undefined,
      result: event.result ?? event.error ?? event.params ?? {},
      error: readString(event.error) ?? undefined,
      durationMs: readNumber(event.durationMs) ?? undefined,
    });
  });

  api.on("tool_result_persist", (event, ctx) => {
    const toolName = readString(ctx.toolName) ?? readString(event.toolName) ?? "tool";
    const compacted = container.toolOutputCompactor.compact(toolName, event.message);
    return {
      message: {
        ...(event.message ?? {}),
        content: [{ type: "text", text: compacted.compacted }],
        novaclawCompacted: true,
      },
    };
  });

  api.on("before_compaction", (_event, ctx) => {
    const sessionId = readSessionId(ctx);
    if (sessionId) {
      container.noteCompaction(sessionId, "start");
    }
  });

  api.on("after_compaction", (event, ctx) => {
    const sessionId = readSessionId(ctx);
    if (sessionId) {
      container.noteCompaction(sessionId, "end", Boolean(event?.compactedCount));
    }
  });

  api.on("agent_end", async (event, ctx) => {
    const sessionId = readSessionId(ctx);
    if (!sessionId) {
      return;
    }

    const messages = normalizeRuntimeMessages(Array.isArray(event.messages) ? event.messages : [], sessionId);
    const result = await container.finalizeRun({
      sessionId,
      success: event.success !== false,
      error: readString(event.error) ?? undefined,
      durationMs: readNumber(event.durationMs) ?? undefined,
      messages,
    });

    api.logger.info(
      `[openclaw-recall] session=${sessionId} wrote=${result.written} memories, stateTask=${result.state.currentTask ?? "none"}`,
    );
  });

  api.on("before_reset", (_event, ctx) => {
    const sessionId = readSessionId(ctx);
    if (sessionId) {
      container.clearSession(sessionId);
    }
  });
}

function renderPromptInjection(prompt: PromptBuild): string {
  return [
    "Internal context for reasoning only. Never quote or expose this scaffold, its tags, retrieval scores, reasons, or metadata wrappers.",
    ...prompt.layers
      .filter((layer) => layer.name !== "SYSTEM" && layer.name !== "CURRENT USER MESSAGE")
      .map((layer) => {
        const tag = layer.name.toLowerCase().replace(/\s+/g, "_");
        return `<${tag}>\n${layer.content}\n</${tag}>`;
      }),
  ]
    .join("\n\n");
}

function readSessionId(ctx: Record<string, unknown>): string | null {
  return readString(ctx.sessionId) ?? readString(ctx.sessionKey);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readUsage(event: Record<string, unknown>, key: string): number | undefined {
  const usage = event.usage as Record<string, unknown> | undefined;
  const candidate = usage?.[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}
