# Compatibility

## Release target

This matrix applies to `0.3.0-beta.1`.

## Verified versions

### OpenClaw

- verified: `2026.3.13`
- compatibility target: `>=2026.3.13`
- peer dependency declared in [`package.json`](/Users/felix/Documents/openclaw-memory-plugin/package.json)

### Node.js

- verified: `24.10.0` and `24.12.0`
- declared engine: `>=24.0.0`

## Verified provider/runtime paths

### Fully smoke-tested

- `openai-responses`
  - prompt token usage can be `exact` when OpenClaw/provider usage metadata is available
  - verified in embedded integration, source install, and tarball install flows

### Supported but not fully smoke-tested in this beta

- OpenAI-compatible embeddings via `embedding.provider=openai`
  - configuration is supported
  - automated smoke currently covers local hashed embeddings by default instead

### Not yet beta-verified

- non-OpenAI runtime provider paths
  - no claim of parity or full smoke coverage in this beta

## Verified install paths

- source checkout + `openclaw plugins install --link .`
- release tarball install into a fresh consumer directory
- standalone CLI execution from built `dist/`
- standalone CLI execution from installed package bin

## Known unstable or limited areas

- `compressionSavings` and `toolTokensSaved` are still `estimated`
  - workaround: rely on source fields in profile output and treat savings as directional, not exact
- provider smoke coverage is uneven
  - workaround: prefer the verified OpenAI Responses path for first deployment
- plugin CLI exposure through `openclaw <subcommand>` is not reliable upstream
  - workaround: use the standalone `openclaw-memory-plugin` binary
- OpenClaw may emit `plugins.allow is empty` warning noise in some install/info flows
  - workaround: set explicit `plugins.allow` in OpenClaw config
- memory conflict resolution is still rule-based
  - workaround: inspect memory rows with `memory explain` / `memory inspect` when tuning behavior

## Evidence used for this beta

- `npm run build`
- `npm run test:unit`
- `npm run test:integration`
- `npm run smoke`
- `npm run verify`
- tarball sanity and install-from-tarball smoke included in `verify`
