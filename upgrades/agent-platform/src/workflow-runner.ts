import {randomUUID} from 'node:crypto';
import type {
  AgentRun,
  AgentRunEvent,
  WorkflowDefinition,
  WorkflowContext,
} from './contracts';
import {CapabilityRegistry} from './capability-registry';
import type {AgentRunStore} from './run-store';

export class AgentWorkflowRunner {
  private readonly workflows = new Map<string, WorkflowDefinition>();

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
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow "${workflowId}" is not registered.`);

    const now = new Date().toISOString();
    const run: AgentRun = {
      id: randomUUID(),
      workflowId,
      status: 'running',
      startedBy,
      createdAt: now,
      updatedAt: now,
      completedSteps: [],
      outputs: {},
    };
    await this.store.create(run);
    await this.record(run, {type: 'run_started', detail: workflow.name});

    try {
      for (const step of workflow.steps) {
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
          return run;
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
          workflowId,
          startedBy,
        });

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

      run.status = workflow.requiresHumanReview ? 'needs_review' : 'completed';
      run.updatedAt = new Date().toISOString();
      await this.store.update(run);
      await this.record(run, {
        type: run.status === 'needs_review' ? 'approval_required' : 'run_completed',
        detail: workflow.requiresHumanReview ? 'Workflow output is ready for analyst review.' : undefined,
      });
      return run;
    } catch (error) {
      run.status = 'failed';
      run.error = error instanceof Error ? error.message : 'Workflow failed.';
      run.updatedAt = new Date().toISOString();
      await this.store.update(run);
      await this.record(run, {type: 'run_failed', detail: run.error});
      return run;
    }
  }

  getRun(runId: string): Promise<AgentRun | null> {
    return this.store.get(runId);
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
