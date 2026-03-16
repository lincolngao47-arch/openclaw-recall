# Troubleshooting

## `Plugin not found: openclaw-recall`

Cause:

- plugin not installed into the active OpenClaw profile/home
- you are querying a different `OPENCLAW_HOME`

Check:

```bash
openclaw config file
openclaw plugins list
openclaw plugins info openclaw-recall
```

Fix:

```bash
openclaw plugins install --link /path/to/openclaw-recall
```

If you are testing a release tarball instead of a source checkout:

```bash
npm install ./felixypz-openclaw-recall-<version>.tgz
openclaw plugins install --link ./node_modules/@felixypz/openclaw-recall
```

## `doctor` says no recent hook activity

Cause:

- plugin is installed but no agent run has completed yet
- plugin entry is disabled

Check:

```bash
openclaw-recall status
openclaw-recall config show
```

Fix:

- run a short conversation through OpenClaw
- verify `plugins.entries.openclaw-recall.enabled` is not `false`

## No memories are being written

Likely causes:

- `OPENCLAW_RECALL_AUTO_WRITE=false`
- messages are not passing the write threshold
- you only ran recall questions, not stable preference/fact turns

Check:

```bash
openclaw-recall memory list
openclaw-recall profile list
```

Try a clearer seed turn:

```text
以后默认叫我 Felix，用中文回答，并且尽量简洁。
```

If you intentionally disabled auto-write, re-enable it:

```bash
unset OPENCLAW_RECALL_AUTO_WRITE
```

## The assistant is recalling weird metadata or wrapper text

Check:

```bash
openclaw-recall memory explain "你记得我的偏好吗？"
openclaw-recall memory inspect <id>
openclaw-recall memory prune-noise --dry-run
```

Fix:

```bash
openclaw-recall memory prune-noise
```

Current versions reject most metadata/control-plane noise at write time and suppress it again at retrieval time, but older stored rows may still need pruning once.

## I saw internal scaffold or score text in a reply

This should no longer appear on the default chat path. Internal labels such as `TASK STATE`, `RELEVANT MEMORY`, score lines, and `why:` strings are meant for inspect/debug paths only.

If you still see them:

1. upgrade to the latest build of the plugin
2. rerun the conversation once
3. inspect the stored rows with `memory inspect`
4. export `doctor --json` and `status --json` for debugging

## Reconnect mode says identity is incomplete

Cause:

- `identity.mode` is `reconnect` or `cloud`
- but neither `identityKey` nor `memorySpaceId` is configured

Fix:

```bash
openclaw-recall config init --mode reconnect --identity-key recall_xxx --memory-space space_xxx --write-openclaw
openclaw-recall config validate
openclaw-recall backend serve --port 4546 --data-dir .recall-http-backend
openclaw-recall doctor
```

If `doctor` still reports backend reachability problems, confirm that the endpoint, API key, and `memorySpaceId` all point to the same remote backend.

## Import found files but wrote nothing

Likely causes:

- files only contained noisy wrappers or unsupported objects
- dry-run was used instead of `import run`
- duplicates merged into existing memory instead of creating new rows

Check:

```bash
openclaw-recall import status
openclaw-recall memory list
```

If the report shows high `rejectedNoise`, inspect the source files before retrying.

If restore state looks correct in `doctor` / `status` / `memory explain` but the reply itself is still weak, check whether the imported records landed in `private` scope for a different user. Stable project context should usually survive as `workspace`, while `private` preferences are intentionally not cross-user.

## I need a backup before changing machines

Run:

```bash
openclaw-recall export memory
openclaw-recall export profile
openclaw-recall export session --session <sessionId>
```

Keep:

- the export files
- your identity key
- your OpenClaw config snippet

## OpenAI-compatible embeddings selected but no key found

Fix one of:

- switch back to `OPENCLAW_RECALL_EMBEDDING_PROVIDER=local`
- or provide `OPENCLAW_RECALL_EMBEDDING_API_KEY`

## Why do some savings fields still say `estimated`?

Cause:

- prompt token counts can be exact when provider usage is returned
- savings values still come from heuristic before/after comparisons

This is expected in 1.2.0.

## SQLite appears locked

The plugin uses `busy_timeout` and WAL when available, so brief contention should clear automatically. If you see repeated failures:

- stop overlapping test processes
- rerun the command
- if needed, restart the long-running process holding the DB

## Inspect route not available

Check:

```bash
openclaw-recall config show
```

Confirm `inspect.httpPath` starts with `/plugins/` and that OpenClaw loaded the plugin.

## `doctor` warns about env/config precedence

Cause:

- one or more `OPENCLAW_RECALL_*` variables override `openclaw.json`

Fix:

- remove the temporary env override
- or keep it intentionally and document it in your deployment config

Use:

```bash
openclaw-recall config show
```

to confirm the resolved precedence chain.

## I want to reset plugin state

Delete:

```text
$OPENCLAW_HOME/.openclaw/plugins/openclaw-recall/
```

This only clears plugin-managed memory, profile, and tool state.
