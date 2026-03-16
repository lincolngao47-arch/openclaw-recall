# Changelog

## 1.0.1

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
