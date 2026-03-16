# Release Notes

## OpenClaw Recall v1.2.0

`1.2.0` is a real minor release because it materially improves Recall's memory composition and practical token efficiency. The focus is still memory-first: better retrieval composition, better prompt relevance-per-token, cleaner tool-output compaction, and stronger import/retrieval benchmarks without weakening hygiene or output safety.

### Highlights

- candidate-pool expansion and MMR-style diversification reduce duplicate-heavy recall
- relation-aware retrieval stitching improves mixed recall across stable preference, project context, and active task/session state
- `RELEVANT MEMORY` is less duplicate-heavy and more efficient per token
- tool-output compaction preserves more useful structure, including commands, code blocks, and error-rich output
- wrapper-heavy provider payloads are unwrapped before compaction so compression acts on useful text instead of JSON shells
- import quality is stronger in practice: more useful signal survives while noise and sensitive rows remain rejected
- new benchmark coverage proves retrieval, compaction, import, and operator behavior more directly

### User-visible benefits

- recall now does a better job of mixing “who the user is”, “what the project is”, and “what the current task is”
- prompts waste less space on duplicate preference summaries
- tool-output compaction keeps more high-value structure per token
- imports are more likely to produce useful later recall instead of just adding rows
- operator surfaces remain honest and inspectable while the memory system gets more selective

### Install

```bash
npm install @felixypz/openclaw-recall
openclaw plugins install --link ./node_modules/@felixypz/openclaw-recall
openclaw plugins info openclaw-recall
openclaw-recall doctor
openclaw-recall status
```

### Compatibility

- verified OpenClaw target: `>=2026.3.13`
- verified Node versions: `24.10.0`, `24.12.0`
- strongest validated provider/runtime path: `openai-responses`
- verified backends: `local` and built-in `recall-http`
- verified install paths: source install, installed-package link, generated tarball, clean consumer remote roundtrip

### Known limitations

- `compressionSavings` and `toolTokensSaved` remain partly `estimated`
- OpenClaw plugin CLI exposure through `openclaw <subcommand>` is still upstream-limited; use `openclaw-recall`
- OpenAI-compatible embeddings are supported but not covered by the strongest release-confidence path
- some OpenClaw install/info flows may emit `plugins.allow is empty` warning noise
- memory conflict resolution remains rule-based
