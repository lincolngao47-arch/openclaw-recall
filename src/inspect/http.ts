import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { PluginContainer } from "../plugin/runtime-state.js";
import { renderDashboard } from "./dashboard.js";

export function createInspectHttpHandler(params: {
  basePath: string;
  container: PluginContainer;
}) {
  const basePath = params.basePath.replace(/\/$/, "");

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname.replace(/\/$/, "") || "/";
    if (!pathname.startsWith(basePath)) {
      return false;
    }

    if (pathname === basePath || pathname === `${basePath}/dashboard` || pathname === `${basePath}/notes`) {
      const sessions = await params.container.eventStore.listSessions(20);
      const memories = await params.container.memoryStore.listAll();
      const profiles = await params.container.profileStore.list(20);
      sendHtml(
        res,
        renderDashboard({
          basePath,
          sessions,
          memories,
          profiles,
        }),
      );
      return true;
    }

    if (pathname === `${basePath}/status`) {
      sendJson(res, 200, {
        ok: true,
        databasePath: params.container.database.path,
        memoryCount: (await params.container.memoryStore.listActive()).length,
        profileCount: (await params.container.profileStore.list(100)).length,
      });
      return true;
    }

    if (pathname === `${basePath}/memories`) {
      const query = url.searchParams.get("q")?.trim();
      const sessionId = url.searchParams.get("sessionId")?.trim() || undefined;
      const includeInactive = url.searchParams.get("includeInactive") === "1";
      if (query) {
        sendJson(res, 200, await params.container.memoryRetriever.explain(query, 10, { sessionId }));
      } else {
        sendJson(
          res,
          200,
          includeInactive
            ? await params.container.memoryStore.listAll()
            : await params.container.memoryStore.listActive(),
        );
      }
      return true;
    }

    if (pathname.startsWith(`${basePath}/memories/`)) {
      const id = pathname.slice(`${basePath}/memories/`.length);
      const memory = await params.container.memoryStore.getById(id);
      sendJson(res, memory ? 200 : 404, memory ?? { error: "Memory not found" });
      return true;
    }

    if (pathname === `${basePath}/profiles`) {
      sendJson(res, 200, await params.container.profileStore.list(50));
      return true;
    }

    if (pathname.startsWith(`${basePath}/profiles/`)) {
      const runId = pathname.slice(`${basePath}/profiles/`.length);
      const profile = await params.container.profileStore.get(runId);
      sendJson(res, profile ? 200 : 404, profile ?? { error: "Profile not found" });
      return true;
    }

    if (pathname === `${basePath}/sessions`) {
      sendJson(res, 200, await params.container.eventStore.listSessions(50));
      return true;
    }

    if (pathname.startsWith(`${basePath}/sessions/`)) {
      const sessionId = pathname.slice(`${basePath}/sessions/`.length);
      const summary = await params.container.eventStore.getSessionSummary(sessionId);
      if (!summary) {
        sendJson(res, 404, { error: "Session not found" });
        return true;
      }
      sendJson(res, 200, {
        summary,
        state: await params.container.stateStore.get(sessionId),
        transcript: await params.container.eventStore.listTurns(sessionId),
        toolResults: await params.container.toolOutputStore.listSession(sessionId, 25),
        profiles: await params.container.profileStore.list(25, { sessionId }),
      });
      return true;
    }

    sendJson(res, 404, { error: "Not found" });
    return true;
  };
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

function sendHtml(res: ServerResponse, payload: string): void {
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(payload);
}
