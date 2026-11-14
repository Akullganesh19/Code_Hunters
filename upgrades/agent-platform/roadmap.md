# Agent platform roadmap

## Prototype status

The local app has a model-backed chat agent using the configured OpenAI-compatible provider (Groq or local Ollama) through the AI SDK. The agent has typed tools for all five current screens, can navigate the workspace and open verified alerts, and can propose a Confirmed/Dismissed disposition; the analyst must apply that proposal in the UI. The prior deterministic five-screen workflow remains available.

The conversational model is configured through an OpenAI-compatible endpoint. The app does not ship or train model weights. An internal service token, durable redacted SQLite workflow summaries, and privacy-conscious chat/tool-call audit events are implemented. There is no per-user identity, tenant isolation, server-side durable queue, or production-grade audit integrity/export. Do not expose this system or use it with real customer data.

The transaction CSV remains separate and is not used to train the language model. Agent quality still needs a reviewed instruction/action evaluation set before making production reliability claims.

## Local model

Configure the OpenAI-compatible provider with `AGENT_MODEL_BASE_URL`, `AGENT_MODEL`, and `AGENT_MODEL_API_KEY`. See `README.md` for setup.

## Phase 1 — capability coverage

- Cover each current screen's important user tasks with bounded, typed agent tools.
- Add controlled data-import recommendations and validation for rejected rows. Active-dataset schema and coverage validation, dossier consistency checks before export, detector what-ifs, and two-seed synthetic benchmark comparisons are implemented.
- Keep evidence IDs and current screen settings attached to tool outputs.

**Done when:** each supported task maps to a documented capability, and unsupported tasks return a clear limitation.

## Phase 2 — reliable state

- Propagate interactive chat cancellation from the browser disconnect through the HTTP handler to the model provider. Implemented for chat requests.
- Add a durable restartable queue and bounded retries. Workflow cancellation and durable request-level idempotency are implemented. A connected browser now retries an interrupted run once by resubmitting the same request and idempotency key; the service still does not retain encrypted job inputs or resume queued work on its own.
- Add complete access-controlled audit events while keeping sensitive transaction contents out of routine run-history storage. Chat lifecycle, tool-call start/completion, and proposed-action type are stored without prompts, tool arguments, or outputs; per-user identity and audit integrity controls remain open.
- Add machine-readable input/output schemas for the versioned capabilities and audit tool calls without storing unnecessary transaction contents. Positive capability contract versions, registry/manifest parity, and metadata-only tool-call audit events are implemented.
- Show progress, evidence, and pending analyst actions consistently in the frontend.

**Done when:** a run survives service restarts and can be inspected later with a complete, access-controlled history.

## Phase 3 — reviewed instruction examples and agent evaluation

- Keep language-model instruction examples empty until reviewed examples are available.
- When available, record analyst request, active screen, expected capabilities and arguments, source evidence, expected answer, and whether the correct response is abstention or review.
- Keep a held-out evaluation set that is not used for prompt tuning.

Measure task success, tool-call validity, evidence coverage, unsupported-claim rate, abstention quality, latency, and cost.

## Phase 4 — identity, privacy, and operations

- Add per-user and per-tenant access control, retention rules, audit export, rate limits, and production monitoring.
- Add prompt-injection, malformed-input, and permission-boundary evaluations using reviewed cases.
- Add future screens by registering capabilities and a view adapter, without granting broad host or filesystem access.

**Done when:** each agent action has an authenticated user, tenant scope, evidence trail, and enforceable permission policy.

## Consequential actions

Alert dispositions require an explicit analyst click. Filing a SAR, restricting an account, or communicating externally must remain behind explicit authorization and a production-grade, audited workflow.
