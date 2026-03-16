# OpenClaw Integration

## Integration shape

OpenClaw Recall integrates as a normal OpenClaw plugin package. It does not patch OpenClaw source files and does not require modifying the installed OpenClaw package.

Primary install method:

- `openclaw plugins install --link /path/to/openclaw-recall`

## Install flow

### Source checkout

```bash
cd /path/to/openclaw-recall
npm install
npm run build
openclaw plugins install --link .
```

### Installed package path

```bash
npm install @felix201209/openclaw-recall
openclaw plugins install --link ./node_modules/@felix201209/openclaw-recall
```

### Verify discovery

```bash
openclaw plugins info openclaw-recall
openclaw plugins doctor
openclaw-recall doctor
openclaw-recall status
```

## Config path and state path

If `OPENCLAW_HOME=/path/root`, OpenClaw uses:

```text
/path/root/.openclaw/openclaw.json
```

OpenClaw Recall stores its runtime data under:

```text
/path/root/.openclaw/plugins/openclaw-recall/
```

## Config precedence

Resolution order:

1. environment variables `OPENCLAW_RECALL_*`
2. `plugins.entries.openclaw-recall.config`
3. defaults from `src/config/defaults.ts`

Legacy `OPENCLAW_MEMORY_PLUGIN_*` variables are still accepted as compatibility aliases during the rename transition.

Starter entry helpers:

```bash
openclaw-recall config init --mode local
openclaw-recall config init --mode local --write-openclaw
openclaw-recall config init --mode reconnect --identity-key recall_xxx --memory-space space_xxx
openclaw-recall config validate
```

## Identity modes

### `local`

- plugin state lives under the current OpenClaw home
- best for a single machine or local-first workflow

### `reconnect`

- uses an identity key and/or memory space id
- intended for reconnecting the same logical memory space on a new machine
- keep the identity key secret; it is part of your recovery path

### `cloud`

- reserved for deployments where a remote identity-backed memory service exists
- this release wires config, validation, doctor, and UX for cloud-backed reconnect flows, but backend implementations may vary by deployment

### Built-in `recall-http` path on `main`

- the current `main` branch includes a built-in `recall-http` backend path
- it is exercised through clean-consumer reconnect/import/export roundtrip tests
- restored installs now surface project focus or stable preferences in natural-language recall, not only in inspect output
- treat it as near-release `v1.1.0` functionality, not part of the tagged `1.0.1` contract

Temporarily disable automatic memory writes without uninstalling the plugin:

```bash
OPENCLAW_RECALL_AUTO_WRITE=false
```

## Hook behavior

### `before_prompt_build`

- load session state
- retrieve boot memory and relevant memory
- compress older history
- assemble injected prompt layers

### `after_tool_call`

- compact tool output
- store summary plus raw payload reference

### `tool_result_persist`

- replace large tool payloads with compacted text in the persisted path

### `agent_end`

- store transcript turns
- extract and write new memories
- update session state
- record turn profile

## Enable, disable, uninstall

```bash
openclaw plugins enable openclaw-recall
openclaw plugins disable openclaw-recall
openclaw plugins uninstall openclaw-recall
```

## Import, export, recovery

```bash
openclaw-recall import dry-run
openclaw-recall import run
openclaw-recall import status
openclaw-recall export memory
openclaw-recall export profile
openclaw-recall export session --session <sessionId>
```

Recommended sequence:

1. install and validate
2. import old sessions or memory files
3. export a backup after the import succeeds
4. keep the identity key and exports together for recovery

## Inspect route

Default path:

```text
/plugins/openclaw-recall
```

Endpoints:

- `/dashboard`
- `/status`
- `/memories`
- `/memories/:id`
- `/profiles`
- `/profiles/:runId`
- `/sessions`
- `/sessions/:sessionId`

## Compatibility and limits

- The supported operator surface is the standalone `openclaw-recall` binary. OpenClaw plugin metadata can advertise plugin commands, but current OpenClaw command parsing does not reliably expose the plugin's command tree as `openclaw <subcommand>`.
- Embeddings default to local hashed vectors to avoid forcing external dependencies. OpenAI-compatible embeddings are optional.
- Prompt token accounting can be `exact` when the provider emits usage metadata. Compression savings and tool compaction savings remain `estimated`.
- Some OpenClaw install/info flows may emit a `plugins.allow is empty` warning before config is fully written. This is runtime noise, not a plugin failure.

See [COMPATIBILITY.md](./COMPATIBILITY.md) for the full verified matrix.
