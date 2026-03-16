# Release Notes

## OpenClaw Recall v1.0.1

`1.0.1` is a patch release. It does not add a new product surface or change the plugin boundary. It hardens the existing plugin in the areas that most affect long-term daily use: memory quality, output safety, maintenance tooling, and release confidence.

### Why this is a patch

- memory quality hardening
- output safety fixes
- prune / hygiene tooling
- operational polish
- compatibility clarification
- release confidence improvements

### Fixes

- moved the npm package to the scoped public package name `@felix201209/openclaw-recall`
- tightened write-time rejection for metadata, heartbeat, wrapper text, debug annotations, scaffold fragments, and low-value emotional noise
- improved retrieval suppression so noisy stored rows do not dominate normal recall
- improved preference extraction for directness, execution-oriented collaboration, structured reporting, Chinese/English preference, and concise/detailed preference changes
- improved conflict supersede behavior for the most common preference and project-focus updates
- added `memory prune-noise --dry-run` and persisted prune reports
- extended `doctor`, `status`, and `profile inspect` with hygiene and maintenance visibility
- cleaned up verified / supported / partial compatibility wording

### User-visible benefits

- fewer dirty memories get stored
- fewer noisy recalls show up later
- normal answers stay cleaner and less likely to leak internal scaffold
- operator debugging is easier through `doctor`, `status`, `memory inspect`, and `profile inspect`
- install, tarball, and clean-consumer confidence is higher

### Install

```bash
npm install @felix201209/openclaw-recall
openclaw plugins install --link ./node_modules/@felix201209/openclaw-recall
openclaw plugins info openclaw-recall
openclaw-recall doctor
openclaw-recall status
```

### Compatibility

- verified OpenClaw target: `>=2026.3.13`
- verified Node versions: `24.10.0`, `24.12.0`
- strongest validated provider path: `openai-responses`

### Known limitations

- `compressionSavings` and `toolTokensSaved` remain partly `estimated`
- OpenClaw plugin CLI exposure through `openclaw <subcommand>` is still upstream-limited; use `openclaw-recall`
- OpenAI-compatible embeddings are supported but not covered by the strongest smoke path
- some OpenClaw install/info flows may emit `plugins.allow is empty` warning noise
- memory conflict resolution remains rule-based
