# TraceLayer

TraceLayer is an AML investigation workbench for exploring transaction networks, reviewing alerts, and preparing case material. The repository is organized as a small monorepo so the interface, API, and shared detection logic have clear homes.

## Repository layout

```text
backend/                 HTTP API and request handling
  src/server.ts
frontend/                React application and visual components
  src/components/
  src/services/           API client used by the interface
packages/aml-engine/      Shared AML domain logic and its tests
  src/                    detectors, scoring, evaluation, CSV, SAR dossier
  tests/                  engine regression tests
scripts/                  local developer commands
.github/                  CI workflow and repository guidance
```

### How the pieces fit

```text
Browser UI  ── /api/analyze ──>  Backend API
    │                               │
    └──── AML engine workspace ─────┘
```

The frontend owns screens, charts, navigation, and user interaction. The backend owns HTTP endpoints and request validation. `@tracelayer/aml-engine` contains the transaction model, detectors, scoring, evaluation, CSV utilities, and SAR dossier logic shared across the workspace.

## Run locally

Install dependencies once from the repository root, then start the API, agent workflow service, and Vite frontend together:

```sh
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The API runs at `http://127.0.0.1:3001`, the model-backed agent service at `http://127.0.0.1:3100`, and Vite proxies `/api` requests through the local services. The **Open agent** control provides chat, typed tools for the five screens, screen navigation, and a deterministic full-review workflow. The AML engine computes findings; disposition changes remain analyst-confirmed and SAR dossiers remain drafts.

You can also run either process separately:

```sh
npm run dev:backend
npm run dev:frontend
```

To run the agent service separately, use `npm --prefix upgrades/agent-platform run dev`.

## API

- `GET /api/health` reports whether the API is ready.
- `POST /api/analyze` accepts `{ "transactions": [...], "options": {...} }` and returns normalized transaction edges, alerts, and runtime metrics.

For a separately hosted frontend, route `/api` and `/api/agent` through a same-origin gateway that injects the internal token. Do not send the internal token to the browser or expose the backend ports directly.

## Security controls

The API and agent services bind to `127.0.0.1`. The local Vite server also binds to loopback and proxies agent requests through the same origin. The root `.env.local` is loaded server-side; `TRACELAYER_INTERNAL_TOKEN` is attached by the Vite proxy and is never exposed to the browser. There is no TraceLayer login screen: the workspace opens directly. `/api/health` and `/api/agent/health` remain public for readiness checks; other service routes require the internal token. Browser mutation requests from a different origin are rejected. For network deployment, place the app behind a trusted identity-aware gateway.

For production, set `NODE_ENV=production` and configure a random `TRACELAYER_INTERNAL_TOKEN` of at least 32 characters for both services. They refuse to start without it. Keep ports 3001 and 3100 private, terminate TLS at the gateway, and configure it to remove any incoming `x-tracelayer-internal-token` header before adding its own value from a secret store. Since TraceLayer itself has no user login or identity, enforce access at the gateway before exposing it beyond a trusted local environment.

Requests are limited to 25 MB and 50,000 transactions. Analysis runs in a worker with a 30-second deadline and a two-worker concurrency cap. Agent requests are capped at two concurrent operations, and model calls have a 60-second total timeout.

## Checks

```sh
npm run lint
npm test
npm run build
```

The bundled sample transactions are synthetic. Alerts are investigation cues for human review, not findings of wrongdoing. The agent keeps durable, redacted SQLite workflow summaries and recovers interrupted runs, but TraceLayer does not provide user identity, per-user or tenant isolation, or a complete audit record. Do not expose it publicly without gateway authentication and the remaining production operations controls.

## Local AML research database

Build a queryable SQLite database from the bundled validation CSV and the deterministic synthetic benchmark:

```sh
python3 scripts/build_aml_database.py
```

This creates `data/aml_research.sqlite` with 250,000 generated benchmark transactions by default, the bundled validation rows, account rollups, indexes, and a source catalog. Set `AML_DB_ROWS=1000000` to generate one million benchmark transactions. The generated rows are synthetic AMLworld-style fixtures and are **not** IBM's original AMLworld transactions. Every transaction has a `source_id`; use the `sources` table to trace provenance. `database_info` records row counts and the synthetic-data caveat. Set `AML_DB_PATH` to choose a different output file.

The supplied links mostly describe architectures, code, or research. They do not expose a bulk transaction dataset. IBM's separately distributed [AML-Data repository](https://github.com/IBM/AML-Data) points to the HI-Small dataset under CDLA-Sharing-1.0; it is catalogued as an external dataset and is not copied into this database. Download and import it separately only under its data license. Research article examples are not imported as transaction evidence.

Example query:

```sql
SELECT source_id, COUNT(*) AS transactions,
       SUM(is_laundering) AS labelled_laundering
FROM transactions
GROUP BY source_id;
```
