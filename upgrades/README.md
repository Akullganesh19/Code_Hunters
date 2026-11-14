# TraceLayer upgrades

This folder is a separate workspace for the next version of TraceLayer. The current app remains at the repository root and continues to be the judge/demo version. Keep new agent-platform work here until it has been reviewed and is ready to merge into the main app.

## Contents

- `agent-platform/architecture.md` — proposed architecture for a screen-independent AI agent.
- `agent-platform/capabilities.json` — initial capability catalog covering the current five screens.
- `agent-platform/roadmap.md` — phased implementation and acceptance criteria.
- `agent-platform/src/` — isolated capability registry, workflow runner, AML adapters, and local HTTP API.
- `agent-platform/tests/` — focused tests for five-screen execution and review gating.

The files here describe and organize upgrade work; they are not wired into the current app yet.
