import {
  detectChronologicalCycles,
  detectFanInFanOut,
  detectRapidPassthrough,
} from './detectors';
import { getDemoTransactions } from './fixtures';
import { runDetectionPipeline, shouldMergeAlerts } from './pipeline';
import {
  extractAlertFeatureVector,
  fitBoostedRiskModel,
  type CalibratedRiskModel,
} from './riskModel';
import { buildTransactionGraph, type Alert, type TransactionEdge } from './schema';

export interface TxConfusionMetrics {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface ClusterMetrics {
  ringsTotal: number;
  ringsCaught: number;
  clusterRecall: number;
  clusterPrecision: number;
  clusterF1: number;
  meanJaccardIoU: number;
}

export interface PerTypologyMetric {
  typology: string;
  txTotal: number;
  txCaught: number;
  txRecall: number;
  ringsTotal: number;
  ringsCaught: number;
  ringRecall: number;
}

export interface TierAblationRow {
  tier: string;
  txPrecision: number;
  txRecall: number;
  txF1: number;
  clusterPrecision: number;
  clusterRecall: number;
  clusterF1: number;
  meanJaccardIoU: number;
  alertsCount: number;
}

export interface EvaluationReport {
  seed: number;
  splitRatio: number;
  splitBoundary: string;
  trainRows: number;
  testRows: number;
  tunedT: number;
  tunedParams: {
    K: number;
    WHours: number;
    cycleWHours: number;
    HMinutes: number;
    minRetention: number;
  };
  xgbThreshold: number;
  baselineConfusion: TxConfusionMetrics;
  graphConfusion: TxConfusionMetrics;
  hybridConfusion: TxConfusionMetrics;
  ablationTable: TierAblationRow[];
  perTypologyRecall: PerTypologyMetric[];
  telemetry: {
    trainPositiveRate: number;
    testPositiveRate: number;
    amountPsi: number;
    driftStatus: 'Nominal' | 'Moderate Shift' | 'High Drift';
    activeAccountOverlapPct: number;
    rowCapApplied: number;
  };
}

export interface CounterexampleCheck {
  caseName: string;
  expected: string;
  observed: string;
  status: 'PASS' | 'FAIL';
}

export const DOCUMENTED_LIMITATIONS: string[] = [
  'Temporal split boundaries can truncate multi-day laundering rings spanning across the train/test cutoff timestamp.',
  'Cross-bank or off-platform cash legs absent from the ledger cannot be linked by graph traversal alone.',
  'Deterministic thresholds (K, W, H, R) trade sensitivity for explainability and do not adapt online without re-tuning on a historical split.',
  'Cycle and chain DFS depths are bounded (max 6 hops) to guarantee interactive latency on 100k–300k edge subsamples.',
  'Alert output indicates structural anomaly only — never proof of wrongdoing or criminal intent.',
];

function computeTxMetrics(yTrue: number[], yPred: number[]): TxConfusionMetrics {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (let i = 0; i < yTrue.length; i++) {
    if (yTrue[i] === 1 && yPred[i] === 1) tp++;
    else if (yTrue[i] === 0 && yPred[i] === 1) fp++;
    else if (yTrue[i] === 0 && yPred[i] === 0) tn++;
    else fn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    tp,
    fp,
    tn,
    fn,
    precision: round4(precision),
    recall: round4(recall),
    f1: round4(f1),
  };
}

function computeClusterMetrics(
  testEdges: TransactionEdge[],
  predictedClusters: Array<Set<string>>
): ClusterMetrics {
  const trueRings = new Map<string, Set<string>>();
  for (const e of testEdges) {
    if (e.is_laundering === 1 && e.ring_id !== 'none') {
      let set = trueRings.get(e.ring_id);
      if (!set) {
        set = new Set<string>();
        trueRings.set(e.ring_id, set);
      }
      set.add(e.tx_id);
    }
  }

  const ringsTotal = trueRings.size;
  if (ringsTotal === 0) {
    return {
      ringsTotal: 0,
      ringsCaught: 0,
      clusterRecall: 0,
      clusterPrecision: 0,
      clusterF1: 0,
      meanJaccardIoU: 0,
    };
  }

  const allFlaggedTxs = new Set<string>();
  for (const cl of predictedClusters) {
    for (const tx of cl) allFlaggedTxs.add(tx);
  }

  let ringsCaught = 0;
  const jaccards: number[] = [];

  for (const ringTxs of trueRings.values()) {
    let unionCaught = 0;
    for (const tx of ringTxs) {
      if (allFlaggedTxs.has(tx)) unionCaught++;
    }
    if (unionCaught / ringTxs.size >= 0.5) {
      ringsCaught++;
    }

    let bestIoU = 0;
    for (const cl of predictedClusters) {
      let inter = 0;
      for (const tx of ringTxs) {
        if (cl.has(tx)) inter++;
      }
      if (inter > 0) {
        const union = ringTxs.size + cl.size - inter;
        const iou = union > 0 ? inter / union : 0;
        if (iou > bestIoU) bestIoU = iou;
      }
    }
    jaccards.push(bestIoU);
  }

  let matchedClusters = 0;
  for (const cl of predictedClusters) {
    let hit = false;
    for (const ringTxs of trueRings.values()) {
      let inter = 0;
      for (const tx of cl) {
        if (ringTxs.has(tx)) inter++;
      }
      if (ringTxs.size > 0 && inter / ringTxs.size >= 0.5) {
        hit = true;
        break;
      }
    }
    if (hit) matchedClusters++;
  }

  const clusterRecall = ringsCaught / ringsTotal;
  const clusterPrecision =
    predictedClusters.length > 0 ? matchedClusters / predictedClusters.length : 0;
  const clusterF1 =
    clusterPrecision + clusterRecall > 0
      ? (2 * clusterPrecision * clusterRecall) / (clusterPrecision + clusterRecall)
      : 0;
  const meanJaccardIoU =
    jaccards.length > 0 ? jaccards.reduce((a, b) => a + b, 0) / jaccards.length : 0;

  return {
    ringsTotal,
    ringsCaught,
    clusterRecall: round4(clusterRecall),
    clusterPrecision: round4(clusterPrecision),
    clusterF1: round4(clusterF1),
    meanJaccardIoU: round4(meanJaccardIoU),
  };
}

function computePerTypologyRecall(
  testEdges: TransactionEdge[],
  flaggedTxIds: Set<string>
): PerTypologyMetric[] {
  const typologies = ['Fan-in/Fan-out', 'Chronological Cycle', 'Rapid Pass-through'];
  return typologies.map((typ) => {
    const posEdges = testEdges.filter(
      (e) => e.is_laundering === 1 && e.typology_label === typ
    );
    const txTotal = posEdges.length;
    const txCaught = posEdges.filter((e) => flaggedTxIds.has(e.tx_id)).length;
    const txRecall = txTotal > 0 ? txCaught / txTotal : 0;

    const ringMap = new Map<string, Set<string>>();
    for (const e of posEdges) {
      if (e.ring_id === 'none') continue;
      let s = ringMap.get(e.ring_id);
      if (!s) {
        s = new Set<string>();
        ringMap.set(e.ring_id, s);
      }
      s.add(e.tx_id);
    }
    const ringsTotal = ringMap.size;
    let ringsCaught = 0;
    for (const ringTxs of ringMap.values()) {
      let hit = 0;
      for (const tx of ringTxs) {
        if (flaggedTxIds.has(tx)) hit++;
      }
      if (hit / ringTxs.size >= 0.5) ringsCaught++;
    }
    const ringRecall = ringsTotal > 0 ? ringsCaught / ringsTotal : 0;

    return {
      typology: typ,
      txTotal,
      txCaught,
      txRecall: round4(txRecall),
      ringsTotal,
      ringsCaught,
      ringRecall: round4(ringRecall),
    };
  });
}

function computeAmountPsi(trainAmounts: number[], testAmounts: number[]): number {
  if (trainAmounts.length === 0 || testAmounts.length === 0) return 0;
  const sortedTrain = [...trainAmounts].sort((a, b) => a - b);
  const edges: number[] = [0];
  for (let q = 1; q < 10; q++) {
    const idx = Math.min(sortedTrain.length - 1, Math.floor((q / 10) * sortedTrain.length));
    edges.push(sortedTrain[idx]);
  }
  edges.push(Infinity);

  const countBins = (arr: number[]) => {
    const counts = new Array(10).fill(0);
    for (const v of arr) {
      for (let b = 0; b < 10; b++) {
        if (v >= edges[b] && v < edges[b + 1]) {
          counts[b]++;
          break;
        }
      }
    }
    return counts.map((c) => Math.max(1e-4, c / arr.length));
  };

  const pTrain = countBins(trainAmounts);
  const pTest = countBins(testAmounts);
  let psi = 0;
  for (let b = 0; b < 10; b++) {
    psi += (pTest[b] - pTrain[b]) * Math.log(pTest[b] / pTrain[b]);
  }
  return round4(Math.max(0, psi));
}

/**
 * Temporal-split evaluation with strict anti-leakage:
 *  - Tunes baseline threshold T, graph thresholds, and XGBoost risk model strictly on first `splitRatio` (60-80%)
 *  - Evaluates all 3 tiers strictly on the held-out remainder.
 */
export function evaluateTemporalSplit(
  edges: TransactionEdge[],
  options: { splitRatio?: number; seed?: number; rowCapApplied?: number } = {}
): EvaluationReport {
  const splitRatio = options.splitRatio ?? 0.70;
  const seed = options.seed ?? 42;
  const rowCapApplied = options.rowCapApplied ?? edges.length;

  if (splitRatio < 0.60 || splitRatio > 0.80) {
    throw new Error('splitRatio must be within [0.60, 0.80].');
  }
  if (edges.length === 0) {
    throw new Error('Cannot run evaluation on an empty dataset.');
  }

  const sorted = [...edges].sort((a, b) => a.tsMs - b.tsMs || a.tx_id.localeCompare(b.tx_id));
  const tMin = sorted[0].tsMs;
  const tMax = sorted[sorted.length - 1].tsMs;
  const splitBoundaryMs = tMin + (tMax - tMin) * splitRatio;
  const splitBoundary = new Date(splitBoundaryMs).toISOString();

  const trainEdges = sorted.filter((e) => e.tsMs <= splitBoundaryMs);
  const testEdges = sorted.filter((e) => e.tsMs > splitBoundaryMs);

  // 1. Tune baseline threshold T strictly on trainEdges
  const yTrain = trainEdges.map((e) => e.is_laundering);
  const trainAmts = [...trainEdges.map((e) => e.amount)].sort((a, b) => a - b);
  let bestT = trainAmts[Math.floor(trainAmts.length * 0.9)] ?? 50000;
  let bestTrainBaseF1 = -1;

  for (let step = 0; step < 24; step++) {
    const q = 0.5 + (step / 23) * 0.495;
    const candT = trainAmts[Math.min(trainAmts.length - 1, Math.floor(q * trainAmts.length))];
    const yPred = trainEdges.map((e) => (e.amount >= candT ? 1 : 0));
    const m = computeTxMetrics(yTrain, yPred);
    if (m.f1 > bestTrainBaseF1) {
      bestTrainBaseF1 = m.f1;
      bestT = candT;
    }
  }

  // 2. Tune graph thresholds strictly on trainEdges
  const paramGrid = [
    { K: 5, WHours: 24.0, cycleWHours: 48.0, HMinutes: 60.0, minRetention: 0.80 },
    { K: 6, WHours: 18.0, cycleWHours: 36.0, HMinutes: 55.0, minRetention: 0.82 },
    { K: 5, WHours: 12.0, cycleWHours: 24.0, HMinutes: 50.0, minRetention: 0.80 },
  ];
  let bestParams = paramGrid[0];
  let bestGraphTrainF1 = -1;
  let bestTrainAlerts: Alert[] = [];

  for (const params of paramGrid) {
    const resTr = runDetectionPipeline(trainEdges, params);
    const flaggedTr = new Set(resTr.alerts.flatMap((a) => a.tx_ids));
    const yPredTr = trainEdges.map((e) => (flaggedTr.has(e.tx_id) ? 1 : 0));
    const m = computeTxMetrics(yTrain, yPredTr);
    if (m.f1 > bestGraphTrainF1) {
      bestGraphTrainF1 = m.f1;
      bestParams = params;
      bestTrainAlerts = resTr.alerts;
    }
  }

  // 3. Fit XGBoost-style calibrated risk model strictly on trainEdges alerts
  const trainPosTxIds = new Set(trainEdges.filter((e) => e.is_laundering === 1).map((e) => e.tx_id));
  const XTrain: number[][] = [];
  const yAlertTrain: number[] = [];
  for (const a of bestTrainAlerts) {
    const durationH = (Date.parse(a.end_time) - Date.parse(a.start_time)) / (3600 * 1000);
    XTrain.push(
      extractAlertFeatureVector({
        breakdown: a.score_breakdown,
        typology: a.typology,
        txCount: a.tx_ids.length,
        durationHours: durationH,
      })
    );
    const hits = a.tx_ids.filter((id) => trainPosTxIds.has(id)).length;
    yAlertTrain.push(hits / Math.max(1, a.tx_ids.length) >= 0.5 ? 1 : 0);
  }
  const fittedModel: CalibratedRiskModel = fitBoostedRiskModel(XTrain, yAlertTrain);

  // 4. Evaluate strictly on held-out testEdges across all 3 tiers
  const yTest = testEdges.map((e) => e.is_laundering);

  // Tier 1: Single-Tx Baseline (amount >= T)
  const basePredTest = testEdges.map((e) => (e.amount >= bestT ? 1 : 0));
  const baselineConfusion = computeTxMetrics(yTest, basePredTest);
  const baseClusters = testEdges
    .filter((e) => e.amount >= bestT)
    .map((e) => new Set([e.tx_id]));
  const baseClusterMetrics = computeClusterMetrics(testEdges, baseClusters);

  // Tier 2: TraceLayer Heuristic Graph Detector
  const resTest = runDetectionPipeline(testEdges, { ...bestParams, riskModel: fittedModel });
  const graphFlaggedIds = new Set(resTest.alerts.flatMap((a) => a.tx_ids));
  const graphPredTest = testEdges.map((e) => (graphFlaggedIds.has(e.tx_id) ? 1 : 0));
  const graphConfusion = computeTxMetrics(yTest, graphPredTest);
  const graphClusters = resTest.alerts.map((a) => new Set(a.tx_ids));
  const graphClusterMetrics = computeClusterMetrics(testEdges, graphClusters);

  // Tier 3: TraceLayer + Calibrated XGBoost Hybrid (filters low-confidence alerts below calibrated threshold)
  const xgbCutoffScore = fittedModel.calibratedThreshold * 100;
  const hybridAlerts = resTest.alerts.filter(
    (a) => a.xgb_risk_score >= xgbCutoffScore || a.priority_score >= 65
  );
  const hybridFlaggedIds = new Set(hybridAlerts.flatMap((a) => a.tx_ids));
  const hybridPredTest = testEdges.map((e) => (hybridFlaggedIds.has(e.tx_id) ? 1 : 0));
  const hybridConfusion = computeTxMetrics(yTest, hybridPredTest);
  const hybridClusters = hybridAlerts.map((a) => new Set(a.tx_ids));
  const hybridClusterMetrics = computeClusterMetrics(testEdges, hybridClusters);

  const ablationTable: TierAblationRow[] = [
    {
      tier: `Tier 1: Single-Tx Baseline (amount >= $${Math.round(bestT).toLocaleString('en-US')})`,
      txPrecision: baselineConfusion.precision,
      txRecall: baselineConfusion.recall,
      txF1: baselineConfusion.f1,
      clusterPrecision: baseClusterMetrics.clusterPrecision,
      clusterRecall: baseClusterMetrics.clusterRecall,
      clusterF1: baseClusterMetrics.clusterF1,
      meanJaccardIoU: baseClusterMetrics.meanJaccardIoU,
      alertsCount: baseClusters.length,
    },
    {
      tier: 'Tier 2: TraceLayer Graph Detector (3 Motifs)',
      txPrecision: graphConfusion.precision,
      txRecall: graphConfusion.recall,
      txF1: graphConfusion.f1,
      clusterPrecision: graphClusterMetrics.clusterPrecision,
      clusterRecall: graphClusterMetrics.clusterRecall,
      clusterF1: graphClusterMetrics.clusterF1,
      meanJaccardIoU: graphClusterMetrics.meanJaccardIoU,
      alertsCount: resTest.alerts.length,
    },
    {
      tier: 'Tier 3: TraceLayer + Calibrated XGBoost Hybrid',
      txPrecision: hybridConfusion.precision,
      txRecall: hybridConfusion.recall,
      txF1: hybridConfusion.f1,
      clusterPrecision: hybridClusterMetrics.clusterPrecision,
      clusterRecall: hybridClusterMetrics.clusterRecall,
      clusterF1: hybridClusterMetrics.clusterF1,
      meanJaccardIoU: hybridClusterMetrics.meanJaccardIoU,
      alertsCount: hybridAlerts.length,
    },
  ];

  const perTypologyRecall = computePerTypologyRecall(testEdges, hybridFlaggedIds);

  // Telemetry & Drift (PSI)
  const trainAccs = new Set(trainEdges.flatMap((e) => [e.sender, e.receiver]));
  const testAccs = new Set(testEdges.flatMap((e) => [e.sender, e.receiver]));
  let accOverlap = 0;
  for (const a of testAccs) {
    if (trainAccs.has(a)) accOverlap++;
  }
  const activeAccountOverlapPct =
    testAccs.size > 0 ? round4((accOverlap / testAccs.size) * 100) : 0;

  const amountPsi = computeAmountPsi(
    trainEdges.map((e) => e.amount),
    testEdges.map((e) => e.amount)
  );
  const driftStatus =
    amountPsi < 0.1 ? 'Nominal' : amountPsi < 0.25 ? 'Moderate Shift' : 'High Drift';

  return {
    seed,
    splitRatio,
    splitBoundary,
    trainRows: trainEdges.length,
    testRows: testEdges.length,
    tunedT: Math.round(bestT * 100) / 100,
    tunedParams: bestParams,
    xgbThreshold: round4(xgbCutoffScore),
    baselineConfusion,
    graphConfusion,
    hybridConfusion,
    ablationTable,
    perTypologyRecall,
    telemetry: {
      trainPositiveRate: round4(
        trainEdges.filter((e) => e.is_laundering === 1).length / Math.max(1, trainEdges.length)
      ),
      testPositiveRate: round4(
        testEdges.filter((e) => e.is_laundering === 1).length / Math.max(1, testEdges.length)
      ),
      amountPsi,
      driftStatus,
      activeAccountOverlapPct,
      rowCapApplied,
    },
  };
}

export function runCounterexampleSuite(): CounterexampleCheck[] {
  const demoEdges = getDemoTransactions();
  const G = buildTransactionGraph(demoEdges);

  const fanAlerts = detectFanInFanOut(G, { K: 5, WHours: 24.0 });
  const cycAlerts = detectChronologicalCycles(G, { minLen: 2, maxLen: 6, WHours: 48.0 });
  const ptAlerts = detectRapidPassthrough(G, { minHops: 3, HMinutes: 60.0, minRetention: 0.80 });

  const fanHubs = new Set(fanAlerts.map((a) => String(a.evidence.hub_account)));
  const cycAccs = new Set(cycAlerts.flatMap((a) => a.accounts));
  const ptAccs = new Set(ptAlerts.flatMap((a) => a.accounts));

  const dummyBase = {
    typology: 'Fan-in/Fan-out',
    start_time: '',
    end_time: '',
    total_amount: 100,
    evidence: {},
    reasons: [],
    priority_score: 50,
    score_breakdown: {
      speed: 0.5, amount: 0.5, accounts: 0.5, retention: 0.5, repeat: 0,
      speed_pts: 15, amount_pts: 12.5, accounts_pts: 7.5, retention_pts: 10, repeat_pts: 0,
      raw_total: 45, capped_total: 45,
    },
    xgb_risk_score: 52,
    risk_delta: 2,
    xgb_contributions: [],
    explanation: '',
  };

  const noSingleHubMerge = !shouldMergeAlerts(
    { ...dummyBase, alert_id: 'A1', accounts: ['HUB', 'X1', 'X2'], tx_ids: ['T1', 'T2'] },
    { ...dummyBase, alert_id: 'A2', accounts: ['HUB', 'Y1', 'Y2'], tx_ids: ['T8', 'T9'] }
  );

  return [
    {
      caseName: 'Known Fan-in/Fan-out Burst (A7843)',
      expected: 'Flagged',
      observed: fanHubs.has('A7843') ? 'Flagged' : 'Missed',
      status: fanHubs.has('A7843') ? 'PASS' : 'FAIL',
    },
    {
      caseName: 'Steady Shop/Payroll Counterexample (SHOP_STEADY_01)',
      expected: 'Suppressed (No Alert)',
      observed: !fanHubs.has('SHOP_STEADY_01') ? 'Suppressed' : 'False Alert',
      status: !fanHubs.has('SHOP_STEADY_01') ? 'PASS' : 'FAIL',
    },
    {
      caseName: 'Known Chronological Cycle (CYC_ALPHA..GAMMA)',
      expected: 'Flagged',
      observed: cycAccs.has('CYC_ALPHA') ? 'Flagged' : 'Missed',
      status: cycAccs.has('CYC_ALPHA') ? 'PASS' : 'FAIL',
    },
    {
      caseName: 'Wrong-Order Cycle Counterexample (BAD_C1..C3)',
      expected: 'Rejected (No Alert)',
      observed: !cycAccs.has('BAD_C1') ? 'Rejected' : 'False Alert',
      status: !cycAccs.has('BAD_C1') ? 'PASS' : 'FAIL',
    },
    {
      caseName: 'Known Rapid Pass-through Chain (PT_MULE_1..EXIT_5)',
      expected: 'Flagged',
      observed: ptAccs.has('PT_MULE_1') ? 'Flagged' : 'Missed',
      status: ptAccs.has('PT_MULE_1') ? 'PASS' : 'FAIL',
    },
    {
      caseName: 'Slow / Low-Retention Counterexample (SLOW_1..4)',
      expected: 'Rejected (No Alert)',
      observed: !ptAccs.has('SLOW_1') ? 'Rejected' : 'False Alert',
      status: !ptAccs.has('SLOW_1') ? 'PASS' : 'FAIL',
    },
    {
      caseName: 'Single Shared Account Merge Prevention',
      expected: 'Do Not Merge',
      observed: noSingleHubMerge ? 'Not Merged' : 'Merged',
      status: noSingleHubMerge ? 'PASS' : 'FAIL',
    },
  ];
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
