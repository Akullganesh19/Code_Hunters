import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectChronologicalCycles,
  detectFanInFanOut,
  detectRapidPassthrough,
} from '../src/detectors';
import { buildSarCaseDossier, formatDossierMarkdown, sha256Hex } from '../src/dossier';
import { evaluateTemporalSplit, runCounterexampleSuite } from '../src/evaluation';
import { generateIbmAmlBenchmark, getDemoTransactions, hasGroundTruthLabelColumn, hasValidGroundTruthLabels, parseCsvTransactions } from '../src/fixtures';
import {
  CLOSING_DISCLAIMER,
  ENTERPRISE_SCREENS,
  extractMotifSubgraph,
  injectAdversarialMotif,
  runDetectionPipeline,
  shouldMergeAlerts,
} from '../src/pipeline';
import { buildTransactionGraph, MAX_TRANSACTIONS_PER_REQUEST, ValidationError, validateTransactions } from '../src/schema';
import { computePriorityScore } from '../src/scoring';
import { isMacPlatform, isSearchShortcutEvent, searchDataset } from '../src/search';

test('UI specification expects exactly 5 Enterprise AML Command Center screens', () => {
  assert.equal(ENTERPRISE_SCREENS.length, 5);
  assert.deepEqual(
    [...ENTERPRISE_SCREENS],
    ['Overview', 'Investigation', 'Adversarial Lab', 'SAR Case Dossier', 'Evaluation']
  );
});

test('Empty input returns empty graph and zero alerts', () => {
  const res = runDetectionPipeline([]);
  assert.equal(res.alerts.length, 0);
  assert.equal(res.graph.nodes.size, 0);
  assert.equal(res.graph.edges.length, 0);
  assert.ok(res.runtimeMs >= 0.1);
  assert.equal(res.edgesPerSec, 0);
});

test('Bad inputs fail validation cleanly', () => {
  assert.throws(
    () =>
      validateTransactions([
        { tx_id: 'T1', sender: 'A', receiver: 'B', amount: -25, timestamp: '2026-01-01T00:00:00Z' },
      ]),
    ValidationError
  );

  assert.throws(
    () =>
      validateTransactions([
        { tx_id: 'T1', sender: 'A', receiver: 'B', amount: 100, timestamp: '2026-01-01T00:00:00Z' },
        { tx_id: 'T1', sender: 'A', receiver: 'C', amount: 200, timestamp: '2026-01-01T01:00:00Z' },
      ]),
    ValidationError
  );

  assert.throws(
    () =>
      validateTransactions([
        { tx_id: 'T1', sender: 'A', receiver: 'B', amount: 100, timestamp: 'not-a-timestamp' },
      ]),
    ValidationError
  );
});

test('Transaction requests have bounded row and identifier sizes', () => {
  assert.throws(() => validateTransactions(new Array(MAX_TRANSACTIONS_PER_REQUEST + 1)), ValidationError);
  assert.throws(() => validateTransactions([
    {tx_id: 'T1', sender: 'A'.repeat(257), receiver: 'B', amount: 25, timestamp: '2026-01-01T00:00:00Z'},
  ]), ValidationError);
});

test('Parallel edges between same accounts preserve distinct tx_id and timestamp', () => {
  const G = buildTransactionGraph([
    { tx_id: 'T1', sender: 'A', receiver: 'B', amount: 100, timestamp: '2026-01-01T00:00:00Z' },
    { tx_id: 'T2', sender: 'A', receiver: 'B', amount: 200, timestamp: '2026-01-01T00:05:00Z' },
  ]);
  assert.equal(G.edges.length, 2);
  assert.equal(G.outEdges.get('A')?.length, 2);
});

test('Fan-in/Fan-out flags burst hub A7843 and suppresses steady shop SHOP_STEADY_01', () => {
  const G = buildTransactionGraph(getDemoTransactions());
  const alerts = detectFanInFanOut(G, { K: 5, WHours: 24.0 });
  const hubs = new Set(alerts.map((a) => a.evidence.hub_account));

  assert.equal(hubs.has('A7843'), true);
  assert.equal(hubs.has('SHOP_STEADY_01'), false);

  const hubAlert = alerts.find((a) => a.evidence.hub_account === 'A7843')!;
  assert.ok(Number(hubAlert.evidence.repeat_txs) >= 2);
  assert.ok(hubAlert.score_breakdown.repeat > 0);
  assert.ok(hubAlert.priority_score >= 0 && hubAlert.priority_score <= 100);
});

test('Chronological cycle accepts ascending order and rejects wrong-order cycle of identical shape', () => {
  const G = buildTransactionGraph(getDemoTransactions());
  const alerts = detectChronologicalCycles(G, { minLen: 2, maxLen: 6, WHours: 48.0 });
  const accs = new Set(alerts.flatMap((a) => a.accounts));

  assert.equal(accs.has('CYC_ALPHA'), true);
  assert.equal(accs.has('CYC_BETA'), true);
  assert.equal(accs.has('CYC_GAMMA'), true);

  assert.equal(accs.has('BAD_C1'), false);
  assert.equal(accs.has('BAD_C2'), false);
  assert.equal(accs.has('BAD_C3'), false);
});

test('Chronological cycles below the minimum retention threshold are suppressed', () => {
  const G = buildTransactionGraph([
    { tx_id: 'LOW_RET_1', sender: 'A', receiver: 'B', amount: 100000, timestamp: '2026-01-01T00:00:00Z' },
    { tx_id: 'LOW_RET_2', sender: 'B', receiver: 'C', amount: 100000, timestamp: '2026-01-01T00:10:00Z' },
    { tx_id: 'LOW_RET_3', sender: 'C', receiver: 'A', amount: 500, timestamp: '2026-01-01T00:20:00Z' },
  ]);
  const alerts = detectChronologicalCycles(G, { minLen: 3, maxLen: 3 });

  assert.equal(alerts.length, 0);
});

test('Rapid pass-through chain flags fast high-retention chain and rejects slow low-retention chain', () => {
  const G = buildTransactionGraph(getDemoTransactions());
  const alerts = detectRapidPassthrough(G, { minHops: 3, HMinutes: 60.0, minRetention: 0.80 });
  const accs = new Set(alerts.flatMap((a) => a.accounts));

  assert.equal(accs.has('PT_MULE_1'), true);
  assert.equal(accs.has('PT_EXIT_5'), true);
  assert.equal(accs.has('SLOW_1'), false);
});

test('Detection pipeline returns non-negative runtime and throughput telemetry', () => {
  const result = runDetectionPipeline(getDemoTransactions());

  assert.equal(typeof result.runtimeMs, 'number');
  assert.ok(result.runtimeMs >= 0);
  assert.equal(typeof result.edgesPerSec, 'number');
  assert.ok(result.edgesPerSec >= 0);
});

test('Scoring formula matches exact weights and caps at 100', () => {
  const { score, breakdown } = computePriorityScore({
    durationHours: 0,
    totalAmount: 1_000_000,
    numAccounts: 15,
    retentionRatio: 1.0,
    repeatTxCount: 10,
  });
  assert.equal(score, 100);
  assert.equal(breakdown.speed_pts, 30);
  assert.equal(breakdown.amount_pts, 25);
  assert.equal(breakdown.accounts_pts, 15);
  assert.equal(breakdown.retention_pts, 20);
  assert.equal(breakdown.repeat_pts, 10);
});

test('Merging rules never merge on a single shared account alone', () => {
  const demo = runDetectionPipeline(getDemoTransactions());
  assert.ok(demo.alerts.length >= 3);

  const a1 = demo.alerts[0];
  const singleAcc = {
    ...a1,
    alert_id: 'TEST_SINGLE',
    accounts: [a1.accounts[0], 'UNRELATED_1', 'UNRELATED_2'],
    tx_ids: ['UNREL_TX_1', 'UNREL_TX_2'],
  };
  assert.equal(shouldMergeAlerts(a1, singleAcc), false);

  const twoAcc = {
    ...a1,
    alert_id: 'TEST_TWO_ACC',
    accounts: [a1.accounts[0], a1.accounts[1], 'EXTRA_1'],
    tx_ids: ['UNREL_TX_1'],
  };
  assert.equal(shouldMergeAlerts(a1, twoAcc), true);

  const oneAccOneTx = {
    ...a1,
    alert_id: 'TEST_ACC_TX',
    accounts: [a1.accounts[0], 'EXTRA_1'],
    tx_ids: [a1.tx_ids[0], 'UNREL_TX_2'],
  };
  assert.equal(shouldMergeAlerts(a1, oneAccOneTx), true);

  const twoTx = {
    ...a1,
    alert_id: 'TEST_TWO_TX',
    accounts: ['DISJOINT_A', 'DISJOINT_B'],
    tx_ids: [a1.tx_ids[0], a1.tx_ids[1]],
  };
  assert.equal(shouldMergeAlerts(a1, twoTx), true);
});

test('Every alert explanation ends with fixed disclaimer and subgraph caps at 75 edges', () => {
  const demoEdges = getDemoTransactions();
  const res = runDetectionPipeline(demoEdges);
  for (const a of res.alerts) {
    assert.ok(a.explanation.endsWith(CLOSING_DISCLAIMER));
    assert.equal(typeof a.xgb_risk_score, 'number');
    assert.equal(typeof a.risk_delta, 'number');
  }

  const sub = extractMotifSubgraph(demoEdges, res.alerts[0], 75);
  assert.ok(sub.combinedEdges.length <= 75);
  assert.ok(sub.motifEdges.length >= 1);
});

test('Adversarial motif injection catches sub-threshold structuring where baseline misses', () => {
  const demoEdges = getDemoTransactions();
  const { sandboxEdges, injectedTxIds } = injectAdversarialMotif(demoEdges, {
    typology: 'Rapid Pass-through',
    hopCount: 4,
    retentionRatio: 0.94,
    hopDelayMinutes: 20,
    amountPerTx: 8500, // sub-$10,000 structuring
    wrongTimeOrder: false,
  });

  const res = runDetectionPipeline(sandboxEdges);
  const flaggedSet = new Set(res.alerts.flatMap((a) => a.tx_ids));
  const caughtCount = injectedTxIds.filter((id) => flaggedSet.has(id)).length;
  assert.equal(caughtCount, 4);

  // Wrong-order cycle injection must be rejected
  const badCyc = injectAdversarialMotif(demoEdges, {
    typology: 'Chronological Cycle',
    hopCount: 3,
    retentionRatio: 0.95,
    hopDelayMinutes: 25,
    amountPerTx: 9000,
    wrongTimeOrder: true,
  });
  const resBad = runDetectionPipeline(badCyc.sandboxEdges);
  const badFlagged = new Set(resBad.alerts.flatMap((a) => a.tx_ids));
  assert.equal(
    badCyc.injectedTxIds.some((id) => badFlagged.has(id)),
    false
  );
});

test('SAR Case Dossier SHA-256 digest is deterministic and Markdown export contains ledger', () => {
  const demoEdges = getDemoTransactions();
  const res = runDetectionPipeline(demoEdges);
  const d1 = buildSarCaseDossier({
    selectedAlerts: [res.alerts[0]],
    allEdges: demoEdges,
    sourceLabel: 'synthetic demo data',
  });
  const d2 = buildSarCaseDossier({
    selectedAlerts: [res.alerts[0]],
    allEdges: demoEdges,
    sourceLabel: 'synthetic demo data',
  });

  assert.equal(d1.sha256Digest, d2.sha256Digest);
  assert.equal(d1.sha256Digest.length, 64);
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

  const md = formatDossierMarkdown(d1);
  assert.ok(md.includes(d1.sha256Digest));
  assert.ok(md.includes(CLOSING_DISCLAIMER));
  assert.ok(md.includes('Regulatory Format: FIU-IND Finnet 2.0 / FinCEN BSA'));
});

test('Temporal split 3-tier evaluation and counterexample suite pass cleanly', () => {
  const bench = generateIbmAmlBenchmark(4000, 42);
  const report = evaluateTemporalSplit(bench, { splitRatio: 0.70, seed: 42 });

  assert.equal(report.seed, 42);
  assert.equal(report.trainRows + report.testRows, bench.length);
  assert.equal(report.ablationTable.length, 3);
  assert.equal(report.perTypologyRecall.length, 3);
  assert.ok(report.telemetry.amountPsi >= 0);

  const checks = runCounterexampleSuite();
  assert.equal(checks.length, 7);
  for (const c of checks) {
    assert.equal(c.status, 'PASS', `Failed counterexample check: ${c.caseName}`);
  }
});

test('CSV parser handles both standard TraceLayer format and IBM HI-Small format', () => {
  const stdCsv = [
    'tx_id,sender,receiver,amount,timestamp',
    'T1,ACC1,ACC2,1200,2026-01-01T00:00:00Z',
    'T2,ACC2,ACC3,1150,2026-01-01T00:15:00Z',
  ].join('\n');
  const parsedStd = parseCsvTransactions(stdCsv);
  assert.equal(parsedStd.length, 2);
  const parsedBom = parseCsvTransactions(`\uFEFFtx_id,sender,receiver,amount,timestamp,is_laundering\nBOM1,A,B,1,2026-01-01T00:00:00Z,1`);
  assert.equal(parsedBom[0].tx_id, 'BOM1');
  assert.equal(parsedBom[0].is_laundering, 1);

  const ibmCsv = [
    'Timestamp,From Bank,Account,To Bank,Account.1,Amount Received,Receiving Currency,Amount Paid,Payment Currency,Payment Format,Is Laundering',
    '2026/01/01 00:10,001,8001A,002,9002B,5000,US Dollar,5000,US Dollar,Wire,1',
  ].join('\n');
  const parsedIbm = parseCsvTransactions(ibmCsv);
  assert.equal(parsedIbm.length, 1);
  assert.equal(parsedIbm[0].sender, '001_8001A');
  assert.equal(parsedIbm[0].is_laundering, 1);
});

test('Ground-truth CSV detection distinguishes missing, valid, and malformed labels', () => {
  assert.equal(hasGroundTruthLabelColumn('tx_id,sender,receiver,amount,timestamp\n1,a,b,10,2026-01-01'), false);
  assert.equal(hasValidGroundTruthLabels('tx_id,sender,receiver,amount,timestamp,is_laundering\n1,a,b,10,2026-01-01,0\n2,b,c,11,2026-01-02,1'), true);
  assert.equal(hasValidGroundTruthLabels('\uFEFFtx_id,sender,receiver,amount,timestamp,Is Laundering\n1,a,b,10,2026-01-01,0\n2,b,c,11,2026-01-02,1'), true);
  assert.equal(hasValidGroundTruthLabels('tx_id,sender,receiver,amount,timestamp,is_laundering\n1,a,b,10,2026-01-01,0\n2,b,c,11,2026-01-02,maybe'), false);
  assert.equal(hasValidGroundTruthLabels('tx_id,sender,receiver,amount,timestamp,is_laundering\n1,a,b,10,2026-01-01,1\n2,b,c,11,2026-01-02,'), false);
});

test('Dataset search finds accounts, transaction IDs, and alert IDs across entire dataset', () => {
  const edges = getDemoTransactions();
  const res = runDetectionPipeline(edges);

  // Empty query returns empty results
  assert.equal(searchDataset('   ', edges, res.alerts).totalMatches, 0);

  // Search flagged hub account A7843
  const accOut = searchDataset('a7843', edges, res.alerts);
  assert.ok(accOut.totalMatches >= 1);
  assert.equal(accOut.results[0].kind, 'account');
  assert.equal(accOut.results[0].id, 'A7843');
  assert.equal(accOut.results[0].linkedAlertId, 'ALT_FI_0001');

  // Search unflagged counterexample account SHOP_STEADY_01
  const shopOut = searchDataset('SHOP_STEADY_01', edges, res.alerts);
  assert.equal(shopOut.totalMatches, 1);
  assert.equal(shopOut.results[0].kind, 'account');
  assert.equal(shopOut.results[0].linkedAlertId, null);

  // Search specific transaction ID TX_PT_03
  const txOut = searchDataset('TX_PT_03', edges, res.alerts);
  assert.equal(txOut.totalMatches, 1);
  assert.equal(txOut.results[0].kind, 'transaction');
  assert.equal(txOut.results[0].linkedAlertId, 'ALT_PT_0001');

  // Search specific alert ID ALT_CYC_0001
  const altOut = searchDataset('ALT_CYC_0001', edges, res.alerts);
  assert.equal(altOut.totalMatches, 1);
  assert.equal(altOut.results[0].kind, 'alert');
  assert.equal(altOut.results[0].id, 'ALT_CYC_0001');
});

test('Cmd/Ctrl+K keyboard shortcut matcher handles modifiers and platform labels cleanly', () => {
  assert.equal(
    isSearchShortcutEvent({ key: 'k', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }),
    true
  );
  assert.equal(
    isSearchShortcutEvent({ key: 'K', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }),
    true
  );
  assert.equal(
    isSearchShortcutEvent({ key: 'k', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }),
    false
  );
  assert.equal(
    isSearchShortcutEvent({ key: 'k', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true }),
    false
  );
  assert.equal(
    isSearchShortcutEvent({ key: 'k', metaKey: false, ctrlKey: true, altKey: true, shiftKey: false }),
    false
  );
  assert.equal(
    isSearchShortcutEvent({ key: 'j', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }),
    false
  );

  assert.equal(isMacPlatform('MacIntel'), true);
  assert.equal(isMacPlatform('Linux x86_64'), false);
});
