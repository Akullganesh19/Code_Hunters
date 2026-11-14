import assert from 'node:assert/strict';
import test from 'node:test';
import {getDemoTransactions} from '@tracelayer/aml-engine';
import {CapabilityRegistry} from '../src/capability-registry';
import {createAmlCapabilityRegistry} from '../src/capabilities/aml-capabilities';
import {GemmaTaskAgent} from '../src/gemma-task-agent';
import {InMemoryAgentRunStore} from '../src/run-store';
import {AgentWorkflowRunner} from '../src/workflow-runner';
import {fiveScreenReviewWorkflow} from '../src/workflows/five-screen-review';

function mockModelFetch(responseText: string): typeof fetch {
  return async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as {prompt: string};
    return new Response(JSON.stringify({text: payload.prompt + responseText}), {
      status: 200,
      headers: {'content-type': 'application/json'},
    });
  };
}

test('Gemma-selected capabilities execute through the registry and stop at draft review', async () => {
  const calls = [
    'overview.analyze_dataset',
    'investigation.inspect_alert',
    'adversarial.run_scenario',
    'dossier.draft_case',
    'evaluation.run_benchmark',
  ].map((name) => `<|tool_call>call:${name}{}<tool_call|>`).join('');
  const registry = createAmlCapabilityRegistry();
  const runner = new AgentWorkflowRunner(registry, new InMemoryAgentRunStore());
  runner.registerWorkflow(fiveScreenReviewWorkflow);
  const agent = new GemmaTaskAgent(registry, runner, undefined, mockModelFetch(calls));
  const result = await agent.run(
    'Run a complete five-screen review on the loaded transactions.',
    {transactions: getDemoTransactions(), benchmarkRows: 100},
    'test-analyst'
  );
  assert.equal(result.plan.length, 5);
  assert.equal(result.run.status, 'needs_review');
  assert.deepEqual(result.run.completedSteps, ['overview', 'investigation', 'adversarial_lab', 'sar_dossier', 'evaluation']);
  assert.equal(result.events.at(-1)?.type, 'approval_required');
});

test('Gemma write actions are rejected before a run is created', async () => {
  const registry = new CapabilityRegistry();
  registry.register({
    descriptor: {id: 'case.submit', screen: 'sar_dossier', permission: 'write', description: 'Submit an external report.'},
    execute: () => ({submitted: true}),
  });
  const runner = new AgentWorkflowRunner(registry, new InMemoryAgentRunStore());
  const agent = new GemmaTaskAgent(registry, runner, undefined, mockModelFetch('<|tool_call>call:case.submit{}<tool_call|>'));
  await assert.rejects(agent.run('File the report now.', {}, 'test-analyst'), /unavailable or write capability/);
});

test('new screen capabilities are discovered and executed without editing the agent core', async () => {
  const registry = new CapabilityRegistry();
  registry.register({
    descriptor: {id: 'future.review_case', screen: 'future_review', permission: 'read', description: 'Review a case in a newly added screen.'},
    execute: (input) => input,
  });
  const runner = new AgentWorkflowRunner(registry, new InMemoryAgentRunStore());
  const agent = new GemmaTaskAgent(
    registry,
    runner,
    undefined,
    mockModelFetch('<|tool_call>call:future.review_case{"caseId":"CASE-42"}<tool_call|>')
  );
  const result = await agent.run('Review case CASE-42.', {source: 'queue'}, 'test-analyst');
  assert.equal(result.run.status, 'completed');
  assert.deepEqual(result.run.outputs.future_review_case, {source: 'queue', caseId: 'CASE-42'});
});

test('evaluation can run without a loaded transaction dataset', async () => {
  const registry = createAmlCapabilityRegistry();
  const runner = new AgentWorkflowRunner(registry, new InMemoryAgentRunStore());
  runner.registerWorkflow(fiveScreenReviewWorkflow);
  const agent = new GemmaTaskAgent(
    registry,
    runner,
    undefined,
    mockModelFetch('<|tool_call>call:evaluation.run_benchmark{"rows":100,"seed":7}<tool_call|>')
  );
  const result = await agent.run('Evaluate detector quality on the synthetic benchmark.', {}, 'test-analyst');
  assert.equal(result.run.status, 'completed');
  assert.deepEqual(result.run.completedSteps, ['evaluation']);
});
