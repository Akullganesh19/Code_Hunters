# Agent platform architecture

## Goal

Build one background agent service that can run approved workflows across current and future TraceLayer screens. The agent works through backend capabilities and structured workflow steps. It does not click buttons, inspect browser elements, or depend on screen-specific prompts.

## Components

```text
Frontend screens
      │ start / view runs
      ▼
Agent API ── Run coordinator ── Capability registry
                    │                    │
                    ▼                    ├── AML engine
              Run history               ├── Dataset services
                    │                    └── Screen workflows
                    ▼
             Analyst review
```

- **Run coordinator:** starts, resumes, cancels, and retries workflow runs.
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
- Start with read-only access and draft-only writes.
- Require analyst approval for alert disposition, SAR filing, account restrictions, or external communication.
- Stop and request review when evidence is missing, contradictory, or outside the workflow's scope.
- Keep credentials and customer data out of prompts, logs, and capability responses unless a workflow explicitly needs them.
