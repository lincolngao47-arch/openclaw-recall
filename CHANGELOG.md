# Changelog

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
