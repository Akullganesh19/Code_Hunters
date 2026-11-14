import {randomUUID} from 'node:crypto';
import type {
  AgentRun,
  AgentRunEvent,
  WorkflowDefinition,
  WorkflowContext,
} from './contracts';
import {CapabilityRegistry} from './capability-registry';
import type {AgentRunStore} from './run-store';

interface ActiveRun {
  controller: AbortController;
  execution: Promise<void>;
}

export class AgentWorkflowRunner {
  private readonly workflows = new Map<string, WorkflowDefinition>();
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly store: AgentRunStore
  ) {}

  registerWorkflow(workflow: WorkflowDefinition): void {
    if (this.workflows.has(workflow.id)) {
      throw new Error(`Workflow "${workflow.id}" is already registered.`);
    }
    if (workflow.steps.length === 0) {
      throw new Error(`Workflow "${workflow.id}" must contain at least one step.`);
    }
    const stepIds = new Set<string>();
    for (const step of workflow.steps) {
      if (stepIds.has(step.id)) throw new Error(`Duplicate step ID "${step.id}".`);
      if (!this.registry.has(step.capabilityId)) {
        throw new Error(`Workflow references unknown capability "${step.capabilityId}".`);
      }
      stepIds.add(step.id);
    }
    this.workflows.set(workflow.id, workflow);
  }

  listWorkflows(): Array<Pick<WorkflowDefinition, 'id' | 'name' | 'description'>> {
    return [...this.workflows.values()].map(({id, name, description}) => ({id, name, description}));
  }

  async start(workflowId: string, initialInput: unknown, startedBy: string): Promise<AgentRun> {
    const {run} = await this.createRun(workflowId, initialInput, startedBy, 'running');
    const active = this.launch(run, initialInput, startedBy);
    await active.execution;
    return (await this.store.get(run.id)) ?? run;
  }

  async enqueue(
    workflowId: string,
    initialInput: unknown,
    startedBy: string,
    idempotency?: {key: string; fingerprint: string},
  ): Promise<AgentRun> {
    const {run, created} = await this.createRun(workflowId, initialInput, startedBy, 'queued', idempotency);
    if (!created) return run;
    const controller = new AbortController();
    const execution = new Promise<void>((resolve, reject) => {
      setImmediate(() => {
        void this.execute(run, initialInput, startedBy, controller.signal).then(resolve, reject);
      });
    }).finally(() => this.activeRuns.delete(run.id));
    this.activeRuns.set(run.id, {controller, execution});
    return run;
  }

  async cancel(runId: string): Promise<AgentRun | null> {
    const run = await this.store.get(runId);
    if (!run) return null;
    if (run.status !== 'queued' && run.status !== 'running') return run;

    const active = this.activeRuns.get(runId);
    if (active) {
      active.controller.abort(new Error('Workflow cancelled by analyst.'));
      await active.execution;
    } else if (run.status === 'queued') {
      await this.markCancelled(run);
    }
    return this.store.get(runId);
  }

  private async createRun(
    workflowId: string,
    initialInput: unknown,
    startedBy: string,
    status: 'queued' | 'running',
    idempotency?: {key: string; fingerprint: string},
  ): Promise<{run: AgentRun; created: boolean}> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow "${workflowId}" is not registered.`);

    const now = new Date().toISOString();
    const run: AgentRun = {
      id: randomUUID(),
      workflowId,
      status,
      startedBy,
      createdAt: now,
      updatedAt: now,
      completedSteps: [],
      outputs: {},
    };
    const existing = await this.store.create(run, idempotency);
    if (existing) return {run: existing, created: false};
    await this.record(run, {type: 'run_started', detail: workflow.name});
    return {run, created: true};
  }

  private launch(run: AgentRun, initialInput: unknown, startedBy: string): ActiveRun {
    const existing = this.activeRuns.get(run.id);
    if (existing) return existing;
    const controller = new AbortController();
    const execution = this.execute(run, initialInput, startedBy, controller.signal)
      .finally(() => this.activeRuns.delete(run.id));
    const active = {controller, execution};
    this.activeRuns.set(run.id, active);
    return active;
  }

  private async execute(
    run: AgentRun,
    initialInput: unknown,
    startedBy: string,
    signal: AbortSignal,
  ): Promise<void> {
    const workflow = this.workflows.get(run.workflowId);
    if (!workflow) throw new Error(`Workflow "${run.workflowId}" is not registered.`);

    try {
      if (signal.aborted) {
        await this.markCancelled(run);
        return;
      }
      run.status = 'running';
      run.updatedAt = new Date().toISOString();
      await this.store.update(run);

      for (const step of workflow.steps) {
        if (signal.aborted) {
          await this.markCancelled(run);
          return;
        }
        const descriptor = this.registry.descriptor(step.capabilityId);
        if (descriptor.permission === 'write') {
          run.status = 'needs_review';
          run.updatedAt = new Date().toISOString();
          await this.store.update(run);
          await this.record(run, {
            type: 'approval_required',
            stepId: step.id,
            capabilityId: step.capabilityId,
            detail: 'Write capabilities cannot run automatically.',
          });
          return;
        }

        const context: WorkflowContext = {
          initialInput,
          outputs: structuredClone(run.outputs),
        };
        const input = step.resolveInput(context);
        const startedAt = performance.now();
        await this.record(run, {
          type: 'step_started',
          stepId: step.id,
          capabilityId: step.capabilityId,
        });

        const output = await this.registry.execute(step.capabilityId, input, {
          runId: run.id,
          workflowId: run.workflowId,
          startedBy,
          signal,
        });
        if (signal.aborted) {
          await this.markCancelled(run);
          return;
        }

        run.outputs[step.id] = output;
        run.completedSteps.push(step.id);
        run.updatedAt = new Date().toISOString();
        await this.store.update(run);
        await this.record(run, {
          type: 'step_completed',
          stepId: step.id,
          capabilityId: step.capabilityId,
          durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        });
      }

      if (signal.aborted) {
        await this.markCancelled(run);
        return;
      }
      run.status = workflow.requiresHumanReview ? 'needs_review' : 'completed';
      run.updatedAt = new Date().toISOString();
      await this.store.update(run);
      await this.record(run, {
        type: run.status === 'needs_review' ? 'approval_required' : 'run_completed',
        detail: workflow.requiresHumanReview ? 'Workflow output is ready for analyst review.' : undefined,
      });
    } catch (error) {
      if (signal.aborted) {
        await this.markCancelled(run);
        return;
      }
      run.status = 'failed';
      run.error = error instanceof Error ? error.message : 'Workflow failed.';
      run.updatedAt = new Date().toISOString();
      await this.store.update(run);
      await this.record(run, {type: 'run_failed', detail: run.error});
    }
  }

  private async markCancelled(run: AgentRun): Promise<void> {
    if (run.status === 'cancelled') return;
    run.status = 'cancelled';
    run.updatedAt = new Date().toISOString();
    await this.store.update(run);
    await this.record(run, {type: 'run_cancelled', detail: 'Workflow cancelled by analyst.'});
  }

  getRun(runId: string): Promise<AgentRun | null> {
    return this.store.get(runId);
  }

  listRuns(limit: number): Promise<AgentRun[]> {
    return this.store.list(limit);
  }

  getRunEvents(runId: string): Promise<AgentRunEvent[]> {
    return this.store.events(runId);
  }

  private async record(
    run: AgentRun,
    event: Omit<AgentRunEvent, 'id' | 'runId' | 'timestamp'>
  ): Promise<void> {
    await this.store.appendEvent({
      ...event,
      id: randomUUID(),
      runId: run.id,
      timestamp: new Date().toISOString(),
    });
  }
}
