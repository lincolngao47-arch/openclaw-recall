# Compatibility

## Release target

This matrix applies to `1.2.0`.

## Verified versions

### OpenClaw

- verified: `2026.3.13`
- compatibility target: `>=2026.3.13`

### Node.js

- verified: `24.10.0` and `24.12.0`
- declared engine: `>=24.0.0`

## Verified provider/runtime paths

### Fully release-verified

- `openai-responses`
  - prompt token usage can be `exact` when OpenClaw or the provider returns usage metadata
  - verified in embedded integration, source install, tarball install, installed-package operator flows, and remote reconnect roundtrip

### Supported with partial verification

- OpenAI-compatible embeddings via `embedding.provider=openai`
  - configuration, doctor, and config validation are supported
  - release-confidence automation still uses local hashed embeddings by default instead of a live embedding API

### Not release-verified

- non-OpenAI runtime provider paths
  - no claim of full smoke coverage in `1.2.0`

## Verified backend and memory modes

### Fully release-verified

- `local` backend mode
- built-in `recall-http` backend mode
- `reconnect` mode against the same `memorySpaceId`
- scope-aware retrieval across `private`, `workspace`, `shared`, and `session`
- export/import restore across clean installs using the same remote memory space

### Supported with partial verification

- `shared` cross-agent recall when installs intentionally use the same `sharedScope`
  - verified through operator and retrieval tests plus remote roundtrip coverage
  - still narrower than a broader multi-provider/team deployment matrix

## Verified install paths

- source checkout + `openclaw plugins install --link .`
- installed package + `openclaw plugins install --link ./node_modules/@felixypz/openclaw-recall`
- generated tarball install into a fresh consumer directory
- standalone CLI execution from `dist/`
- standalone CLI execution from installed package bin
- remote reconnect/import/export roundtrip across two fresh consumers

## Verified operator paths

- `openclaw-recall doctor`
- `openclaw-recall status`
- `openclaw-recall memory inspect`
- `openclaw-recall memory explain`
- `openclaw-recall memory prune-noise`
- `openclaw-recall memory reindex`
- `openclaw-recall memory compact`
- `openclaw-recall profile inspect`
- `openclaw-recall session inspect`
- `openclaw-recall backend serve`

## Known limited or partial areas

- `compressionSavings` and `toolTokensSaved` are still `estimated`
  - workaround: treat savings as directional, not exact
- provider smoke coverage is still strongest on the verified OpenAI Responses path
  - workaround: prefer the verified path for first deployment
- plugin CLI exposure through `openclaw <subcommand>` is not reliable upstream
  - workaround: use the standalone `openclaw-recall` binary
- OpenClaw may emit `plugins.allow is empty` warning noise in some install/info flows
  - workaround: set explicit `plugins.allow` in OpenClaw config
- memory conflict resolution is still rule-based
  - workaround: inspect memory rows with `memory explain` and `memory inspect` when tuning behavior

## Evidence used for 1.2.0

- `npm run build`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:install`
- `npm run verify`
- `npm run release:build`
- `npm run test:tarball:sanity`
- `npm run test:tarball`
- `npm run test:remote-roundtrip`
- retrieval-quality benchmark fixtures
- compaction benchmark fixtures
- import benchmark fixtures
- operator visibility benchmark fixtures
