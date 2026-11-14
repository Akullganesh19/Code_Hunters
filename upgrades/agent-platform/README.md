# Agent platform prototype

This is an isolated prototype. It uses the current shared AML engine but does not change or connect to the judge/demo app.

## What works now

- A capability registry with explicit screen ownership and `read`, `draft`, or `write` permission levels.
- A workflow runner that records run and step events, rejects unknown capabilities, and stops before any `write` action.
- A five-screen workflow for overview analysis, investigation evidence, adversarial testing, SAR draft generation, and benchmark evaluation.
- A Gemma task endpoint that validates JSON tool calls, maps them to registered screen capabilities, and adds prerequisite analysis where needed.
- A standalone console at `http://127.0.0.1:3100/`, with synthetic data loading, an AI-task button, and a deterministic workflow button.
- An HTTP API for listing capabilities/workflows, starting runs, and reading run history.

The Gemma fine-tuning pipeline is in `upgrades/gemma-agent/`. Until a trained adapter is loaded by its local model server, `POST /api/agent/tasks` returns `503`; the deterministic five-screen workflow remains runnable without the model. Draft actions stop at analyst review and write-level actions are never exposed to the model.

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
- `GET /api/agent/demo-input` (synthetic fixture transactions)
- `POST /api/agent/tasks` with `{ "task": "...", "input": { "transactions": [...] } }`
- `POST /api/agent/runs` with `{ "workflowId": "aml.five_screen_review", "input": { "transactions": [...] }, "startedBy": "analyst-id" }`
- `GET /api/agent/runs/:runId`
- `GET /api/agent/runs/:runId/events`

Starting the five-screen workflow runs all five registered capabilities in order. The SAR dossier output pauses at `needs_review`. Write-level capabilities are stopped before execution.

Runs are held in memory and disappear when the process stops. The console and APIs are for local development with synthetic data, not production use.

## Checks

```sh
npm --prefix upgrades/agent-platform run lint
npm --prefix upgrades/agent-platform test
```
