# Quickstart

## Goal

Get the plugin installed, enabled, and verified with the fewest moving parts.

This document tracks the beta release path for `0.3.0-beta.1`.

## Prerequisites

- Node.js 24+
- OpenClaw installed and working
- local shell access to the machine that runs OpenClaw

## Fast path

```bash
git clone https://github.com/Felix201209/openclaw-memory-plugin.git
cd openclaw-memory-plugin
npm install
npm run build
openclaw plugins install --link .
openclaw plugins info openclaw-memory-plugin
openclaw-memory-plugin doctor
openclaw-memory-plugin status
npm run demo
```

## What each step does

1. `npm install`
   installs plugin dependencies and a local OpenClaw dev dependency for validation.
2. `npm run build`
   produces the plugin entrypoint and standalone CLI in `dist/`.
3. `openclaw plugins install --link .`
   registers the plugin path in your active `openclaw.json`.
4. `openclaw plugins info openclaw-memory-plugin`
   confirms OpenClaw can discover and load it.
5. `openclaw-memory-plugin doctor`
   checks config, storage, embeddings, inspect path, and recent runtime evidence.
6. `openclaw-memory-plugin status`
   shows current memory/profile/session counts and latest run activity.
7. `npm run demo`
   proves automatic memory write, cross-session recall, tool compaction, and profile capture.

## Optional: write a starter config entry

Print a starter entry:

```bash
openclaw-memory-plugin config init
```

Merge the starter entry into the active `openclaw.json`:

```bash
openclaw-memory-plugin config init --write-openclaw
```

## Environment overrides

Start from [`.env.example`](/Users/felix/Documents/openclaw-memory-plugin/.env.example).

Most users can stay with defaults. The most common overrides are:

```bash
OPENCLAW_MEMORY_PLUGIN_EMBEDDING_PROVIDER=local
OPENCLAW_MEMORY_PLUGIN_CONTEXT_BUDGET=2400
OPENCLAW_MEMORY_PLUGIN_RECENT_TURNS=6
OPENCLAW_MEMORY_PLUGIN_HTTP_PATH=/plugins/openclaw-memory-plugin
```

## Verify hooks with a short demo

```bash
npm run demo
```

That shows:

- automatic memory write
- cross-session recall
- tool compaction
- profile recording

## Full smoke validation

```bash
npm run smoke
```

This runs:

- type-check
- build
- unit tests
- embedded integration test
- install-path integration test

## Release-grade validation

```bash
npm run verify
```

This additionally checks:

- tarball contents are clean
- install-from-tarball works in a fresh consumer directory
- the installed package can be linked into OpenClaw
- the installed CLI can run doctor/status/session inspect

## What success looks like

- `openclaw plugins info openclaw-memory-plugin` shows `Status: loaded`
- `openclaw-memory-plugin doctor` has no `fail` checks
- `openclaw-memory-plugin status` shows non-zero `memoryCount` and `profileCount` after the demo
- `openclaw-memory-plugin profile list --json` shows `promptTokensSource: "exact"` on provider paths that return usage
