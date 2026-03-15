# Troubleshooting

## `Plugin not found: openclaw-memory-plugin`

Cause:

- plugin not installed into the active OpenClaw profile/home
- you are querying a different `OPENCLAW_HOME`

Check:

```bash
openclaw config file
openclaw plugins list
openclaw plugins info openclaw-memory-plugin
```

Fix:

```bash
openclaw plugins install --link /path/to/openclaw-memory-plugin
```

If you are testing a release tarball instead of a source checkout:

```bash
npm install ./openclaw-memory-plugin-<version>.tgz
openclaw plugins install --link ./node_modules/openclaw-memory-plugin
```

## `doctor` says no recent hook activity

Cause:

- plugin is installed but no agent run has completed yet
- plugin entry is disabled

Check:

```bash
openclaw-memory-plugin status
openclaw-memory-plugin config show
```

Fix:

- run a short conversation through OpenClaw
- verify `plugins.entries.openclaw-memory-plugin.enabled` is not `false`

## No memories are being written

Likely causes:

- `OPENCLAW_MEMORY_PLUGIN_AUTO_WRITE=false`
- messages are not passing the write threshold
- you only ran recall questions, not stable preference/fact turns

Check:

```bash
openclaw-memory-plugin memory list
openclaw-memory-plugin profile list
```

Try a clearer seed turn:

```text
以后默认叫我 Felix，用中文回答，并且尽量简洁。
```

If you intentionally disabled auto-write, re-enable it:

```bash
unset OPENCLAW_MEMORY_PLUGIN_AUTO_WRITE
```

## OpenAI-compatible embeddings selected but no key found

Fix one of:

- switch back to `OPENCLAW_MEMORY_PLUGIN_EMBEDDING_PROVIDER=local`
- or provide `OPENCLAW_MEMORY_PLUGIN_EMBEDDING_API_KEY`

## Why do some savings fields still say `estimated`?

Cause:

- prompt token counts can be exact when provider usage is returned
- savings values still come from heuristic before/after comparisons

This is expected in the beta.

## SQLite appears locked

The plugin uses `busy_timeout` and WAL when available, so brief contention should clear automatically. If you see repeated failures:

- stop overlapping test processes
- rerun the command
- if needed, restart the long-running process holding the DB

## Inspect route not available

Check:

```bash
openclaw-memory-plugin config show
```

Confirm `inspect.httpPath` starts with `/plugins/` and that OpenClaw loaded the plugin.

## `doctor` warns about env/config precedence

Cause:

- one or more `OPENCLAW_MEMORY_PLUGIN_*` variables override `openclaw.json`

Fix:

- remove the temporary env override
- or keep it intentionally and document it in your deployment config

Use:

```bash
openclaw-memory-plugin config show
```

to confirm the resolved precedence chain.

## I want to reset plugin state

Delete:

```text
$OPENCLAW_HOME/.openclaw/plugins/openclaw-memory-plugin/
```

This only clears plugin-managed memory/profile/tool state.
