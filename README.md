# OpenClaw Recall

**Persistent memory, context compression, and profile visibility for OpenClaw.**

OpenClaw Recall is a focused memory infrastructure plugin for OpenClaw. It adds automatic memory write, cross-session recall, prompt compression, tool output compaction, and inspectable profile data **without replacing OpenClaw's runtime or product shell**.

Current stable release: **`1.1.0`**

npm package: **`@felixypz/openclaw-recall`**

## Why OpenClaw Recall exists

OpenClaw Recall is built for the problems that appear once an agent is used over time:

- stable user preferences get forgotten between sessions
- long transcript history wastes prompt budget
- large tool payloads get replayed back into the model
- memory and prompt behavior are hard to inspect when something goes wrong
- old noisy rows can pollute recall unless memory hygiene is enforced

OpenClaw Recall solves that with:

- automatic memory write for `preference`, `semantic`, `episodic`, and `session_state`
- query-aware retrieval before prompt build
- layered context compression with budget enforcement
- tool output compaction with saved-token reporting
- inspectable operator surfaces through `doctor`, `status`, `memory explain`, `profile inspect`, and session inspection
- write-time and retrieval-time guardrails that keep metadata noise, wrapper text, and scaffold fragments out of durable memory
- clean user-visible answers: internal scaffold, scores, and debug annotations stay in inspect paths only

## What's new in 1.1.0

`1.1.0` turns OpenClaw Recall into a release-grade memory infrastructure layer for OpenClaw:

- built-in `recall-http` backend support for remote memory spaces
- reconnectable memory spaces across machines
- backend/operator CLI via `openclaw-recall backend serve`
- hybrid retrieval foundation with explicit `keyword`, `embedding`, and `hybrid` modes
- scope-aware memory behavior across:
  - `private`
  - `workspace`
  - `shared`
  - `session`
- `semantic` memory now defaults to `workspace`; `shared` remains explicit and opt-in
- clean-consumer reconnect / import / export roundtrip coverage against the built-in backend
- restored natural-language recall after reconnect/import surfaces stable preferences or current project focus, not only inspect evidence
- lifecycle-aware hygiene for stale, superseded, expired, and retrieval-ineligible records

## 3-minute install

### From npm

```bash
npm install @felixypz/openclaw-recall
openclaw plugins install --link ./node_modules/@felixypz/openclaw-recall
openclaw-recall config init --mode local --write-openclaw
openclaw plugins info openclaw-recall
openclaw-recall config validate
openclaw-recall doctor
openclaw-recall status
```

### From source

```bash
git clone https://github.com/Felix201209/openclaw-recall.git
cd openclaw-recall
npm install
npm run build
openclaw plugins install --link .
openclaw-recall config init --mode local --write-openclaw
openclaw plugins info openclaw-recall
openclaw-recall config validate
openclaw-recall doctor
openclaw-recall status
```

## Identity modes

OpenClaw Recall currently supports two primary persistent identity paths:

- `local` — durable memory stays on the current OpenClaw home
- `reconnect` — the same identity key or memory space id reconnects the same logical memory space across machines

Use `local` when you want machine-local durable memory only.

Use `reconnect` when you already have an identity key or memory space id and want to reconnect the same memory space on another machine or a fresh OpenClaw home.

```bash
openclaw-recall config init --mode local
openclaw-recall config init --mode reconnect --identity-key recall_xxx --memory-space space_xxx
openclaw-recall config validate
```

Important: identity keys are secrets. Store them in a password manager or another secure secret store.

## 5-minute value check

1. Tell OpenClaw:

   `Remember that I like you to call me Felix.`

2. Start a new session and ask:

   `Did you remember my preferences?`

3. Trigger a tool payload:

   `read "README.md"`

4. Inspect what happened:

```bash
openclaw-recall memory list
openclaw-recall memory explain "Did you remember my preferences?"
openclaw-recall profile list
openclaw-recall session inspect <sessionId>
```

Success looks like:

- memory rows mentioning `Felix`, `English`, or `Concise`
- recall works without replaying the earlier transcript
- tool results show `savedTokens > 0`
- profile rows show prompt/token-source quality and compression evidence

See [EXAMPLES.md](/Users/felix/Documents/openclaw-memory-plugin/EXAMPLES.md) for a copyable walkthrough.

## Recommended first-use workflow

The recommended first-use path is:

1. install the plugin
2. initialize config for `local` or `reconnect`
3. run `openclaw-recall import dry-run`
4. run `openclaw-recall import run`
5. verify with:
   - `doctor`
   - `status`
   - `memory explain`
   - `profile inspect`

If you already have transcripts or memory files, importing them is usually a better first proof than a synthetic seed chat.

Import behavior in `1.1.0`:

- duplicate rows are merged or superseded instead of duplicated
- `rejectedNoise`, `rejectedSensitive`, and `uncertainCandidates` are tracked separately
- generic imports do not silently promote semantic memory into `shared`
- exported plugin artifacts preserve their stored scope metadata

## Operator CLI

```bash
openclaw-recall doctor
openclaw-recall status
openclaw-recall config show
openclaw-recall config validate
openclaw-recall config init

openclaw-recall import dry-run
openclaw-recall import run
openclaw-recall import status

openclaw-recall export memory
openclaw-recall export profile
openclaw-recall export session --session <sessionId>

openclaw-recall backend serve

openclaw-recall memory list
openclaw-recall memory inspect <id>
openclaw-recall memory search "<query>"
openclaw-recall memory explain "<query>"
openclaw-recall memory prune-noise --dry-run
openclaw-recall memory prune-noise
openclaw-recall memory reindex --dry-run
openclaw-recall memory reindex
openclaw-recall memory compact --dry-run
openclaw-recall memory compact

openclaw-recall profile list
openclaw-recall profile inspect <runId>

openclaw-recall session list
openclaw-recall session inspect <sessionId>
```

## Inspect routes

OpenClaw Recall exposes a small inspection surface inside OpenClaw:

- `/plugins/openclaw-recall/dashboard`
- `/plugins/openclaw-recall/status`
- `/plugins/openclaw-recall/memories`
- `/plugins/openclaw-recall/profiles`
- `/plugins/openclaw-recall/sessions`
- `/plugins/openclaw-recall/sessions/:sessionId`

This is a plugin inspection surface, not a replacement UI.

## Defaults and configuration

The default strategy is designed to work without a long tuning session:

- local hashed embeddings by default
- longer TTL for `preference`, shorter TTL for `episodic`
- automatic memory write enabled by default
- context budget defaults to `2400`
- recent-turn window defaults to `6`
- history summary starts once the turn-count threshold is crossed
- detailed profiles enabled by default

### Configuration precedence

1. `OPENCLAW_RECALL_*` environment variables
2. `plugins.entries.openclaw-recall.config`
3. built-in defaults

Legacy `OPENCLAW_MEMORY_PLUGIN_*` variables are still accepted as compatibility aliases during the rename transition.

### Important identity-related variables

- `OPENCLAW_RECALL_IDENTITY_MODE`
- `OPENCLAW_RECALL_IDENTITY_KEY`
- `OPENCLAW_RECALL_MEMORY_SPACE_ID`
- `OPENCLAW_RECALL_IDENTITY_API_KEY`
- `OPENCLAW_RECALL_IDENTITY_ENDPOINT`
- `OPENCLAW_RECALL_EXPORT_DIRECTORY`

## Memory quality guardrails

OpenClaw Recall treats memory quality as a first-class runtime concern.

Write-time filters reject:

- sender metadata
- cron / heartbeat records
- control-plane labels
- wrapper text
- debug annotations
- scaffold fragments
- low-value emotion-only lines

Retrieval-time suppression prevents:

- old noisy rows from dominating recall
- stale or superseded rows from crowding out current useful memory
- internal wrapper/debug text from leaking back into normal answers

Stable preference extraction favors:

- `偏直接`
- `偏执行导向`
- `偏中文`
- `偏简洁`
- structured reporting preferences

Conflict handling supports:

- stable preference supersession
- common fact updates
- reduction of long-term recall pollution from stale rows

If you already have old noisy rows, use:

```bash
openclaw-recall memory prune-noise --dry-run
openclaw-recall memory prune-noise
openclaw-recall memory reindex --dry-run
openclaw-recall memory compact --dry-run
```

`memory explain`, `memory inspect`, `doctor`, and `status` keep the debug path available without putting those internals in the normal chat response.

`status` reports:

- `noisyActiveMemoryCount`
- `lastPrune`
- `lastReindex`
- `lastCompact`
- `hygiene`
- `recentImportStats`
- `lastExportPath`

`memory explain` exposes:

- `retrievalMode`
- selected rows with `finalScore`
- `keywordContribution`
- `semanticContribution`
- suppressed noisy rows and suppression reasons

That data stays in inspect/debug paths only. Normal chat replies remain clean.

## Compatibility

Verified for `1.1.0`:

- Node.js `24.10.0` and `24.12.0`
- OpenClaw `2026.3.13`
- OpenAI Responses runtime path for exact prompt-token accounting
- source-link install and tarball install flows

Full matrix: [COMPATIBILITY.md](/Users/felix/Documents/openclaw-memory-plugin/COMPATIBILITY.md)

## Metric accuracy

OpenClaw Recall does not pretend every number is exact.

- `promptTokensSource=exact` when provider usage metadata is available
- `promptTokensSource=estimated` when it is not
- `compressionSavingsSource=estimated` and `toolTokensSavedSource=estimated` when savings come from heuristic comparisons

## Known limitations

- compression savings and tool-token savings are still partly estimated
- provider smoke coverage is strongest on the OpenAI Responses path
- OpenClaw plugin CLI exposure through `openclaw <subcommand>` is still upstream-limited; use `openclaw-recall`
- OpenClaw may emit `plugins.allow is empty` warning noise in some install/info flows
- memory conflict resolution is still rule-based, even though common stable preference changes now supersede older rows
- reconnect and cloud-backed continuity in `1.1.0` use the built-in `recall-http` backend; generic external remote backends are not release-verified

These are known release limitations, not blockers for normal use.

## Verification and packaging

```bash
npm run check
npm run build
npm run test:unit
npm run test:integration
npm run test:remote-roundtrip
npm run test:install
npm run smoke
npm run verify
npm run release:build
```

This README describes the `1.1.0` release line. See [COMPATIBILITY.md](/Users/felix/Documents/openclaw-memory-plugin/COMPATIBILITY.md) for exact verified, supported, and partial coverage.

## Documentation

- [QUICKSTART.md](/Users/felix/Documents/openclaw-memory-plugin/QUICKSTART.md)
- [OPENCLAW-INTEGRATION.md](/Users/felix/Documents/openclaw-memory-plugin/OPENCLAW-INTEGRATION.md)
- [COMPATIBILITY.md](/Users/felix/Documents/openclaw-memory-plugin/COMPATIBILITY.md)
- [ARCHITECTURE.md](/Users/felix/Documents/openclaw-memory-plugin/ARCHITECTURE.md)
- [OPERATIONS.md](/Users/felix/Documents/openclaw-memory-plugin/OPERATIONS.md)
- [TROUBLESHOOTING.md](/Users/felix/Documents/openclaw-memory-plugin/TROUBLESHOOTING.md)
- [EXAMPLES.md](/Users/felix/Documents/openclaw-memory-plugin/EXAMPLES.md)
- [RELEASE_NOTES.md](/Users/felix/Documents/openclaw-memory-plugin/RELEASE_NOTES.md)
- [CHANGELOG.md](/Users/felix/Documents/openclaw-memory-plugin/CHANGELOG.md)
- [NOTICE](/Users/felix/Documents/openclaw-memory-plugin/NOTICE)
- [THIRD_PARTY_NOTICES.md](/Users/felix/Documents/openclaw-memory-plugin/THIRD_PARTY_NOTICES.md)
