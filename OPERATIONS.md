# Operations

## Quick checks

```bash
openclaw-recall doctor
openclaw-recall status
openclaw-recall import status
openclaw-recall memory list
openclaw-recall profile list
```

## What `doctor` checks

- OpenClaw config presence
- plugin enablement
- database path, writability, and SQLite query health
- embedding availability
- inspect route path
- package and plugin manifest integrity
- build integrity
- env/config precedence warnings
- recent hook activity
- memory pipeline activity
- retrieval pipeline activity
- compression pipeline activity
- recent tool compaction evidence
- recent profile path integrity
- identity/reconnect configuration
- import system health and latest import report
- export path writability and recovery readiness

## Debugging memory behavior

```bash
openclaw-recall memory search "concise chinese replies"
openclaw-recall memory explain "你记得我的偏好吗？"
openclaw-recall memory inspect <id>
openclaw-recall memory prune-noise --dry-run
openclaw-recall memory prune-noise
openclaw-recall memory reindex --dry-run
openclaw-recall memory reindex
openclaw-recall memory compact --dry-run
openclaw-recall memory compact
openclaw-recall session inspect <sessionId>
```

What to look for:

- `memory inspect` should show `active`, `supersededAt`, and `supersededBy` when a preference or fact was replaced
- `memory inspect` should show `scope`, `scopeKey`, and `backend`
- `suppressedReasons` should only appear on noisy rows in debug paths
- `memory explain` should show `retrievalMode`, `keywordContribution`, `semanticContribution`, and selected/suppressed rows
- normal chat replies should stay clean; scaffold/debug detail belongs in inspect commands only

## Debugging profile and compression behavior

```bash
openclaw-recall profile list
openclaw-recall profile inspect <runId>
```

Look for:

- `promptTokens`
- `promptTokensSource`
- `memoryInjected`
- `toolTokensSaved`
- `toolTokensSavedSource`
- `compressionSavings`
- `compressionSavingsSource`
- `retrievalCount`

If `promptTokensSource=exact`, the provider reported real usage. Savings values may still remain `estimated`.

## Inspect HTTP surface

Use the authenticated OpenClaw route:

- `/plugins/openclaw-recall/dashboard`
- `/plugins/openclaw-recall/status`
- `/plugins/openclaw-recall/sessions/:sessionId`

## Import operations

```bash
openclaw-recall import dry-run
openclaw-recall import run
openclaw-recall import status
```

The dry-run path is recommended first. It shows what would be imported, what would be rejected as noise, and what would be merged as duplicates.

## Cleaning noisy memories

If earlier versions stored wrapper text, metadata, or scaffold fragments, prune them explicitly:

```bash
openclaw-recall memory prune-noise --dry-run
openclaw-recall memory prune-noise
openclaw-recall memory reindex --dry-run
openclaw-recall memory compact --dry-run
```

The dry-run output reports how many rows would be affected before any change is applied.

- `prune-noise` deactivates noisy rows
- `reindex` refreshes fingerprint, scope defaults, and suppression metadata
- `compact` shrinks inactive/superseded/expired rows without deleting inspectable history

## Backup and export

```bash
openclaw-recall export memory
openclaw-recall export profile
openclaw-recall export session --session <sessionId>
```

The latest export path is surfaced in `openclaw-recall status`.
The export report also includes `scopeCounts`, so you can see whether data is staying `private`, `workspace`, `shared`, or `session`.

## Recovery

### Disable the plugin temporarily

```bash
openclaw plugins disable openclaw-recall
```

### Disable automatic memory writes only

```bash
OPENCLAW_RECALL_AUTO_WRITE=false
```

### Re-enable

```bash
openclaw plugins enable openclaw-recall
```

### Remove plugin state only

Delete:

```text
$OPENCLAW_HOME/.openclaw/plugins/openclaw-recall/
```

This clears stored memories, profiles, and tool compactions for the plugin only.

### Restore on a new machine

1. install OpenClaw Recall
2. run `config init --mode reconnect` if you have an identity key
3. run `import run <path-to-exported-files>`
4. verify with `doctor` and `status`

### Export debug evidence

```bash
openclaw-recall doctor --json > doctor.json
openclaw-recall status --json > status.json
openclaw-recall session inspect <sessionId> --json > session.json
openclaw-recall profile inspect <runId> --json > profile.json
```

## SQLite notes

The plugin uses SQLite with:

- `foreign_keys = ON`
- `busy_timeout = 5000`
- `journal_mode = WAL` when available

If another long-running process is holding the database, operator commands should wait briefly instead of failing immediately.
