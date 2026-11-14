# Agent platform roadmap

## Phase 1 — foundations

- Add persistent agent-run records and an event log.
- Add a backend job queue with cancellation, retry limits, and idempotency.
- Define versioned capability input/output contracts and permission checks.
- Show run status and evidence consistently in the frontend.

**Done when:** an analyst can start a run, leave the page, return later, and inspect the same complete run history.

## Phase 2 — read-only workflows

- Overview: validate data, analyze it, and summarize ranked alerts.
- Investigation: assemble a timeline and bounded graph evidence for a selected alert.
- Adversarial Lab: run synthetic scenarios and compare detector outcomes.
- Evaluation: run a reproducible benchmark and flag changed metrics.

**Done when:** every factual statement links to source transactions or a named benchmark result, and re-running the same inputs produces a comparable result.

## Phase 3 — case drafting with review

- Generate a SAR case draft from selected alerts and evidence.
- Check required fields and identify unsupported claims.
- Add an analyst review step before a draft can be marked ready.

**Done when:** the agent can prepare a reviewable draft but cannot file it or change an alert disposition.

## Phase 4 — reliability and operations

- Replay historical datasets and synthetic adversarial cases.
- Track false positives, missed patterns, latency, and agent abstentions.
- Add per-tenant access control, retention rules, audit export, and production monitoring.
- Add future screens by registering capabilities and a view adapter, without changing existing workflow definitions.

**Done when:** new screens can expose approved agent actions without granting the agent unrestricted access to the interface or data.
