# Agent platform prototype

This is an isolated prototype. It uses the current shared AML engine but does not change or connect to the judge/demo app.

## What works now

- A capability registry with explicit screen ownership and `read`, `draft`, or `write` permission levels.
- A workflow runner that records run and step events, rejects unknown capabilities, and stops before any `write` action.
- A five-screen workflow for overview analysis, investigation evidence, adversarial testing, SAR draft generation, and benchmark evaluation.
- An HTTP API for listing capabilities/workflows, starting runs, and reading run history.

This is a deterministic workflow orchestrator, not an LLM planner yet. Keeping workflow choices explicit makes the first iteration reproducible. A model can be added later to propose plans that the registry and policy layer validate before execution.

## Run it locally

From the repository root, install dependencies if needed, then run:

```sh
npm --prefix upgrades/agent-platform run dev
```

The service binds to `127.0.0.1:3100` by default. Set `AGENT_PORT` to use a different local port.

## Endpoints

- `GET /api/agent/health`
- `GET /api/agent/capabilities`
- `GET /api/agent/workflows`
- `POST /api/agent/runs` with `{ "workflowId": "aml.five_screen_review", "input": { "transactions": [...] }, "startedBy": "analyst-id" }`
- `GET /api/agent/runs/:runId`
- `GET /api/agent/runs/:runId/events`

Starting the five-screen workflow runs all five registered capabilities in order. The SAR dossier output pauses at `needs_review`. Write-level capabilities are stopped before execution.

Runs are held in memory and disappear when the process stops. This prototype is for local development with synthetic data, not production use.

## Checks

```sh
npm --prefix upgrades/agent-platform run lint
npm --prefix upgrades/agent-platform test
```
