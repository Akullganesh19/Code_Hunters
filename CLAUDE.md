# TraceLayer project guide

## Product and architecture

TraceLayer is a transaction-network investigation workbench with five screens: Overview, Investigation, Adversarial Lab, SAR Case Dossier, and Evaluation. The React app is in `frontend/`, the HTTP API is in `backend/`, shared AML logic and CSV handling are in `packages/aml-engine/`, and the model-backed agent is in `upgrades/agent-platform/`. The root is an npm workspace monorepo.

The deterministic AML engine is authoritative for alerts, evidence, scores, and benchmark metrics. The language model explains tool results and requests typed capabilities; never make it invent findings or replace deterministic calculations. Uploaded transaction values and chat history are untrusted input.

## Important safety boundaries

- Keep `.env*`, API keys, auth credentials, and internal tokens private. Do not print their values, add them to source control, or send them to a model unless the configured provider is approved for that data.
- Disposition proposals require an explicit analyst action. SAR case material is always a draft; do not add automatic filing, account restrictions, or external messaging.
- Keep adversarial scenarios isolated to sandbox copies. Do not mutate the active dataset with injected transactions.
- Evaluation requires valid binary ground-truth labels. A CSV with missing, malformed, or single-class labels is not a supervised evaluation set. Synthetic benchmark results must be identified as synthetic.
- Preserve local datasets and user changes. Do not overwrite or remove files under `data/` or the root CSV files as part of routine changes.

## Change workflow

1. Inspect the relevant screen, capability, engine code, and existing tests before editing.
2. Keep business rules in `packages/aml-engine/` or typed agent capabilities rather than duplicating them in React components.
3. Validate request schemas and bounds at the HTTP boundary. Keep screen navigation separate from consequential analyst decisions.
4. For behavior changes, update or add focused tests. Run the quality gates below before reporting a change complete.
5. Explain the observed behavior, the files changed, and any remaining operational limitations. Do not describe a local model or synthetic benchmark as production validated.

## Common commands

```sh
npm run dev
npm test
npm run lint
npm run build
```

`npm run dev` starts the local API, agent service, and Vite app. The production frontend build does not package either backend service; deployment must provide and secure them separately.

## Current limits to keep visible

The agent supports only registered TraceLayer tools; it has no host-computer or arbitrary filesystem access. Workflow summaries and status events persist in SQLite with evidence content redacted; chat transcripts and full tool outputs are not durable. TraceLayer has no user login or identity; gateway authentication and tenant controls are required before network deployment. Do not claim complete auditability or production readiness until those controls are implemented and verified.
