# Release Notes

## v0.3.0-beta.1

First beta release of `openclaw-memory-plugin`.

### Why this is a beta

- the core plugin workflow is implemented and verified end-to-end
- source install, tarball install, and OpenClaw load flows are working
- operator CLI, inspect surface, doctor, and status are usable
- some metrics and provider paths still have beta-level limitations, so this is not presented as a stable `0.3.0` yet

### What it solves

- stable user preferences are no longer lost between sessions
- prompt construction avoids replaying the full transcript
- large tool payloads are compacted before re-entering the prompt path
- prompt and retrieval behavior become inspectable through profiles and operator commands

### Core capabilities

- automatic memory write for `preference`, `semantic`, `episodic`, and `session_state`
- cross-session memory retrieval before prompt build
- layered context compression with budget enforcement
- tool output compaction with savings reporting
- operator CLI for doctor, status, memory, profile, session, and config inspection
- plugin inspect routes inside OpenClaw

### Verified in this release

- Node.js `24.12.0`
- OpenClaw npm package `2026.3.13`
- OpenAI Responses runtime path with mocked provider usage for exact prompt token counts
- local hashed embeddings by default
- install from source link and install from generated tarball

### Known limitations

- prompt token counts can be `exact` when provider usage is available, but compression and tool savings are still `estimated`
- OpenClaw plugin metadata can advertise CLI commands, but the supported operator surface remains the standalone `openclaw-memory-plugin` binary
- OpenAI-compatible embeddings are supported but not covered by the automated smoke path in this release
- some OpenClaw install/info flows may emit `plugins.allow is empty` warning noise before config is tightened
- conflict resolution remains rule-based in this beta

### Install

```bash
npm install
npm run build
openclaw plugins install --link .
openclaw-memory-plugin doctor
openclaw-memory-plugin status
```

For a release-grade validation path:

```bash
npm run verify
```

### Highlights

- automatic memory write with cross-session recall
- layered prompt assembly with compression and budget control
- tool output compaction with inspectable savings
- operator CLI and inspect routes for debugging and operations
