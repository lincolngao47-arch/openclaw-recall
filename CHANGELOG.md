# Changelog

## 1.2.0

- improved retrieval composition with candidate-pool expansion, MMR-style diversification, and relation-aware retrieval stitching
- sharpened recall queries so mixed questions can return stable preferences together with current project/task context instead of over-returning near-duplicate preference rows
- reduced duplicate prompt injection in `RELEVANT MEMORY` with a stronger memory digest and duplicate-aware prompt composition
- upgraded tool-output compaction with stronger structural chunking, repeated-line collapse, and provider-wrapper unwrapping before compaction
- improved import benchmark coverage and verified better signal retention for preference plus project-context imports while continuing to reject noise and sensitive rows
- added focused retrieval-quality, compaction-quality, import-quality, prompt-composition, and operator-visibility benchmark fixtures
- kept hygiene, scaffold leakage prevention, clean-answer discipline, and inspectability intact while adding the new retrieval and compaction logic

## 1.1.0

- added a formal `MemoryBackend` abstraction with `LocalBackend`, built-in `recall-http` remote backend support, and reconnect-mode access to the same memory space across installs
- upgraded retrieval to a full `keyword` / `embedding` / `hybrid` pipeline with explainable contribution reporting and safe keyword fallback when embeddings are unavailable
- completed scope-aware memory behavior for `private`, `workspace`, `shared`, and `session` across write, retrieval, import, export, inspect, and reconnect flows
- upgraded import/export/recovery with smarter normalization, duplicate merge and supersede reporting, scope preservation, sensitive/noise rejection, and clean-install restore coverage
- strengthened lifecycle intelligence so stale semantic facts remain inspectable while becoming retrieval-ineligible by default, and surfaced lifecycle-aware hygiene summaries in operator workflows
- added `memory reindex` and `memory compact` alongside persisted maintenance reports and lifecycle-aware hygiene scoring
- improved restored natural-language recall after reconnect/import so restored installs surface stable preferences or current project focus in the normal answer path
- hardened doctor/status/memory inspect/profile inspect/session inspect with backend mode, memory space, scope, lifecycle, retrieval mode, and hygiene visibility
- verified release-confidence paths across source install, tarball install, clean consumer install, built-in backend serve, reconnect, import/export restore, and installed-package operator CLI execution

## 1.0.1

- moved the npm package to the user-owned scoped name `@felixypz/openclaw-recall` while keeping the plugin id and operator CLI as `openclaw-recall`
- hardened memory quality with stricter write-time rejection for metadata, wrappers, scaffold fragments, and low-value emotional noise
- strengthened retrieval suppression and ranking so stable user preferences outrank polluted or low-value records
- added preference/fact supersede coverage for common Chinese/English and concise/detailed preference changes
- added `memory prune-noise --dry-run` and persisted prune reports for operator workflows
- extended doctor/status/profile inspect with memory hygiene, latest prune metadata, and clearer runtime summaries
- tightened docs around verified vs supported paths and clean-output guarantees

## 1.0.0

- renamed the plugin to `OpenClaw Recall`
- renamed the npm package and operator CLI to `openclaw-recall`
- updated manifest, docs, inspect paths, config keys, and release metadata for the stable name
- verified the stable release chain: build, unit, integration, smoke, verify, tarball sanity, tarball install, and publish dry-run
- prepared the stable `v1.0.0` GitHub release and npm package

## 0.3.0-beta.1

- cut the first beta release line for the plugin
- added publish-facing compatibility documentation
- clarified beta limitations around estimated savings fields, provider coverage, and upstream warning noise
- verified full release chain again: build, unit, integration, smoke, verify, tarball sanity, and tarball install
- prepared GitHub beta release materials and beta versioning

## 0.2.0

- added installable OpenClaw plugin entry with hook-based memory/compression/profile integration
- added standalone operator CLI for doctor, status, config, memory, profile, and session inspection
- added install-path and embedded integration smoke tests
- added unit tests for extraction, ranking, dedupe/supersede, budget trimming, compression, and tool compaction
- added Quickstart, Examples, Troubleshooting, Operations, Architecture, and Integration docs
- added config init and config validate flows
- added inspect dashboard and JSON inspect endpoints
- added release build tarball generation
- added tarball sanity and install-from-tarball verification
- added exact-vs-estimated metric source reporting for prompt and savings data
- added stronger doctor/status checks for manifest/build/preference precedence and recent runtime evidence
- added optional `memory.autoWrite` toggle for operational control without uninstalling the plugin

## 0.1.0

- initial plugin extraction from the earlier NovaClaw enhancement layer
