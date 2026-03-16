# Examples

## Minimal memory demo

User message:

```text
以后默认叫我 Felix，用中文回答，并且尽量简洁。
```

Expected result:

- OpenClaw Recall writes `preference` memory rows
- later sessions no longer need the full original transcript to recover the preference
- `memory inspect <id>` shows a clean human-readable preference, not transport wrappers or scaffold text

## Import-first demo

```bash
openclaw-recall import dry-run
openclaw-recall import run
openclaw-recall import status
```

Expected result:

- session and memory files are scanned
- noisy files are counted as rejected instead of silently imported
- sensitive rows are counted in `rejectedSensitive`
- weak or ambiguous rows surface in `uncertainCandidates`
- duplicate material is merged instead of duplicated
- semantic rows default to `workspace`, not `shared`, unless you explicitly map them

## Cross-session recall demo

Start a new session and ask:

```text
你记得我的偏好吗？
```

Expected result:

- relevant memories are retrieved before prompt build
- the assistant recalls `Felix`, `中文`, and `简洁`
- when the query asks for both preferences and project context, recall can mix both instead of returning only near-duplicate preference rows
- profile output shows retrieval evidence

Example clean answer shape:

```text
我记得你偏直接、偏执行导向，也更喜欢简洁、结构化的回复。
```

Or, for a mixed memory query:

```text
我记得你偏中文、偏简洁；当前项目重点是 backend、scope 和 import quality。
```

The answer should not include:

- `TASK STATE`
- `RELEVANT MEMORY`
- retrieval scores
- `why:` debug strings
- control metadata

## Tool compaction demo

User message:

```text
read "README.md"
```

Expected result:

- raw tool payload is compacted
- `savedTokens` becomes non-zero
- `toolTokensSavedSource` remains `estimated`, not fake-exact
- compacted output preserves useful structure such as commands, code, errors, and sectioned text instead of flattening everything into generic lines

## Inspect what happened

```bash
openclaw-recall memory list
openclaw-recall memory explain "你记得我的偏好吗？"
openclaw-recall profile list
openclaw-recall session inspect plugin-smoke-3
```

Success indicators:

- `memory list` contains preference rows mentioning Felix, Chinese, or concise replies
- `memory explain` gives ranked retrieval reasons
- `memory explain` now includes `retrievalMode`, keyword/semantic contribution, selected rows, and suppressed noisy rows
- `profile list --json` shows at least one run with `promptTokensSource: "exact"`
- `session inspect` shows tool results with `savedTokens > 0`

## Noise pruning demo

```bash
openclaw-recall memory prune-noise --dry-run
openclaw-recall memory prune-noise
openclaw-recall memory reindex --dry-run
openclaw-recall memory compact --dry-run
```

Expected result:

- old metadata/control-ui/heartbeat/scaffold rows are reported before pruning
- the real prune pass deactivates them instead of silently deleting everything
- `reindex` refreshes old rows into the current scope/fingerprint/suppression model
- `compact` keeps stale history inspectable while shrinking oversized inactive rows

## Remote reconnect roundtrip

```bash
openclaw-recall backend serve --port 4546 --data-dir .recall-http-backend
openclaw-recall config init --mode reconnect --backend-type recall-http --endpoint http://127.0.0.1:4546 --memory-space team-alpha --identity-key team-alpha-key --write-openclaw
openclaw-recall export memory
openclaw-recall import run <exported-memory.json>
openclaw-recall doctor
openclaw-recall status
openclaw-recall memory explain "Felix 中文 backend import quality"
```

Expected result:

- `status.backendType` is `recall-http`
- `status.memorySpaceId` matches the configured shared space
- `availableMemorySpaces` includes the restored space
- a restored recall-style question now surfaces the strongest surviving project focus or stable preferences
- `memory explain` shows `retrievalMode`, selected rows, and suppressed rows without leaking debug data into normal chat
- later `memory explain` results stop surfacing those noisy rows

## Backup and recovery demo

```bash
openclaw-recall export memory
openclaw-recall export profile
openclaw-recall export session --session <sessionId>
```

Then on the new machine:

```bash
openclaw-recall config init --mode reconnect --identity-key recall_xxx --memory-space space_xxx --write-openclaw
openclaw-recall import run /path/to/export-dir
openclaw-recall doctor
openclaw-recall status
```

## Sample status output

```json
{
  "enabled": true,
  "memoryCount": 3,
  "profileCount": 3,
  "sessionCount": 3,
  "recentRetrievalCount": 3,
  "recentCompressionSavings": 207,
  "recentMemoryWrites": 0,
  "hygiene": {
    "score": 100,
    "noisyActiveCount": 0
  },
  "latestProfile": {
    "promptTokensSource": "exact",
    "compressionSavingsSource": "estimated"
  }
}
```
