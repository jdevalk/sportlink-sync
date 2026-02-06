---
created: 2026-02-06T12:15
title: Document and simplify adding custom sync targets
area: docs
files:
  - pipelines/
  - steps/
  - lib/
  - docs/
  - scripts/sync.sh
---

## Problem

Currently adding a new sync target (like FreeScout, Nikki, or a future integration) requires understanding the full codebase structure: pipelines, steps, lib clients, DB layers, sync.sh registration, cron setup, etc. There's no guide explaining how to add your own, and the process could be made more straightforward.

Two aspects:
1. **Documentation:** Write a developer guide (`docs/adding-sync-targets.md` or similar) explaining the pipeline/step pattern, how to wire up a new target, required pieces (client, DB layer, pipeline orchestrator, step scripts, sync.sh entry)
2. **Simplification:** Look at whether the boilerplate can be reduced — common patterns extracted, a template/scaffold, or a more pluggable architecture that makes adding targets less manual

## Solution

TBD — Start with documentation (capture current patterns), then evaluate what simplification is worthwhile vs over-engineering.
