import assert from 'node:assert/strict';
import test from 'node:test';
import {getDemoTransactions} from '@tracelayer/aml-engine';
import {CapabilityRegistry} from '../src/capability-registry';
import {createAmlCapabilityRegistry} from '../src/capabilities/aml-capabilities';
import {InMemoryAgentRunStore} from '../src/run-store';
import {AgentWorkflowRunner} from '../src/workflow-runner';
import {fiveScreenReviewWorkflow} from '../src/workflows/five-screen-review';

test('registers an action for each of the five current screens', () => {
  const registry = createAmlCapabilityRegistry();
  const screens = new Set(registry.list().map((capability) => capability.screen));
  assert.deepEqual([...screens].sort(), [
    'adversarial_lab',
    'evaluation',
    'investigation',
    'overview',
    'sar_dossier',
  ]);
});

test('runs the five-screen workflow and pauses its dossier draft for review', async () => {
  const registry = createAmlCapabilityRegistry();
  const store = new InMemoryAgentRunStore();
  const runner = new AgentWorkflowRunner(registry, store);
  runner.registerWorkflow(fiveScreenReviewWorkflow);

  const run = await runner.start(
    fiveScreenReviewWorkflow.id,
    {transactions: getDemoTransactions(), sourceLabel: 'agent platform test', benchmarkRows: 100},
    'test-analyst'
  );

  assert.equal(run.status, 'needs_review');
  assert.deepEqual(run.completedSteps, [
    'overview',
    'investigation',
    'adversarial_lab',
    'sar_dossier',
    'evaluation',
  ]);
  assert.ok(run.outputs.sar_dossier);
  assert.ok(run.outputs.evaluation);

  const events = await runner.getRunEvents(run.id);
  assert.equal(events.filter((event) => event.type === 'step_completed').length, 5);
  assert.equal(events.at(-1)?.type, 'approval_required');
});

test('does not execute write capabilities automatically', async () => {
  const registry = new CapabilityRegistry();
  let executed = false;
  registry.register({
    descriptor: {
      id: 'case.submit',
      screen: 'sar_dossier',
      permission: 'write',
      description: 'Submit a case externally.',
    },
    execute() {
      executed = true;
      return {submitted: true};
    },
  });

  const runner = new AgentWorkflowRunner(registry, new InMemoryAgentRunStore());
  runner.registerWorkflow({
    id: 'blocked-write',
    name: 'Blocked write',
    description: 'Approval-gated action.',
    steps: [{id: 'submit', capabilityId: 'case.submit', resolveInput: () => ({})}],
  });

  const run = await runner.start('blocked-write', {}, 'test-analyst');
  assert.equal(run.status, 'needs_review');
  assert.equal(executed, false);
  assert.equal(run.completedSteps.length, 0);
});

test('rejects duplicate capability and workflow identifiers', () => {
  const registry = new CapabilityRegistry();
  const capability = {
    descriptor: {
      id: 'overview.ping',
      screen: 'overview' as const,
      permission: 'read' as const,
      description: 'A test capability.',
    },
    execute: () => ({ok: true}),
  };
  registry.register(capability);
  assert.throws(() => registry.register(capability), /already registered/);

  const runner = new AgentWorkflowRunner(registry, new InMemoryAgentRunStore());
  const workflow = {
    id: 'test-workflow',
    name: 'Test workflow',
    description: 'Test.',
    steps: [{id: 'ping', capabilityId: 'overview.ping', resolveInput: () => ({})}],
  };
  runner.registerWorkflow(workflow);
  assert.throws(() => runner.registerWorkflow(workflow), /already registered/);
});
