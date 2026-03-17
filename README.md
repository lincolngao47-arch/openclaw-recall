# 🦞OpenClaw Recall🦞

**Persistent memory, context compression, and profile visibility for OpenClaw.🦞**

<p align="center">
  <img
    width="744"
    height="193"
    alt="Screenshot 2026-03-17 at 07 27 30"
    src="https://github.com/user-attachments/assets/deb61efe-93a8-47b3-9ae9-b5cc2c741625"
  />
</p>
[简体中文](https://github.com/Felix201209/openclaw-recall/blob/main/zh-cn.md)

Current stable release: **`1.3.0`** · npm: **`@felixypz/openclaw-recall`**

---

## Overview

OpenClaw Recall is a memory infrastructure plugin for OpenClaw. It solves the problems that emerge once an agent is used across sessions:

| Problem | Solution |
|---|---|
| User preferences forgotten between sessions | Automatic memory write across 4 memory types |
| Long transcripts waste prompt budget | Layered context compression with budget enforcement |
| Large tool payloads replayed into the model | Tool output compaction with saved-token reporting |
| Memory behavior hard to inspect | `doctor`, `status`, `memory explain`, `profile inspect` |
| Old noisy rows pollute recall | Write-time and retrieval-time guardrails |

**Memory types supported:** `preference` · `semantic` · `episodic` · `session_state`

---

## What's New in 1.3.0

This release focuses on retrieval quality and import fidelity.

**Retrieval improvements**
- Hybrid retrieval now uses RRF-style fusion so stable preferences, project context, and active task context survive together
- Candidate-pool expansion and MMR-style diversification reduce duplicate preference-heavy recall
- Retrieval gate skips irrelevant memory work for command-like prompts
- Relation-aware stitching improves project/task recall after import or restore
- `RELEVANT MEMORY` is less duplicate-heavy and more relevance-per-token efficient

**Compaction improvements**
- Tool-output compaction preserves commands, error stacks, code blocks, and semi-structured sections
- Provider-style wrapper payloads are unwrapped before compaction

**Import improvements**
- Long-form import chunks oversized memories and transcript segments for better signal survival
- Duplicate rows are merged or superseded instead of duplicated
- `rejectedNoise`, `rejectedSensitive`, and `uncertainCandidates` tracked separately
- Generic imports no longer silently promote semantic memory into `shared`

---

## Install

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
npm install && npm run build
openclaw plugins install --link .
openclaw-recall config init --mode local --write-openclaw
openclaw plugins info openclaw-recall
openclaw-recall config validate
openclaw-recall doctor
openclaw-recall status
```

---

## Identity Modes

| Mode | When to use |
|---|---|
| `local` | Machine-local durable memory only |
| `reconnect` | Reconnect the same memory space across machines or a fresh OpenClaw home |

```bash
# Local
openclaw-recall config init --mode local

# Reconnect
openclaw-recall config init --mode reconnect --identity-key recall_xxx --memory-space space_xxx

openclaw-recall config validate
```

> **Security:** Identity keys are secrets. Store them in a password manager.

---

## Quick Value Check (5 minutes)

**1. Write a preference**
```
Remember that I like you to call me Felix.
```

**2. Verify recall in a new session**
```
Did you remember my preferences?
```

**3. Trigger a tool payload**
```
read "README.md"
```

**4. Inspect results**
```bash
openclaw-recall memory list
openclaw-recall memory explain "Did you remember my preferences?"
openclaw-recall profile list
openclaw-recall session inspect <sessionId>
```

**Success looks like:**
- Memory rows mentioning `Felix`, `English`, or `Concise`
- Recall works without replaying the earlier transcript
- Tool results show `savedTokens > 0`
- Profile rows show compression evidence

See [EXAMPLES.md](EXAMPLES.md) for a full copyable walkthrough.

---

## Recommended First-Use Workflow

1. Install the plugin
2. Initialize config (`local` or `reconnect`)
3. `openclaw-recall import dry-run`
4. `openclaw-recall import run`
5. Verify with `doctor` · `status` · `memory explain` · `profile inspect`

If you already have transcripts or memory files, importing them is the fastest proof path.

---

## Operator CLI Reference

```bash
# Health
openclaw-recall doctor
openclaw-recall status

# Config
openclaw-recall config show
openclaw-recall config validate
openclaw-recall config init

# Import / Export
openclaw-recall import dry-run
openclaw-recall import run
openclaw-recall import status
openclaw-recall export memory
openclaw-recall export profile
openclaw-recall export session --session <sessionId>

# Memory
openclaw-recall memory list
openclaw-recall memory inspect <id>
openclaw-recall memory search "<query>"
openclaw-recall memory explain "<query>"
openclaw-recall memory prune-noise [--dry-run]
openclaw-recall memory reindex [--dry-run]
openclaw-recall memory compact [--dry-run]

# Profile & Session
openclaw-recall profile list
openclaw-recall profile inspect <runId>
openclaw-recall session list
openclaw-recall session inspect <sessionId>

# Backend
openclaw-recall backend serve
```

---

## Inspect Routes

Available inside OpenClaw at:

```
/plugins/openclaw-recall/dashboard
/plugins/openclaw-recall/status
/plugins/openclaw-recall/memories
/plugins/openclaw-recall/profiles
/plugins/openclaw-recall/sessions
/plugins/openclaw-recall/sessions/:sessionId
```

---

## Configuration

### Defaults

| Setting | Default |
|---|---|
| Embeddings | Local hashed |
| Context budget | `2400` tokens |
| Recent-turn window | `6` turns |
| Preference TTL | Long |
| Episodic TTL | Short |
| Automatic memory write | Enabled |
| Detailed profiles | Enabled |

### Precedence

1. `OPENCLAW_RECALL_*` environment variables
2. `plugins.entries.openclaw-recall.config`
3. Built-in defaults

Legacy `OPENCLAW_MEMORY_PLUGIN_*` variables are accepted as compatibility aliases during the rename transition.

### Identity Variables

```
OPENCLAW_RECALL_IDENTITY_MODE
OPENCLAW_RECALL_IDENTITY_KEY
OPENCLAW_RECALL_MEMORY_SPACE_ID
OPENCLAW_RECALL_IDENTITY_API_KEY
OPENCLAW_RECALL_IDENTITY_ENDPOINT
OPENCLAW_RECALL_EXPORT_DIRECTORY
```

---

## Memory Quality Guardrails

### Write-time filters reject:
- Sender metadata, cron/heartbeat records, control-plane labels
- Wrapper text, debug annotations, scaffold fragments
- Low-value emotion-only lines

### Retrieval-time suppression prevents:
- Old noisy rows dominating recall
- Stale or superseded rows crowding out current memory
- Internal wrapper/debug text leaking into normal answers

### Stable preference extraction favors:
`偏直接` · `偏执行导向` · `偏中文` · `偏简洁` · structured reporting preferences

### Memory hygiene commands:
```bash
openclaw-recall memory prune-noise --dry-run
openclaw-recall memory prune-noise
openclaw-recall memory reindex
openclaw-recall memory compact
```

### What `status` reports:
`noisyActiveMemoryCount` · `lastPrune` · `lastReindex` · `lastCompact` · `hygiene` · `recentImportStats` · `lastExportPath`

### What `memory explain` exposes:
`retrievalMode` · selected rows with `finalScore` · `keywordContribution` · `semanticContribution` · suppressed noisy rows with suppression reasons

Debug data stays in inspect paths only — normal chat replies remain clean.

---

## Compatibility

Verified for `1.3.0`:

- Node.js `24.10.0` and `24.12.0`
- OpenClaw `2026.3.13`
- OpenAI Responses runtime (exact prompt-token accounting)
- Source-link and tarball install flows

See [COMPATIBILITY.md](COMPATIBILITY.md) for the full matrix.

---

## Metric Accuracy

| Metric | Source |
|---|---|
| `promptTokensSource` | `exact` when provider usage metadata is available; `estimated` otherwise |
| `compressionSavingsSource` | `estimated` (heuristic comparison) |
| `toolTokensSavedSource` | `estimated` (heuristic comparison) |

---

## Known Limitations

- Compression and tool-token savings are partly estimated
- Provider smoke coverage is strongest on the OpenAI Responses path
- `openclaw <subcommand>` CLI exposure is upstream-limited; use `openclaw-recall` directly
- OpenClaw may emit `plugins.allow is empty` warning noise in some install flows
- Memory conflict resolution is rule-based (stable preference supersession supported)
- `reconnect` uses the built-in `recall-http` backend; generic external remote backends are not release-verified

---

## Build & Verification

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

---

## Documentation

| File | Contents |
|---|---|
| [QUICKSTART.md](QUICKSTART.md) | Fast path from install to first recall |
| [OPENCLAW-INTEGRATION.md](OPENCLAW-INTEGRATION.md) | Plugin integration details |
| [COMPATIBILITY.md](COMPATIBILITY.md) | Verified, supported, and partial coverage matrix |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Internal design and component overview |
| [OPERATIONS.md](OPERATIONS.md) | Production operation guide |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Common issues and fixes |
| [EXAMPLES.md](EXAMPLES.md) | Copyable walkthroughs |
| [RELEASE_NOTES.md](RELEASE_NOTES.md) | Release-level summaries |
| [CHANGELOG.md](CHANGELOG.md) | Full change history |
