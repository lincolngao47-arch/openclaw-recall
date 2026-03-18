# 🦞 OpenClaw Recall 🦞

**Persistent memory, context compression, and profile visibility for OpenClaw. 🦞**

<p align="center">
  <img
    width="744"
    height="193"
    alt="OpenClaw Recall Banner"
    src="https://github.com/user-attachments/assets/deb61efe-93a8-47b3-9ae9-b5cc2c741625"
  />
</p>

**Other Language:** [简体中文](https://github.com/Felix201209/openclaw-recall/blob/main/zh-cn.md)

Current stable release: **`1.3.1`** · npm: **`@felixypz/openclaw-recall`**

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

## What's New in 1.3

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

```bash
npm install @felixypz/openclaw-recall
openclaw plugins install --link ./node_modules/@felixypz/openclaw-recall
openclaw-recall config init --mode local --write-openclaw
openclaw-recall doctor
```

For source install, identity modes, and first-use workflow → [QUICKSTART.md](QUICKSTART.md)

---

## Documentation

| File | Contents |
|---|---|
| [QUICKSTART.md](QUICKSTART.md) | Install, identity modes, and first-use workflow |
| [OPENCLAW-INTEGRATION.md](OPENCLAW-INTEGRATION.md) | Plugin integration and identity configuration |
| [COMPATIBILITY.md](COMPATIBILITY.md) | Verified, supported, and partial coverage matrix |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Internal design, components, and memory guardrails |
| [OPERATIONS.md](OPERATIONS.md) | CLI reference, configuration, inspect routes, metrics |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Common issues, known limitations, and fixes |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Build, verification, and contribution guide |
| [EXAMPLES.md](EXAMPLES.md) | Copyable walkthroughs |
| [RELEASE_NOTES.md](RELEASE_NOTES.md) | Release-level summaries |
| [CHANGELOG.md](CHANGELOG.md) | Full change history |
