# TraceLayer agent platform

The local TraceLayer agent is a model-backed analyst copilot with typed tools for every current product screen. Its model plans and explains; the deterministic AML engine computes findings, scores, graph evidence, and case drafts.

## Hugging Face model guidance

To compare Hugging Face models, use their model cards and supported inference providers. Check tool-calling support, license, context size, quantization, runtime requirements, privacy, and cost. Do not download the whole Hub; it contains far more models than this machine can run. Model-discovery tooling is developer-local and is not a TraceLayer runtime dependency.

Choose a model based on tool-calling reliability, license, context size, runtime, privacy, and cost. The app does not download or fine-tune model weights. It calls a model through the OpenAI-compatible provider configured below.

## Configure the provider

The model adapter uses an OpenAI-compatible endpoint. To use Groq, create a root `.env.local` file with:

```dotenv
AGENT_MODEL_BASE_URL=https://api.groq.com/openai/v1
AGENT_MODEL=openai/gpt-oss-120b
AGENT_MODEL_API_KEY=your-groq-key
```

`.env.local` is git-ignored and loaded by the agent's development and start scripts. Cloud inference receives the analyst's message and tool results selected during the run, which can include account IDs, transaction IDs, amounts, and timestamps. Use only with data approved for the configured provider. Never commit API keys.

## Current capabilities

| Screen | Agent actions |
| --- | --- |
| Overview | Validate dataset schema and coverage; analyze with active detector thresholds; search alerts, accounts, and transactions |
| Workspace | Navigate to any screen; open a verified alert directly in Investigation |
| Investigation | Inspect alert graph evidence; look up transactions; summarize account activity; propose Confirmed/Dismissed dispositions |
| Adversarial Lab | Run bounded synthetic scenarios against a sandbox copy of the current dataset |
| SAR Case Dossier | Validate alert references, source transactions, ledger metrics, and digest before enabling export |
| Evaluation | Evaluate eligible labelled data; run one synthetic benchmark; compare held-out metrics across two deterministic seeds to inspect seed sensitivity |

The agent can also run the existing five-screen workflow and navigate to a selected screen or verified alert. Use **Stop** to cancel an in-flight chat request or **Cancel workflow** to stop a queued or running review; closing the agent panel cancels its active chat request. Workflow execution is currently in-memory and will not resume after a service restart. The agent cannot read files outside TraceLayer or operate the host computer. Disposition proposals require an analyst click. SAR drafts are never filed. Account restrictions, external messages, and filing are not agent capabilities.

## Run locally

From the repository root, start the whole app and agent service with `npm run dev`, or start only the agent service with:

```sh
npm --prefix upgrades/agent-platform run dev
```

The agent service binds to `127.0.0.1:3100` by default. `GET /api/agent/health`, `GET /api/agent/capabilities`, and `GET /api/agent/workflows` expose local service status and registered tools. `POST /api/agent/chat` accepts the current analyst message, recent chat history, active dataset, screen, and detector thresholds. Existing `/api/agent/runs` routes start the deterministic five-screen workflow.

The app opens directly without a TraceLayer login screen. The API and agent require an internal service token in production and bind to loopback; use a trusted identity-aware gateway for any network deployment. Workflow runs and status events persist in `data/agent-runs.sqlite` by default (override with `AGENT_RUNS_DB_PATH`); stored outputs are redacted summaries, and interrupted runs are marked failed at startup. Runs are labeled `unattributed-local-session`; this is not a verified user identity. Retention defaults to 1,000 runs and can be changed with `AGENT_RUN_RETENTION_COUNT`. Chat transcripts and full evidence outputs are not persisted. Do not expose the app publicly without gateway authentication, tenant isolation, complete audit records, retention policy, and production operations controls.

## Checks

```sh
npm --prefix upgrades/agent-platform run lint
npm --prefix upgrades/agent-platform test
```
