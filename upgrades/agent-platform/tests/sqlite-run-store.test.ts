import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {AgentRun, AgentRunEvent} from '../src/contracts';
import {SqliteAgentRunStore} from '../src/sqlite-run-store';

test('SQLite run history survives restart without persisting transaction contents', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tracelayer-agent-store-'));
  const databasePath = path.join(directory, 'runs.sqlite');
  const run: AgentRun = {
    id: 'run-complete',
    workflowId: 'aml.five_screen_review',
    status: 'needs_review',
    startedBy: 'analyst-claimed-by-client',
    createdAt: '2026-11-15T00:00:00.000Z',
    updatedAt: '2026-11-15T00:00:10.000Z',
    completedSteps: ['overview', 'investigation', 'adversarial_lab', 'sar_dossier', 'evaluation'],
    outputs: {
      overview: {
        edges: [{tx_id: 'private-transaction-id', sender: 'private-account-id'}],
        alerts: [{alert_id: 'private-alert-id'}],
      },
      investigation: {combinedEdges: [{tx_id: 'private-evidence-id'}]},
      adversarial_lab: {graphCaughtCount: 3, baselineCaughtCount: 1, totalInjected: 4, injectedAccounts: ['private-account-id']},
      sar_dossier: {dossier: {markdown: 'private case narrative'}},
      evaluation: {trainRows: 70, testRows: 30, seed: 42},
    },
  };
  const event: AgentRunEvent = {
    id: 'event-started',
    runId: run.id,
    type: 'run_started',
    timestamp: run.createdAt,
    detail: 'Five-screen AML review',
  };

  try {
    const store = await SqliteAgentRunStore.open(databasePath);
    await store.create(run);
    await store.appendEvent(event);
    await store.close();

    const reopened = await SqliteAgentRunStore.open(databasePath);
    const persistedRun = await reopened.get(run.id);
    assert.ok(persistedRun);
    assert.equal(persistedRun.status, 'needs_review');
    assert.equal(persistedRun.startedBy, 'authenticated-user');
    assert.deepEqual(persistedRun.outputs.overview, {
      redacted: true,
      transactionCount: 1,
      alertCount: 1,
    });
    assert.deepEqual(persistedRun.outputs.investigation, {
      redacted: true,
      evidenceTransactionCount: 1,
    });
    assert.deepEqual(persistedRun.outputs.adversarial_lab, {
      redacted: true,
      graphCaughtCount: 3,
      baselineCaughtCount: 1,
      totalInjected: 4,
    });
    assert.deepEqual(persistedRun.outputs.sar_dossier, {redacted: true, draftReady: true});
    assert.deepEqual(await reopened.events(run.id), [event]);

    const databaseText = await readFile(databasePath, 'utf8');
    for (const secret of ['private-transaction-id', 'private-account-id', 'private-alert-id', 'private case narrative']) {
      assert.equal(databaseText.includes(secret), false);
    }
    await reopened.close();
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('SQLite store marks interrupted workflows failed after a service restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tracelayer-agent-recovery-'));
  const databasePath = path.join(directory, 'runs.sqlite');
  const run: AgentRun = {
    id: 'run-interrupted',
    workflowId: 'aml.five_screen_review',
    status: 'running',
    startedBy: 'local-user',
    createdAt: '2026-11-15T00:00:00.000Z',
    updatedAt: '2026-11-15T00:00:00.000Z',
    completedSteps: ['overview'],
    outputs: {overview: {edges: [{tx_id: 'private-id'}], alerts: []}},
  };

  try {
    const store = await SqliteAgentRunStore.open(databasePath);
    await store.create(run);
    await store.close();

    const recoveredStore = await SqliteAgentRunStore.open(databasePath);
    const recoveredRun = await recoveredStore.get(run.id);
    assert.equal(recoveredRun?.status, 'failed');
    assert.match(recoveredRun?.error ?? '', /restarted/);
    assert.deepEqual(recoveredRun?.outputs.overview, {
      redacted: true,
      transactionCount: 1,
      alertCount: 0,
    });
    const events = await recoveredStore.events(run.id);
    assert.equal(events.at(-1)?.type, 'run_failed');
    assert.equal(events.at(-1)?.detail, 'The agent service restarted before this workflow finished.');
    await recoveredStore.close();
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('SQLite run retention prunes the oldest summaries and their events', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tracelayer-agent-retention-'));
  const databasePath = path.join(directory, 'runs.sqlite');
  const makeRun = (id: string, createdAt: string): AgentRun => ({
    id,
    workflowId: 'aml.five_screen_review',
    status: 'completed',
    startedBy: 'local-user',
    createdAt,
    updatedAt: createdAt,
    completedSteps: [],
    outputs: {},
  });

  try {
    const store = await SqliteAgentRunStore.open(databasePath, 2);
    const runs = [
      makeRun('run-oldest', '2026-11-13T00:00:00.000Z'),
      makeRun('run-middle', '2026-11-14T00:00:00.000Z'),
      makeRun('run-newest', '2026-11-15T00:00:00.000Z'),
    ];
    await store.create(runs[0]);
    await store.appendEvent({
      id: 'old-event',
      runId: runs[0].id,
      type: 'run_started',
      timestamp: runs[0].createdAt,
    });
    await store.create(runs[1]);
    await store.create(runs[2]);

    assert.deepEqual((await store.list(10)).map((run) => run.id), ['run-newest', 'run-middle']);
    assert.equal(await store.get('run-oldest'), null);
    assert.deepEqual(await store.events('run-oldest'), []);
    await store.close();
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
