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

Install dependencies once from the repository root, then start both the API and the Vite frontend:

```sh
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The API runs at `http://127.0.0.1:3001`; Vite proxies `/api` requests to it.

You can also run either process separately:

```sh
npm run dev:backend
npm run dev:frontend
```

## API

- `GET /api/health` reports whether the API is ready.
- `POST /api/analyze` accepts `{ "transactions": [...], "options": {...} }` and returns normalized transactions, alerts, and runtime metrics.

For a separately hosted frontend, set `VITE_API_BASE_URL` to the backend origin. Configure the backend's `CORS_ORIGIN` for that frontend origin.

## Checks

```sh
npm run lint
npm test
npm run build
```

The bundled sample transactions are synthetic. Alerts are investigation cues for human review, not findings of wrongdoing. The API is an unauthenticated local development service; add authentication and private network controls before handling real transaction data.

## Local AML research database

Build a queryable SQLite database from the bundled validation CSV and the deterministic synthetic benchmark:

```sh
python3 scripts/build_aml_database.py
```

This creates `data/aml_research.sqlite` with 250,000 generated benchmark transactions by default, the bundled validation rows, account rollups, indexes, and a source catalog. Set `AML_DB_ROWS=1000000` to generate a larger database. The generated rows are synthetic AMLworld-style fixtures and are **not** IBM's original AMLworld transactions. Every transaction has a `source_id`; use the `sources` table to trace provenance. `database_info` records row counts and the synthetic-data caveat.

The supplied links mostly describe architectures, code, or research. They do not expose a bulk transaction dataset. IBM's separately distributed [AML-Data repository](https://github.com/IBM/AML-Data) points to the HI-Small dataset under CDLA-Sharing-1.0; it is catalogued as an external dataset and is not copied into this database. Download and import it separately only under its data license. Research article examples are not imported as transaction evidence.

Example query:

```sql
SELECT source_id, COUNT(*) AS transactions,
       SUM(is_laundering) AS labelled_laundering
FROM transactions
GROUP BY source_id;
```
