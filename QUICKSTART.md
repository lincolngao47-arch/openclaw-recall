# Quickstart

Install OpenClaw Recall, prove the hooks are active, and verify memory, recall, compression, and profile output with the fewest moving parts.

Current stable version: `1.0.1`.

## Prerequisites

- Node.js 24+
- OpenClaw installed and working
- shell access on the machine that runs OpenClaw

## Fast path from npm

```bash
npm install @felix201209/openclaw-recall
openclaw plugins install --link ./node_modules/@felix201209/openclaw-recall
openclaw-recall config init --mode local --write-openclaw
openclaw plugins info openclaw-recall
openclaw-recall config validate
openclaw-recall doctor
openclaw-recall status
```

## Fast path from source

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

## Reconnect instead of local mode

If you already have an identity key or memory space id:

```bash
openclaw-recall config init --mode reconnect --identity-key recall_xxx --memory-space space_xxx
openclaw-recall config init --mode reconnect --identity-key recall_xxx --memory-space space_xxx --write-openclaw
openclaw-recall config validate
```

Use reconnect mode on a new machine when you want to restore the same logical memory space.

## Common environment overrides

Start from [`.env.example`](./.env.example).

```bash
OPENCLAW_RECALL_EMBEDDING_PROVIDER=local
OPENCLAW_RECALL_CONTEXT_BUDGET=2400
OPENCLAW_RECALL_RECENT_TURNS=6
OPENCLAW_RECALL_HTTP_PATH=/plugins/openclaw-recall
OPENCLAW_RECALL_IDENTITY_MODE=local
```

## Import first

```bash
openclaw-recall import dry-run
openclaw-recall import run
openclaw-recall import status
openclaw-recall memory prune-noise --dry-run
```

This scans common `memories/*.json`, `sessions/*.json`, `*.jsonl`, and local plugin artifacts before you seed a synthetic demo.

## First proof run

```bash
npm run demo
```

That demonstrates:

- automatic memory write
- cross-session recall
- tool compaction
- profile recording
- operator verification after import

## Full smoke path

```bash
npm run smoke
```

## Release-grade validation path

```bash
npm run verify
```

That additionally checks:

- tarball contents
- install from generated tarball
- OpenClaw plugin load from installed package path
- installed CLI execution for doctor/status/session inspect

## What success looks like

- `openclaw plugins info openclaw-recall` shows `Status: loaded`
- `openclaw-recall doctor` has no `fail` checks
- `openclaw-recall status` shows non-zero `memoryCount` and `profileCount` after a demo run
- `openclaw-recall status` also shows `noisyActiveMemoryCount` and the latest prune/import/export metadata
- `openclaw-recall import status` shows the last import report
- `openclaw-recall profile list --json` shows `promptTokensSource: "exact"` on provider paths that return usage
- `openclaw-recall memory prune-noise --dry-run` shows what would be deactivated before any stored memory changes

## Backup and recovery

```bash
openclaw-recall export memory
openclaw-recall export profile
openclaw-recall export session --session <sessionId>
```

Keep the exported files and your identity key. Recovery is:

1. install the plugin on the new machine
2. configure `local` or `reconnect`
3. run `import run` against the exported files
4. verify with `doctor` and `status`
