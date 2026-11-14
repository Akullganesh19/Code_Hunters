# Agent platform architecture

## Goal

Build one agent service that can answer analyst requests across every current and future TraceLayer screen. The model chooses from typed backend capabilities; it does not click buttons, inspect browser elements, or receive unrestricted host access.

## Components

```text
Frontend screens ── chat / start / review
       │
       ▼
Agent API ── Model planner ── Capability registry ── AML engine
    │                             │                    Dataset services
    └── Run coordinator ── Run history                 Screen capabilities
                                  │
                                  ▼
                           Analyst review
```

- **Run coordinator:** starts, resumes, cancels, and retries workflow runs.
- **Model planner:** uses the configured OpenAI-compatible language model to choose from registered TraceLayer tools.
- **Capability registry:** exposes typed backend actions with access rules, timeouts, and input limits.
- **Workflow definitions:** order capabilities into bounded tasks, define checkpoints, and state when analyst review is required.
- **Run history:** records the trigger, inputs, capability calls, evidence references, model output, and final status.
- **Frontend adapters:** let any screen start a workflow and render its progress, evidence, and review requests consistently.

## Run lifecycle

`queued → running → needs_review → completed`

Runs may also finish as `failed` or `cancelled`. Each step records its input, output, timestamps, and evidence references. Retries use an idempotency key so they do not create duplicate findings or case drafts.

## Screen-independent integration

Screens register capabilities and display metadata; they do not own agent behavior. A capability has a stable ID, description, input/output contract, permission level, timeout, and evidence requirements. Workflows refer to capability IDs rather than frontend routes.

Adding a future screen means adding its capability definitions and UI adapter. Existing workflows remain usable because they call the registry, not the screen component.

## Guardrails

- Keep detection, scoring, and validation deterministic in the AML engine.
- Treat model output as a suggestion; include source transaction IDs for factual claims.
- Give the model access to all registered TraceLayer capabilities, with input validation and permission checks at the server boundary.
- Require an explicit analyst action to apply a proposed alert disposition. SAR filing, account restrictions, and external communication remain outside the agent's tool set.
- Stop and request review when evidence is missing, contradictory, or outside the workflow's scope.
- Keep credentials out of prompts, logs, and capability responses. Keep the local model as the default for sensitive data; explicitly review data handling before configuring a remote model endpoint.
