# TraceLayer upgrades

This folder is a separate workspace for the next version of TraceLayer. The current app remains at the repository root and continues to be the judge/demo version. Keep new agent-platform work here until it has been reviewed and is ready to merge into the main app.

## Contents

- `agent-platform/architecture.md` — architecture for a screen-independent agent service.
- `agent-platform/UPGRADE_GUIDE.md` — recommended phased path from the current app to a model-backed agent.
- `agent-platform/capabilities.json` — initial capability catalog covering the current five screens.
- `agent-platform/roadmap.md` — phased implementation and acceptance criteria.
- `agent-platform/src/` — isolated capability registry, workflow runner, AML adapters, and local HTTP API.
- `agent-platform/tests/` — focused tests for five-screen execution and review gating.
The current app includes a model-backed agent with typed tools, navigation, analyst-confirmed disposition proposals, and durable redacted workflow history. The conversational model uses a configured OpenAI-compatible endpoint; it does not bundle or fine-tune a model. Upgrade work remains in progress; identity, tenant isolation, complete audit trails, job cancellation/retries, and production deployment controls are still required before publication for real AML operations.
