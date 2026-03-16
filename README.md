# OpenClaw Recall

Persistent memory, context compression, and profile visibility for OpenClaw.

OpenClaw Recall is an enhancement plugin for OpenClaw. It adds automatic memory write, cross-session recall, prompt compression, tool output compaction, and inspectable profile data without replacing OpenClaw's runtime or product shell.

Current stable version: `1.0.1`.

It now supports two persistent identity paths:

- `local` mode: durable memory stays on the current OpenClaw home
- `reconnect` mode: the same identity key or memory space id can reconnect to the same logical memory space across machines

The current `main` branch also includes the first v1.1 backend foundation:

- built-in `recall-http` backend support for remote memory spaces
- backend/operator CLI via `openclaw-recall backend serve`
- hybrid retrieval foundation with explicit `keyword` / `embedding` / `hybrid` modes
- `private` / `workspace` / `shared` / `session` scope-aware retrieval rules

## Why OpenClaw users install it

OpenClaw Recall targets four recurring problems:

- stable user preferences get forgotten between sessions
- long histories waste prompt budget
- large tool payloads get replayed back into the model
- prompt construction stays opaque when something goes wrong

After installing it, you get:

- automatic memory write for `preference`, `semantic`, `episodic`, and `session_state`
- query-aware retrieval before prompt build
- layered context compression with budget enforcement
- tool output compaction with saved-token reporting
- operator visibility through `doctor`, `status`, `memory explain`, `profile inspect`, and inspect routes
- write-time and retrieval-time guardrails that keep metadata noise, wrapper text, and scaffold fragments out of durable memory
- clean user-visible answers: debug annotations, retrieval scores, and internal scaffold stay in inspect paths only

## 3-minute install

```bash
npm install @felix201209/openclaw-recall
openclaw plugins install --link ./node_modules/@felix201209/openclaw-recall
openclaw-recall config init --mode local --write-openclaw
openclaw plugins info openclaw-recall
openclaw-recall config validate
openclaw-recall doctor
openclaw-recall status
```

If you are working from source instead:

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

## Local vs reconnect mode

Use `local` when you want durable memory on the current machine only.

Use `reconnect` when you already have an identity key or memory space id and want the same logical memory space on a new machine or a fresh OpenClaw home.

```bash
openclaw-recall config init --mode local
openclaw-recall config init --mode reconnect --identity-key recall_xxx --memory-space space_xxx
openclaw-recall config validate
```

Identity keys are secrets. Keep them in a password manager or another secure secret store.

## 5-minute value check

1. Tell OpenClaw: `以后默认叫我 Felix，用中文回答，并且尽量简洁。`
2. Start a new session and ask: `你记得我的偏好吗？`
3. Trigger a tool payload: `read "README.md"`
4. Inspect the results:

```bash
openclaw-recall memory list
openclaw-recall memory explain "你记得我的偏好吗？"
openclaw-recall profile list
openclaw-recall session inspect <sessionId>
```

Success looks like:

- memory rows mentioning `Felix`, `中文`, or `简洁`
- recall working without replaying the earlier transcript
- tool results with `savedTokens > 0`
- profile rows showing prompt/token source quality and compression evidence

See [EXAMPLES.md](./EXAMPLES.md) for a copyable walkthrough.

## Import first, then verify

The recommended first-use path is:

1. install the plugin
2. initialize config for `local` or `reconnect`
3. run `openclaw-recall import dry-run`
4. run `openclaw-recall import run`
5. verify with `doctor`, `status`, `memory explain`, and `profile inspect`

If you already have prior transcripts or memory files, importing them is a better first proof than a synthetic seed chat.

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
openclaw-recall profile list
openclaw-recall profile inspect <runId>
openclaw-recall session list
openclaw-recall session inspect <sessionId>
```

## Inspect routes

OpenClaw Recall exposes a small inspect surface inside OpenClaw:

- `/plugins/openclaw-recall/dashboard`
- `/plugins/openclaw-recall/status`
- `/plugins/openclaw-recall/memories`
- `/plugins/openclaw-recall/profiles`
- `/plugins/openclaw-recall/sessions`
- `/plugins/openclaw-recall/sessions/:sessionId`

This is a plugin inspection surface, not a replacement UI.

## Defaults and configuration

The default strategy is meant to work without a long tuning session:

- local hashed embeddings by default
- longer TTL for `preference`, shorter TTL for `episodic`
- automatic memory writes enabled by default
- context budget defaults to `2400`
- recent-turn window defaults to `6`
- history summary starts once the turn count crosses its threshold
- detailed profiles enabled by default

Configuration precedence:

1. `OPENCLAW_RECALL_*` environment variables
2. `plugins.entries.openclaw-recall.config`
3. built-in defaults

Legacy `OPENCLAW_MEMORY_PLUGIN_*` variables are still accepted as compatibility aliases during the rename transition.

Important identity-related variables:

- `OPENCLAW_RECALL_IDENTITY_MODE`
- `OPENCLAW_RECALL_IDENTITY_KEY`
- `OPENCLAW_RECALL_MEMORY_SPACE_ID`
- `OPENCLAW_RECALL_IDENTITY_API_KEY`
- `OPENCLAW_RECALL_IDENTITY_ENDPOINT`
- `OPENCLAW_RECALL_EXPORT_DIRECTORY`

## Memory quality guardrails

OpenClaw Recall now treats memory quality as a first-class runtime concern.

- write-time filters reject sender metadata, cron/heartbeat records, control-plane labels, wrapper text, debug annotations, scaffold fragments, and low-value emotion-only lines
- retrieval-time suppression keeps old noisy rows from dominating normal recall
- stable collaboration preferences such as `偏直接`、`偏执行导向`、`偏中文`、`偏简洁` and structured reporting preferences are favored over one-off phrasing
- preference and fact conflicts can supersede older rows instead of polluting recall forever

If you already have old noisy rows, use:

```bash
openclaw-recall memory prune-noise --dry-run
openclaw-recall memory prune-noise
```

`memory explain`, `memory inspect`, `doctor`, and `status` keep the debug path available without putting those internals in the normal chat response.

`status` also reports:

- `noisyActiveMemoryCount`
- `lastPrune`
- `recentImportStats`
- `lastExportPath`

## Compatibility

Verified for `1.0.1`:

- Node.js `24.10.0` and `24.12.0`
- OpenClaw `2026.3.13`
- OpenAI Responses runtime path for exact prompt-token accounting
- source-link install and tarball install flows

Full matrix: [COMPATIBILITY.md](./COMPATIBILITY.md)

## Metric accuracy

OpenClaw Recall does not pretend every number is exact:

- `promptTokensSource=exact` when provider usage metadata is available
- `promptTokensSource=estimated` when it is not
- `compressionSavingsSource=estimated` and `toolTokensSavedSource=estimated` when savings come from heuristic comparisons

## Known limitations

- compression savings and tool-token savings are still partly estimated
- provider smoke coverage is strongest on the OpenAI Responses path
- OpenClaw plugin CLI exposure through `openclaw <subcommand>` is still upstream-limited; use `openclaw-recall`
- OpenClaw may emit `plugins.allow is empty` warning noise in some install/info flows
- memory conflict resolution is still rule-based, even though stable preference changes now supersede the most common old values
- reconnect mode currently provides the identity/config/verify path first; fully remote memory backend implementations may still vary by deployment

These are known release limitations, not blockers for normal use.

## Verification and packaging

```bash
npm run check
npm run build
npm run test:unit
npm run test:integration
npm run test:install
npm run smoke
npm run verify
npm run release:build
```

## Docs

- [QUICKSTART.md](./QUICKSTART.md)
- [OPENCLAW-INTEGRATION.md](./OPENCLAW-INTEGRATION.md)
- [COMPATIBILITY.md](./COMPATIBILITY.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [OPERATIONS.md](./OPERATIONS.md)
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- [EXAMPLES.md](./EXAMPLES.md)
- [RELEASE_NOTES.md](./RELEASE_NOTES.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [NOTICE](./NOTICE)
- [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)
