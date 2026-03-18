import type { MemoryRecord, SessionSummary, StoredTurnProfile } from "../types/domain.js";

export function renderDashboard(params: {
  basePath: string;
  sessions: SessionSummary[];
  memories: MemoryRecord[];
  profiles: StoredTurnProfile[];
}): string {
  const memories = [...params.memories].sort((left, right) => {
    const leftStatus = memoryStatusRank(left);
    const rightStatus = memoryStatusRank(right);
    if (leftStatus !== rightStatus) {
      return leftStatus - rightStatus;
    }
    return (right.lastSeenAt ?? right.createdAt).localeCompare(left.lastSeenAt ?? left.createdAt);
  });
  const summary = {
    memoryCount: memories.length,
    activeMemoryCount: memories.filter((memory) => memory.active !== false).length,
    preferenceCount: memories.filter((memory) => memory.kind === "preference" && memory.active !== false).length,
    semanticCount: memories.filter((memory) => memory.kind === "semantic" && memory.active !== false).length,
    sessionCount: params.sessions.length,
    profileCount: params.profiles.length,
  };
  const sessionCards = params.sessions
    .slice(0, 8)
    .map(
      (session) => `
        <article class="session-card">
          <div class="session-topline">
            <span class="session-title">${escapeHtml(session.title)}</span>
            <span class="chip muted">${escapeHtml(session.lastRole ?? "n/a")}</span>
          </div>
          <p>${escapeHtml(session.preview || "No preview yet.")}</p>
          <div class="session-meta">
            <span>${escapeHtml(session.sessionId)}</span>
            <span>${escapeHtml(session.updatedAt)}</span>
          </div>
        </article>`,
    )
    .join("");
  const profileRows = params.profiles
    .slice(0, 10)
    .map(
      (profile) => `
        <tr>
          <td>${escapeHtml(profile.runId)}</td>
          <td>${escapeHtml(profile.retrievalMode)}</td>
          <td>${profile.retrievalCount}</td>
          <td>${profile.memoryWritten}</td>
          <td>${profile.compressionSavings} <code>${profile.compressionSavingsSource}</code></td>
        </tr>`,
    )
    .join("");
  const memoryData = serializeForScript({
    basePath: params.basePath,
    memories: memories.map((memory) => ({
      ...memory,
      status: classifyMemoryStatus(memory),
    })),
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenClaw Recall</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4efe6;
      --paper: rgba(255, 250, 242, 0.9);
      --paper-strong: #fffaf2;
      --ink: #161311;
      --muted: #685f56;
      --line: rgba(76, 59, 42, 0.16);
      --accent: #0f7663;
      --accent-soft: rgba(15, 118, 99, 0.12);
      --gold: #b7791f;
      --shadow: 0 24px 60px rgba(34, 25, 12, 0.12);
      --radius: 24px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Avenir Next", "IBM Plex Sans", "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(15, 118, 99, 0.14), transparent 28%),
        radial-gradient(circle at top right, rgba(183, 121, 31, 0.12), transparent 24%),
        linear-gradient(180deg, #fff8ef 0%, var(--bg) 55%, #efe5d8 100%);
    }
    main {
      max-width: 1380px;
      margin: 0 auto;
      padding: 32px 20px 56px;
    }
    .hero {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 32px;
      padding: 28px;
      background:
        linear-gradient(135deg, rgba(255,255,255,0.84), rgba(255,248,239,0.72)),
        linear-gradient(120deg, rgba(15, 118, 99, 0.08), rgba(183, 121, 31, 0.08));
      box-shadow: var(--shadow);
    }
    .hero h1 {
      margin: 0 0 10px;
      font-size: clamp(34px, 5vw, 56px);
      line-height: 0.95;
      letter-spacing: -0.04em;
    }
    .hero p {
      max-width: 840px;
      margin: 0;
      color: var(--muted);
      font-size: 16px;
      line-height: 1.55;
    }
    .hero-links {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
    }
    .hero-links a,
    .hero-links span {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 999px;
      border: 1px solid var(--line);
      color: var(--ink);
      text-decoration: none;
      background: rgba(255,255,255,0.66);
    }
    .hero-links a:hover {
      border-color: rgba(15, 118, 99, 0.36);
      color: var(--accent);
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-top: 22px;
    }
    .stat {
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 16px;
      background: rgba(255,255,255,0.64);
    }
    .stat-label {
      display: block;
      margin-bottom: 8px;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .stat-value {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.03em;
    }
    .section-grid {
      display: grid;
      grid-template-columns: 1.35fr 0.85fr;
      gap: 18px;
      margin-top: 18px;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--paper);
      box-shadow: var(--shadow);
      backdrop-filter: blur(12px);
    }
    .panel-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 20px 22px 12px;
    }
    .panel-head h2 {
      margin: 0;
      font-size: 24px;
      letter-spacing: -0.03em;
    }
    .panel-head p {
      margin: 4px 0 0;
      color: var(--muted);
    }
    .controls {
      display: grid;
      grid-template-columns: minmax(220px, 1.3fr) repeat(3, minmax(120px, 0.55fr));
      gap: 12px;
      padding: 0 22px 18px;
    }
    .controls input,
    .controls select {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid rgba(76, 59, 42, 0.18);
      border-radius: 14px;
      background: rgba(255,255,255,0.84);
      color: var(--ink);
      font: inherit;
    }
    .explorer {
      display: grid;
      grid-template-columns: minmax(320px, 0.95fr) minmax(360px, 1.05fr);
      gap: 0;
      min-height: 720px;
      border-top: 1px solid var(--line);
    }
    .memory-list {
      padding: 16px;
      border-right: 1px solid var(--line);
      overflow: auto;
      max-height: 720px;
    }
    .memory-list-inner {
      display: grid;
      gap: 10px;
    }
    .memory-card {
      width: 100%;
      text-align: left;
      border: 1px solid transparent;
      border-radius: 18px;
      padding: 14px;
      background: rgba(255,255,255,0.72);
      cursor: pointer;
      transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
    }
    .memory-card:hover,
    .memory-card.active {
      transform: translateY(-1px);
      border-color: rgba(15, 118, 99, 0.34);
      box-shadow: 0 12px 28px rgba(15, 118, 99, 0.12);
    }
    .memory-card h3 {
      margin: 0;
      font-size: 16px;
      line-height: 1.35;
    }
    .memory-card p {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.45;
    }
    .memory-topline,
    .memory-meta,
    .detail-meta,
    .session-topline,
    .session-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .memory-topline,
    .session-topline {
      justify-content: space-between;
    }
    .memory-meta,
    .detail-meta,
    .session-meta {
      margin-top: 12px;
      color: var(--muted);
      font-size: 12px;
    }
    .memory-detail {
      padding: 18px 22px 22px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.76), rgba(255,248,239,0.56));
    }
    .detail-shell {
      display: grid;
      gap: 18px;
    }
    .detail-title {
      margin: 0;
      font-size: 28px;
      line-height: 1.08;
      letter-spacing: -0.04em;
    }
    .detail-section h3 {
      margin: 0 0 10px;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .detail-section pre,
    .detail-section code,
    .profile-table code {
      font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
    }
    .detail-section pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      padding: 16px;
      border-radius: 18px;
      border: 1px solid rgba(76, 59, 42, 0.14);
      background: rgba(248, 244, 236, 0.96);
      font-size: 14px;
      line-height: 1.6;
    }
    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid rgba(76, 59, 42, 0.14);
      background: rgba(255,255,255,0.72);
      font-size: 12px;
      line-height: 1;
      white-space: nowrap;
    }
    .chip.kind { background: rgba(15, 118, 99, 0.12); color: var(--accent); }
    .chip.status-active { background: rgba(15, 118, 99, 0.12); color: var(--accent); }
    .chip.status-superseded,
    .chip.status-inactive { background: rgba(183, 121, 31, 0.12); color: var(--gold); }
    .chip.muted { color: var(--muted); }
    .empty-state {
      display: grid;
      place-items: center;
      min-height: 240px;
      padding: 28px;
      text-align: center;
      color: var(--muted);
    }
    .lower-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
      margin-top: 18px;
    }
    .session-grid {
      display: grid;
      gap: 10px;
      padding: 0 22px 22px;
    }
    .session-card {
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 14px;
      background: rgba(255,255,255,0.66);
    }
    .session-card p {
      margin: 10px 0 0;
      color: var(--muted);
      line-height: 1.45;
    }
    .session-title {
      font-weight: 700;
    }
    .profile-table-wrap {
      padding: 0 22px 22px;
      overflow: auto;
    }
    .profile-table {
      width: 100%;
      border-collapse: collapse;
      min-width: 520px;
    }
    .profile-table th,
    .profile-table td {
      padding: 12px 0;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    .profile-table th {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    @media (max-width: 1080px) {
      .section-grid,
      .lower-grid,
      .explorer {
        grid-template-columns: 1fr;
      }
      .memory-list {
        max-height: 420px;
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }
    }
    @media (max-width: 760px) {
      main { padding: 18px 14px 36px; }
      .hero { padding: 20px; border-radius: 26px; }
      .controls { grid-template-columns: 1fr; }
      .panel-head { padding: 18px 18px 10px; }
      .memory-detail { padding: 16px 18px 18px; }
      .session-grid,
      .profile-table-wrap { padding: 0 18px 18px; }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>Recall Notes Explorer</h1>
      <p>Browse the exact notes OpenClaw Recall has stored, inspect raw content, and filter by memory type, scope, or status without falling back to JSON dumps.</p>
      <div class="hero-links">
        <a href="${params.basePath}/status">status</a>
        <a href="${params.basePath}/memories">memories json</a>
        <a href="${params.basePath}/profiles">profiles json</a>
        <a href="${params.basePath}/sessions">sessions json</a>
        <span>route: ${escapeHtml(params.basePath)}</span>
      </div>
      <div class="stats">
        <div class="stat"><span class="stat-label">Stored Notes</span><span class="stat-value">${summary.memoryCount}</span></div>
        <div class="stat"><span class="stat-label">Active Notes</span><span class="stat-value">${summary.activeMemoryCount}</span></div>
        <div class="stat"><span class="stat-label">Preferences</span><span class="stat-value">${summary.preferenceCount}</span></div>
        <div class="stat"><span class="stat-label">Project Facts</span><span class="stat-value">${summary.semanticCount}</span></div>
        <div class="stat"><span class="stat-label">Sessions</span><span class="stat-value">${summary.sessionCount}</span></div>
        <div class="stat"><span class="stat-label">Profiles</span><span class="stat-value">${summary.profileCount}</span></div>
      </div>
    </section>

    <section class="section-grid">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Notes</h2>
            <p>Search summaries, raw content, source sessions, and extracted topics.</p>
          </div>
          <div class="chip-row">
            <span class="chip muted" id="resultsCount">0 visible</span>
          </div>
        </div>
        <div class="controls">
          <input id="searchInput" type="search" placeholder="Search note text, session id, or topics" />
          <select id="kindFilter">
            <option value="all">All kinds</option>
            <option value="preference">Preference</option>
            <option value="semantic">Semantic</option>
            <option value="session_state">Session state</option>
            <option value="episodic">Episodic</option>
          </select>
          <select id="scopeFilter">
            <option value="all">All scopes</option>
            <option value="private">Private</option>
            <option value="workspace">Workspace</option>
            <option value="shared">Shared</option>
            <option value="session">Session</option>
          </select>
          <select id="statusFilter">
            <option value="active">Active only</option>
            <option value="all">All statuses</option>
            <option value="superseded">Superseded only</option>
            <option value="inactive">Inactive only</option>
          </select>
        </div>
        <div class="explorer">
          <div class="memory-list">
            <div class="memory-list-inner" id="memoryList"></div>
          </div>
          <div class="memory-detail" id="memoryDetail"></div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>What This Helps With</h2>
            <p>The explorer makes it obvious which notes are active, what they actually contain, and where they came from.</p>
          </div>
        </div>
        <div class="memory-detail">
          <div class="detail-shell">
            <div class="detail-section">
              <h3>Clarity</h3>
              <pre>Pick any stored note to see its raw content, extracted topics, scope, session source, and recall metadata in one place.</pre>
            </div>
            <div class="detail-section">
              <h3>Trust</h3>
              <pre>Active and superseded notes are visually separated so users can tell what Recall will likely use versus what has been retired.</pre>
            </div>
            <div class="detail-section">
              <h3>Debugging</h3>
              <pre>The lower panels still expose recent sessions and run profiles, so you can connect note quality back to prompt preparation and memory writes.</pre>
            </div>
          </div>
        </div>
      </section>
    </section>

    <section class="lower-grid">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Recent Sessions</h2>
            <p>Quick context for where notes were collected.</p>
          </div>
        </div>
        <div class="session-grid">
          ${sessionCards || "<div class='empty-state'>No sessions recorded yet.</div>"}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Recent Runs</h2>
            <p>Prompt and recall telemetry from recent turns.</p>
          </div>
        </div>
        <div class="profile-table-wrap">
          <table class="profile-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Mode</th>
                <th>Recall</th>
                <th>Writes</th>
                <th>Saved</th>
              </tr>
            </thead>
            <tbody>
              ${profileRows || "<tr><td colspan='5'>No profiles recorded yet.</td></tr>"}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  </main>

  <script>
    const DATA = ${memoryData};
    const state = {
      search: "",
      kind: "all",
      scope: "all",
      status: "active",
      selectedId: DATA.memories[0] ? DATA.memories[0].id : null,
    };

    const searchInput = document.getElementById("searchInput");
    const kindFilter = document.getElementById("kindFilter");
    const scopeFilter = document.getElementById("scopeFilter");
    const statusFilter = document.getElementById("statusFilter");
    const memoryList = document.getElementById("memoryList");
    const memoryDetail = document.getElementById("memoryDetail");
    const resultsCount = document.getElementById("resultsCount");

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    function previewText(value, maxLength) {
      const text = String(value || "").replace(/\\s+/g, " ").trim();
      if (text.length <= maxLength) {
        return text;
      }
      return text.slice(0, maxLength - 1).trimEnd() + "…";
    }

    function badge(label, className) {
      return '<span class="chip ' + className + '">' + escapeHtml(label) + "</span>";
    }

    function matches(memory) {
      if (state.kind !== "all" && memory.kind !== state.kind) {
        return false;
      }
      if (state.scope !== "all" && (memory.scope || "private") !== state.scope) {
        return false;
      }
      if (state.status !== "all" && memory.status !== state.status) {
        return false;
      }
      const search = state.search.trim().toLowerCase();
      if (!search) {
        return true;
      }
      const haystack = [
        memory.summary,
        memory.content,
        memory.sourceSessionId,
        (memory.topics || []).join(" "),
        (memory.entityKeys || []).join(" "),
        memory.scope,
        memory.kind,
        memory.status,
      ].join(" ").toLowerCase();
      return haystack.includes(search);
    }

    function filteredMemories() {
      return DATA.memories.filter(matches);
    }

    function ensureSelection(memories) {
      if (!memories.length) {
        state.selectedId = null;
        return null;
      }
      const existing = memories.find((memory) => memory.id === state.selectedId);
      if (existing) {
        return existing;
      }
      state.selectedId = memories[0].id;
      return memories[0];
    }

    function renderList(memories) {
      if (!memories.length) {
        memoryList.innerHTML = '<div class="empty-state">No notes match these filters.</div>';
        return;
      }
      memoryList.innerHTML = memories.map((memory) => {
        const activeClass = memory.id === state.selectedId ? "active" : "";
        return [
          '<button class="memory-card ' + activeClass + '" data-memory-id="' + escapeHtml(memory.id) + '">',
          '<div class="memory-topline">',
          "<h3>" + escapeHtml(memory.summary) + "</h3>",
          badge(memory.kind, "kind"),
          "</div>",
          "<p>" + escapeHtml(previewText(memory.content || memory.summary, 140)) + "</p>",
          '<div class="memory-meta">',
          badge(memory.status, "status-" + memory.status),
          badge(memory.scope || "private", "muted"),
          "<span>" + escapeHtml(memory.sourceSessionId) + "</span>",
          "<span>" + escapeHtml(memory.lastSeenAt || memory.createdAt) + "</span>",
          "</div>",
          "</button>",
        ].join("");
      }).join("");
      for (const node of memoryList.querySelectorAll("[data-memory-id]")) {
        node.addEventListener("click", () => {
          state.selectedId = node.getAttribute("data-memory-id");
          render();
        });
      }
    }

    function renderDetail(memory) {
      if (!memory) {
        memoryDetail.innerHTML = '<div class="empty-state">Pick a note to inspect its raw stored content.</div>';
        return;
      }
      const topics = (memory.topics || []).length
        ? memory.topics.map((topic) => badge(topic, "muted")).join("")
        : '<span class="chip muted">No extracted topics</span>';
      const entities = (memory.entityKeys || []).length
        ? memory.entityKeys.map((entity) => badge(entity, "muted")).join("")
        : '<span class="chip muted">No extracted entities</span>';
      const suppression = (memory.suppressedReasons || []).length
        ? memory.suppressedReasons.map((reason) => badge(reason, "status-inactive")).join("")
        : '<span class="chip muted">No suppression markers</span>';
      memoryDetail.innerHTML = [
        '<div class="detail-shell">',
        "<div>",
        '<div class="chip-row">',
        badge(memory.kind, "kind"),
        badge(memory.status, "status-" + memory.status),
        badge(memory.scope || "private", "muted"),
        memory.memoryGroup ? badge(memory.memoryGroup, "muted") : "",
        "</div>",
        '<h2 class="detail-title">' + escapeHtml(memory.summary) + "</h2>",
        '<div class="detail-meta">',
        "<span>ID: " + escapeHtml(memory.id) + "</span>",
        "<span>Session: " + escapeHtml(memory.sourceSessionId) + "</span>",
        "<span>Created: " + escapeHtml(memory.createdAt) + "</span>",
        "<span>Last seen: " + escapeHtml(memory.lastSeenAt) + "</span>",
        typeof memory.version === "number" ? "<span>Version: " + escapeHtml(memory.version) + "</span>" : "",
        "</div>",
        "</div>",
        '<section class="detail-section"><h3>Stored Content</h3><pre>' + escapeHtml(memory.content || memory.summary) + "</pre></section>",
        '<section class="detail-section"><h3>Extracted Topics</h3><div class="chip-row">' + topics + "</div></section>",
        '<section class="detail-section"><h3>Entity Keys</h3><div class="chip-row">' + entities + "</div></section>",
        '<section class="detail-section"><h3>Suppression / Hygiene</h3><div class="chip-row">' + suppression + "</div></section>",
        '<section class="detail-section"><h3>Recall Metadata</h3><pre>' + escapeHtml(JSON.stringify({
          confidence: memory.confidence,
          importance: memory.importance,
          salience: memory.salience,
          score: memory.score,
          ttlDays: memory.ttlDays,
          decayRate: memory.decayRate,
          retrievalReason: memory.retrievalReason,
          supersededAt: memory.supersededAt,
          supersededBy: memory.supersededBy,
        }, null, 2)) + "</pre></section>",
        "</div>",
      ].join("");
    }

    function render() {
      const memories = filteredMemories();
      const selected = ensureSelection(memories);
      resultsCount.textContent = memories.length + " visible";
      renderList(memories);
      renderDetail(selected);
    }

    searchInput.addEventListener("input", (event) => {
      state.search = event.target.value || "";
      render();
    });
    kindFilter.addEventListener("change", (event) => {
      state.kind = event.target.value || "all";
      render();
    });
    scopeFilter.addEventListener("change", (event) => {
      state.scope = event.target.value || "all";
      render();
    });
    statusFilter.addEventListener("change", (event) => {
      state.status = event.target.value || "active";
      render();
    });

    render();
  </script>
</body>
</html>`;
}

function classifyMemoryStatus(memory: MemoryRecord): "active" | "superseded" | "inactive" {
  if (memory.active === false && memory.supersededAt) {
    return "superseded";
  }
  if (memory.active === false) {
    return "inactive";
  }
  return "active";
}

function memoryStatusRank(memory: MemoryRecord): number {
  const status = classifyMemoryStatus(memory);
  return status === "active" ? 0 : status === "superseded" ? 1 : 2;
}

function serializeForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
