# TraceLayer agent upgrade guide

## Current milestone

TraceLayer has a model-backed agent panel using the configured OpenAI-compatible provider and the AI SDK's `ToolLoopAgent`. Model choice is deployment configuration; model weights and private credentials are not included in this repository.

The agent can operate registered capabilities covering all five screens: Overview analysis and dataset search; Investigation alert, account, and transaction inspection plus a proposed disposition; Adversarial Lab simulations; SAR dossier drafting; and Evaluation of labelled data or a reproducible benchmark. It can also run the deterministic five-screen workflow.

The model does not compute AML findings or decide guilt. It chooses tools and summarizes returned evidence. A disposition proposal requires an analyst click. SAR drafts are never filed. No file-system, shell, unrestricted browser, account restriction, or external communication tools are granted.

## What remains prototype-only

Redacted workflow summaries and status events persist in SQLite, but full capability outputs and chat histories are not durable audit records. The TraceLayer login screen is intentionally removed. An internal service token is implemented, but per-user authentication and tenant isolation are not; put a trusted identity-aware gateway in front of any network deployment. Do not use the service with real customer data until these controls are implemented.

The development machine has about 16 GB RAM and no CUDA GPU, so the local 4B quantized model is for integration development and must be evaluated before relying on it. The 122B model family is not a local fit for this machine. A larger Hugging Face endpoint can be configured, but selected tool results may include account IDs, transaction IDs, amounts, and timestamps; confirm data handling before sending those remotely.

The transaction CSV can be used for AML detector evaluation, but not as language-model instruction data. Agent quality still needs a reviewed instruction/action evaluation set before making production reliability claims.

## Next upgrades

1. Inventory every screen action and add remaining focused capabilities, including detector-threshold what-if analysis, import/validation, dossier validation/export, and comparison of benchmark runs.
2. Add cancellation, retry limits, idempotency, and access-controlled, useful audit events that preserve enough evidence for review without copying full transaction records into run history.
3. Add authentication, role and tenant checks, retention controls, and rate limits before connecting customer datasets.
4. Build a held-out agent evaluation set from reviewed real analyst requests when available. Measure correct tool selection, valid arguments, evidence coverage, unsupported claims, abstentions, latency, and cost.
5. Keep consequential actions outside automatic model execution. Add an audited confirmation workflow before ever enabling SAR filing, account restrictions, or external messages.

## Model configuration

The agent reads these environment variables:

- `AGENT_MODEL_BASE_URL` (default `http://127.0.0.1:11434/v1`)
- `AGENT_MODEL` (defaults to `qwen3.5:4b` for local Ollama, or `grok-4.7` for Groq)
- `AGENT_MODEL_API_KEY` (defaults to `ollama` for local Ollama; use a secret for hosted providers)

See `README.md` for local and Hugging Face-compatible provider setup.
