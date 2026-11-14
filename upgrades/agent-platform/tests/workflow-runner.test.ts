import assert from 'node:assert/strict';
import test from 'node:test';
import {getDemoTransactions, runDetectionPipeline} from '@tracelayer/aml-engine';
import {CapabilityRegistry} from '../src/capability-registry';
import {compareDetectorSettings, compareSyntheticBenchmarks, createAmlCapabilityRegistry} from '../src/capabilities/aml-capabilities';
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

test('validates active datasets and returns coverage without transaction rows', async () => {
  const registry = createAmlCapabilityRegistry();
  const context = {runId: 'test-run', workflowId: 'test', startedBy: 'test-analyst'};
  const transactions = getDemoTransactions();
  const valid = await registry.execute('overview.validate_dataset', {
    transactions,
    sourceLabel: 'demo dataset',
    hasGroundTruthLabels: true,
  }, context) as Record<string, unknown>;

  assert.equal(valid.valid, true);
  assert.equal(valid.transactionCount, transactions.length);
  assert.ok(Number(valid.uniqueAccountCount) > 0);
  assert.ok(Number(valid.totalVolume) > 0);
  assert.deepEqual(valid.labelCoverage, {
    labeledRows: transactions.length,
    unlabeledRows: 0,
    positiveRows: transactions.filter((row) => row.is_laundering === 1).length,
    eligibleForEvaluation: true,
  });
  assert.equal('transactions' in valid, false);
  assert.equal('edges' in valid, false);

  const invalid = await registry.execute('overview.validate_dataset', {
    transactions: [
      {tx_id: 'private-tx-id', sender: 'private-account', receiver: 'other', amount: 10, timestamp: '2025-01-01'},
      {tx_id: 'private-tx-id', sender: 'private-account', receiver: 'other', amount: 20, timestamp: '2025-01-02'},
    ],
  }, context) as Record<string, unknown>;
  assert.equal(invalid.valid, false);
  assert.match(String(invalid.issue), /Duplicate transaction IDs/);
  assert.equal(JSON.stringify(invalid).includes('private-tx-id'), false);
  assert.equal(JSON.stringify(invalid).includes('private-account'), false);
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

test('cancels queued and active workflows without starting later steps', async () => {
  const registry = new CapabilityRegistry();
  let firstStepCalls = 0;
  let laterStepCalls = 0;
  let signalFirstStepStarted!: () => void;
  const firstStepStarted = new Promise<void>((resolve) => { signalFirstStepStarted = resolve; });
  registry.register({
    descriptor: {id: 'test.wait', screen: 'overview', permission: 'read', description: 'Wait for cancellation.'},
    execute: (_input, context) => {
      firstStepCalls += 1;
      signalFirstStepStarted();
      return new Promise<never>((_resolve, reject) => {
        context.signal?.addEventListener('abort', () => reject(new Error('Aborted by run cancellation.')), {once: true});
      });
    },
  });
  registry.register({
    descriptor: {id: 'test.after', screen: 'overview', permission: 'read', description: 'Must not run after cancellation.'},
    execute: () => { laterStepCalls += 1; return {ok: true}; },
  });
  const runner = new AgentWorkflowRunner(registry, new InMemoryAgentRunStore());
  runner.registerWorkflow({
    id: 'cancellable', name: 'Cancellable', description: 'A cancellation test.',
    steps: [
      {id: 'wait', capabilityId: 'test.wait', resolveInput: () => ({})},
      {id: 'after', capabilityId: 'test.after', resolveInput: () => ({})},
    ],
  });

  const queued = await runner.enqueue('cancellable', {}, 'test-analyst');
  const cancelledBeforeStart = await runner.cancel(queued.id);
  assert.equal(cancelledBeforeStart?.status, 'cancelled');
  assert.equal(firstStepCalls, 0);

  const active = await runner.enqueue('cancellable', {}, 'test-analyst');
  await firstStepStarted;
  const cancelledWhileRunning = await runner.cancel(active.id);
  assert.equal(cancelledWhileRunning?.status, 'cancelled');
  assert.equal(laterStepCalls, 0);
  assert.deepEqual(cancelledWhileRunning?.completedSteps, []);
  const events = await runner.getRunEvents(active.id);
  assert.equal(events.filter((event) => event.type === 'run_cancelled').length, 1);
  assert.equal(events.some((event) => event.type === 'run_failed'), false);
});

test('compares detector settings against active findings without mutating the baseline', () => {
  const baseline = runDetectionPipeline(getDemoTransactions());
  const originalAlertIds = baseline.alerts.map((alert) => alert.alert_id);
  const comparison = compareDetectorSettings(baseline.edges, baseline.alerts, {
    K: 100,
    WHours: 1,
    cycleWHours: 1,
    HMinutes: 1,
    minRetention: 1,
  });

  assert.equal(comparison.baselineAlertCount, 3);
  assert.equal(comparison.candidateAlertCount, 0);
  assert.equal(comparison.removedAlertCount, 3);
  assert.equal(comparison.addedAlertCount, 0);
  assert.equal(comparison.removedExamples.length, 3);
  assert.deepEqual(baseline.alerts.map((alert) => alert.alert_id), originalAlertIds);
  assert.throws(() => compareDetectorSettings(baseline.edges, baseline.alerts, {K: 1}), /outside its supported range/);
  assert.throws(() => compareDetectorSettings(baseline.edges, baseline.alerts, {riskModel: {}}), /Unsupported comparison setting/);
  assert.throws(() => compareDetectorSettings(baseline.edges, baseline.alerts, {}), /at least one/);
});

test('compares two synthetic benchmark seeds and labels the result as seed sensitivity only', () => {
  const comparison = compareSyntheticBenchmarks({rows: 1_000, seedA: 42, seedB: 43, splitRatio: 0.7});

  assert.equal(comparison.synthetic, true);
  assert.equal(comparison.rows, 1_000);
  assert.deepEqual(comparison.runs.map((run) => run.seed), [42, 43]);
  assert.ok(comparison.runs.every((run) => run.trainRows + run.testRows === 1_000));
  assert.equal(
    comparison.candidateMinusBaseline.hybridF1,
    Math.round((comparison.runs[1].hybrid.f1 - comparison.runs[0].hybrid.f1) * 10_000) / 10_000,
  );
  assert.match(comparison.interpretation, /not evidence of real-world or production performance/);
  assert.throws(() => compareSyntheticBenchmarks({rows: 1_000, seedA: 42, seedB: 42}), /different/);
  assert.throws(() => compareSyntheticBenchmarks({rows: 25_001, seedA: 42, seedB: 43}), /100 to 25,000/);
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
