# OpenClaw Integration

## Integration shape

This package integrates with OpenClaw as a normal plugin package. It does not patch OpenClaw source files and does not require modifying the installed OpenClaw package.

Primary integration method:

- `openclaw plugins install --link /path/to/openclaw-memory-plugin`

OpenClaw then records:

- plugin load path
- per-plugin enablement
- install metadata

in `openclaw.json`.

## Install flow

### Local path install

```bash
cd /path/to/openclaw-memory-plugin
npm install
npm run build
openclaw plugins install --link .
```

### Verify discovery

```bash
openclaw plugins info openclaw-memory-plugin
openclaw plugins doctor
openclaw-memory-plugin doctor
openclaw-memory-plugin status
```

## Config path and state path

If `OPENCLAW_HOME=/path/root`, OpenClaw uses:

```text
/path/root/.openclaw/openclaw.json
```

The plugin stores its runtime data under:

```text
/path/root/.openclaw/plugins/openclaw-memory-plugin/
```

## Config precedence

Resolution order:

1. environment variables `OPENCLAW_MEMORY_PLUGIN_*`
2. `plugins.entries.openclaw-memory-plugin.config`
3. defaults from [`src/config/defaults.ts`](/Users/felix/Documents/openclaw-memory-plugin/src/config/defaults.ts)

Starter entry helpers:

```bash
openclaw-memory-plugin config init
openclaw-memory-plugin config init --write-openclaw
openclaw-memory-plugin config validate
```

Temporarily disable automatic memory writes without uninstalling the plugin:

```bash
OPENCLAW_MEMORY_PLUGIN_AUTO_WRITE=false
```

## Hook behavior

### `before_prompt_build`

- load session state
- retrieve boot memory + relevant memory
- compress old history
- assemble injected prompt layers

### `after_tool_call`

- compact tool output
- store summary + raw payload reference

### `tool_result_persist`

- replace large tool payload with compacted text in the persisted message path

### `agent_end`

- store transcript turns
- extract and write new memories
- update session state
- record turn profile

## Enable / disable

Enable:

```bash
openclaw plugins enable openclaw-memory-plugin
```

Disable:

```bash
openclaw plugins disable openclaw-memory-plugin
```

Uninstall:

```bash
openclaw plugins uninstall openclaw-memory-plugin
```

## Inspect route

Default path:

```text
/plugins/openclaw-memory-plugin
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

## Known limitations

- The operational CLI for this plugin is the standalone `openclaw-memory-plugin` binary. OpenClaw plugin metadata can advertise CLI commands, but current OpenClaw command parsing does not expose the plugin's command tree as a top-level `openclaw` subcommand during early argument parsing.
- Embeddings default to local hashed vectors to avoid forcing external dependencies. OpenAI-compatible embeddings are optional.
- Prompt token accounting can be `exact` when the provider emits usage metadata. Compression savings and tool compaction savings remain `estimated`.
- Some OpenClaw install/info flows may emit a `plugins.allow is empty` warning before your config is fully written. This is runtime noise, not a plugin failure.

## Compatibility matrix

Verified in this repository:

- Node.js `24.12.0`
- OpenClaw npm package `2026.3.13`
- OpenAI Responses path for runtime execution
- local hashed embeddings as default mode

Supported but not smoke-tested in this release:

- OpenAI-compatible embeddings via `embedding.provider=openai`

See the fuller matrix in [COMPATIBILITY.md](/Users/felix/Documents/openclaw-memory-plugin/COMPATIBILITY.md).
