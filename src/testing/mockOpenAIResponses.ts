import { sentenceFromText } from "../shared/text.js";
import { sanitizeAssistantOutput } from "../shared/safety.js";

type OpenAIResponsesParams = {
  input?: unknown[];
  instructions?: string;
};

type OpenAIResponseStreamEvent =
  | { type: "response.output_item.added"; item: Record<string, unknown> }
  | { type: "response.function_call_arguments.delta"; delta: string }
  | { type: "response.output_item.done"; item: Record<string, unknown> }
  | {
      type: "response.completed";
      response: {
        status: "completed";
        usage: {
          input_tokens: number;
          output_tokens: number;
          total_tokens: number;
        };
      };
    };

function decodeBodyText(body: unknown): string {
  if (!body) {
    return "";
  }
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString("utf8");
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(body)).toString("utf8");
  }
  return "";
}

function extractInputTexts(input: unknown[]): string {
  return input
    .flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }
      const record = item as Record<string, unknown>;
      const content = record.content;
      if (typeof content === "string") {
        return [content];
      }
      if (!Array.isArray(content)) {
        return [];
      }
      return content.flatMap((block) => {
        if (!block || typeof block !== "object") {
          return [];
        }
        const typed = block as Record<string, unknown>;
        if (typeof typed.text === "string") {
          return [typed.text];
        }
        return [];
      });
    })
    .join("\n");
}

function extractLastUserText(input: unknown[]): string {
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = input[index] as Record<string, unknown> | undefined;
    if (!item || item.role !== "user") {
      continue;
    }
    const content = item.content;
    if (!Array.isArray(content)) {
      continue;
    }
    const text = content
      .flatMap((block) => {
        if (!block || typeof block !== "object") {
          return [];
        }
        const typed = block as Record<string, unknown>;
        if (typed.type === "input_text" && typeof typed.text === "string") {
          return [typed.text];
        }
        if (typeof typed.text === "string") {
          return [typed.text];
        }
        return [];
      })
      .join("\n")
      .trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function extractToolOutput(input: unknown[]): string {
  for (const itemRaw of input) {
    const item = itemRaw as Record<string, unknown> | undefined;
    if (!item || item.type !== "function_call_output") {
      continue;
    }
    return typeof item.output === "string" ? item.output : "";
  }
  return "";
}

function extractSection(text: string, section: string): string {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\n([\\s\\S]*?)(?:\\n\\n[A-Z][A-Z ]+\\n|$)`);
  const tag = section.toLowerCase().replace(/\s+/g, "_");
  const tagRegex = new RegExp(`<${tag}>\\n?([\\s\\S]*?)<\\/${tag}>`, "i");
  return regex.exec(text)?.[1]?.trim() ?? tagRegex.exec(text)?.[1]?.trim() ?? "";
}

function extractPreferenceHints(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => /User prefers|User likes|User dislikes|Chinese responses|concise terminal-first|execution-oriented|structured updates/i.test(line))
        .map((line) => line.replace(/^[-•]\s*/, "").trim()),
    ),
  ).slice(0, 3);
}

function extractMemoryBullets(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => /^[-•]/.test(line) || /(Use these stable user preferences first|Use this current project\/task context if relevant):/i.test(line))
        .flatMap((line) => {
          const cleaned = line
            .replace(/^[-•]\s*/, "")
            .replace(/\[(?:preference|semantic|session_state|episodic)\]\s*/gi, "")
            .replace(/\s*\((?:score|importance|why)[^)]*\)/gi, "")
            .trim();
          if (/(Use these stable user preferences first|Use this current project\/task context if relevant):/i.test(cleaned)) {
            return cleaned
              .replace(/^[^:]+:\s*/i, "")
              .split(/\s+\|\s+/)
              .map((entry) => entry.trim())
              .filter(Boolean);
          }
          return [cleaned];
        })
        .map((line) => line.replace(/^Current task:\s*/i, "").trim())
        .filter(Boolean),
    ),
  ).slice(0, 6);
}

function extractEngramMemoryHints(text: string): string[] {
  const match = /## Memory Context \(Engram\)([\s\S]*?)(?:\n## |\n# Project Context|\n## Workspace|\n## Runtime|$)/i.exec(text);
  if (!match?.[1]) {
    return [];
  }
  return Array.from(
    new Set(
      match[1]
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !/^\[\d+\]\s/.test(line))
        .filter((line) => !/^## /.test(line))
        .filter((line) => !/Use this context naturally/i.test(line))
        .map((line) => line.replace(/\s+\(score:[^)]+\)\s*/i, "").trim()),
    ),
  ).slice(0, 4);
}

function chooseRecallLines(memoryLines: string[], taskLine: string): string[] {
  const preference = memoryLines.filter((line) => /prefers|喜欢|偏|中文|简洁|详细|直接|结构化|执行导向/i.test(line));
  const project = memoryLines.filter((line) => /project|项目|focus|重点|backend|scope|import|task|当前/i.test(line));
  const ordered = Array.from(new Set([...preference, ...project, ...memoryLines]));
  const selected = ordered.slice(0, 3);
  if (taskLine && !selected.some((line) => line === taskLine || line.includes(taskLine))) {
    selected.push(taskLine);
  }
  return selected.slice(0, 3);
}

function buildSseResponse(events: unknown[]): Response {
  const sse = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sse));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function buildTextSse(text: string): Response {
  return buildSseResponse([
    {
      type: "response.output_item.added",
      item: {
        type: "message",
        id: "msg_test_1",
        role: "assistant",
        content: [],
        status: "in_progress",
      },
    },
    {
      type: "response.output_item.done",
      item: {
        type: "message",
        id: "msg_test_1",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    },
    {
      type: "response.completed",
      response: {
        status: "completed",
        usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
      },
    },
  ]);
}

async function buildResponse(params: OpenAIResponsesParams): Promise<Response> {
  const input = Array.isArray(params.input) ? params.input : [];
  const instructionText = typeof params.instructions === "string" ? params.instructions : "";
  if (process.env.OPENCLAW_RECALL_MOCK_DEBUG === "1") {
    process.stderr.write(`[openclaw-recall-mock] ${JSON.stringify(params, null, 2)}\n`);
  }
  const combinedText = [instructionText, extractInputTexts(input)].filter(Boolean).join("\n\n");
  const userText = extractLastUserText(input);
  const toolOutput = extractToolOutput(input);
  const memorySection = extractSection(combinedText, "RELEVANT MEMORY");
  const taskSection = extractSection(combinedText, "TASK STATE");

  if (!toolOutput) {
    const quotedPath = /read\s+"([^"]+)"/i.exec(userText)?.[1];
    if (quotedPath) {
      const argsJson = JSON.stringify({ path: quotedPath });
      return buildSseResponse([
        {
          type: "response.output_item.added",
          item: {
            type: "function_call",
            id: "fc_test_1",
            call_id: "call_test_1",
            name: "read",
            arguments: "",
          },
        },
        { type: "response.function_call_arguments.delta", delta: argsJson },
        {
          type: "response.output_item.done",
          item: {
            type: "function_call",
            id: "fc_test_1",
            call_id: "call_test_1",
            name: "read",
            arguments: argsJson,
          },
        },
        {
          type: "response.completed",
          response: {
            status: "completed",
            usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
          },
        },
      ]);
    }
  }

  if (toolOutput) {
    return buildTextSse(`Read complete. ${sentenceFromText(toolOutput, 180)}`);
  }

  if (/记得|remember/i.test(userText)) {
    const memoryLines = extractMemoryBullets(memorySection);
    const engramLines = extractEngramMemoryHints(combinedText);
    const fallbackMemoryLine = extractPreferenceHints(combinedText)[0] ?? "";
    const taskLine = taskSection
      .split(/\r?\n/)
      .find((line) => line.trim() && !/No active task/i.test(line))
      ?.trim();
    const selected = chooseRecallLines([...memoryLines, ...engramLines], taskLine ?? "");
    const recallSummary =
      selected.length > 1
        ? `我记得这些稳定信息：${selected.join("；")}`
        : selected[0]
          ? `我记得：${selected[0]}`
          : fallbackMemoryLine
            ? `我记得：${fallbackMemoryLine}`
            : "我暂时没有检索到稳定记忆。";

    return buildTextSse(
      sanitizeAssistantOutput(
      [
        recallSummary,
      ]
        .filter(Boolean)
        .join("\n"),
      ),
    );
  }

  if (/以后默认叫我|call me/i.test(userText)) {
    return buildTextSse(sanitizeAssistantOutput(`已记录。我会按你的偏好处理，并在后续 session 中继续使用。`));
  }

  if (/目标|goal|build/i.test(userText) && taskSection) {
    return buildTextSse(sanitizeAssistantOutput(`收到。我会按这个任务状态继续推进：${sentenceFromText(taskSection, 160)}`));
  }

  return buildTextSse(sanitizeAssistantOutput(`OpenClaw Recall is active. ${sentenceFromText(userText, 160)}`));
}

export function installOpenAiResponsesMock(params?: { baseUrl?: string }) {
  const originalFetch = globalThis.fetch;
  const baseUrl = params?.baseUrl ?? "https://api.openai.com/v1";
  const responsesUrl = `${baseUrl.replace(/\/$/, "")}/responses`;
  const isResponsesRequest = (url: string) =>
    url === responsesUrl ||
    url.startsWith(`${responsesUrl}/`) ||
    url.startsWith(`${responsesUrl}?`);

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (isResponsesRequest(url)) {
      const bodyText =
        typeof (init as { body?: unknown } | undefined)?.body !== "undefined"
          ? decodeBodyText((init as { body?: unknown }).body)
          : input instanceof Request
            ? await input.clone().text()
            : "";
      const parsed = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
      const inputItems = Array.isArray(parsed.input) ? parsed.input : [];
      return await buildResponse({ input: inputItems });
    }

    if (url.startsWith(baseUrl)) {
      throw new Error(`unexpected OpenAI request in mock mode: ${url}`);
    }

    if (!originalFetch) {
      throw new Error(`fetch is not available (url=${url})`);
    }
    return await originalFetch(input, init);
  };

  (globalThis as unknown as { fetch?: unknown }).fetch = fetchImpl;
  return {
    baseUrl,
    restore: () => {
      (globalThis as unknown as { fetch?: unknown }).fetch = originalFetch;
    },
  };
}
