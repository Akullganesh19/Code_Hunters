import {
  detectChronologicalCycles,
  detectFanInFanOut,
  detectRapidPassthrough,
} from './detectors';
import {
  extractAlertFeatureVector,
  getDefaultCalibratedRiskModel,
  scoreWithRiskModel,
  type CalibratedRiskModel,
} from './riskModel';
import {
  buildTransactionGraph,
  validateTransactions,
  type Alert,
  type RawTransactionInput,
  type TransactionEdge,
  type TransactionGraph,
} from './schema';
import { computePriorityScore } from './scoring';

export const CLOSING_DISCLAIMER = 'Flagged for review. Not proof of wrongdoing.';

export const ENTERPRISE_SCREENS = [
  'Overview',
  'Investigation',
  'Adversarial Lab',
  'SAR Case Dossier',
  'Evaluation',
] as const;

export type ScreenId = (typeof ENTERPRISE_SCREENS)[number];

export function shouldMergeAlerts(a: Alert, b: Alert): boolean {
  const accA = new Set(a.accounts);
  let sharedAccounts = 0;
  for (const acc of b.accounts) {
    if (accA.has(acc)) sharedAccounts++;
  }

  const txA = new Set(a.tx_ids);
  let sharedTxs = 0;
  for (const tx of b.tx_ids) {
    if (txA.has(tx)) sharedTxs++;
  }

  if (sharedAccounts >= 2) return true;
  if (sharedAccounts >= 1 && sharedTxs >= 1) return true;
  if (sharedTxs >= 2) return true;
  return false;
}

export function formatExplanation(alert: Alert): string {
  const typ = alert.typology;
  const ev = alert.evidence;
  const nAcc = alert.accounts.length;
  const nTx = alert.tx_ids.length;
  const tStart = alert.start_time;
  const tEnd = alert.end_time;
  const amt = alert.total_amount;
  const score = alert.priority_score;

  let body: string;

  if (typ === 'Fan-in/Fan-out' || typ === 'Fan-in' || typ === 'Fan-out') {
    body =
      `Typology: ${typ}. Hub account ${ev.hub_account} transacted across ` +
      `${ev.distinct_counterparties} distinct counterparties in ${nTx} transactions ` +
      `(${ev.direction}) between ${tStart} and ${tEnd}, totaling $${amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ` +
      `(burst ratio ${ev.burst_ratio}x, window ${ev.window_hours}h). Priority score: ${score}/100.`;
  } else if (typ === 'Chronological Cycle') {
    body =
      `Typology: ${typ}. Directed ${ev.cycle_length}-hop cycle (${ev.cycle_path}) ` +
      `occurred in non-decreasing time order from ${tStart} to ${tEnd} (${ev.span_hours}h span), ` +
      `totaling $${amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} across ${nTx} transactions ` +
      `(retention ${(Number(ev.retention_ratio ?? 0) * 100).toFixed(1)}%). Priority score: ${score}/100.`;
  } else if (typ === 'Rapid Pass-through') {
    body =
      `Typology: ${typ}. ${ev.hops}-hop chain (${ev.chain_path}) transferred funds from ` +
      `${tStart} to ${tEnd} with max hop delay ${ev.max_hop_delay_min} min and minimum hop retention ` +
      `${(Number(ev.min_hop_retention ?? 0) * 100).toFixed(1)}%, totaling $${amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ` +
      `across ${nTx} transactions. Priority score: ${score}/100.`;
  } else {
    body =
      `Typology: ${typ}. Linked cluster involving ${nAcc} accounts and ${nTx} transactions ` +
      `from ${tStart} to ${tEnd}, totaling $${amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. ` +
      `Combined findings: ${alert.reasons.join('; ')}. Priority score: ${score}/100.`;
  }

  return `${body} ${CLOSING_DISCLAIMER}`;
}

export function mergeAlerts(
  alerts: Alert[],
  edges: TransactionEdge[],
  riskModel: CalibratedRiskModel = getDefaultCalibratedRiskModel()
): Alert[] {
  const n = alerts.length;
  if (n === 0) return [];

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (x: number, y: number): void => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[ry] = rx;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (shouldMergeAlerts(alerts[i], alerts[j])) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, Alert[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    let grp = groups.get(root);
    if (!grp) {
      grp = [];
      groups.set(root, grp);
    }
    grp.push(alerts[i]);
  }

  const edgeById = new Map<string, TransactionEdge>();
  for (const e of edges) edgeById.set(e.tx_id, e);

  const merged: Alert[] = [];
  let mergeCounter = 0;

  for (const grp of groups.values()) {
    if (grp.length === 1) {
      const single = { ...grp[0] };
      single.explanation = formatExplanation(single);
      merged.push(single);
      continue;
    }

    mergeCounter++;
    const allTxIds = Array.from(new Set(grp.flatMap((a) => a.tx_ids))).sort();
    const allAccounts = Array.from(new Set(grp.flatMap((a) => a.accounts))).sort();
    const subEdges = allTxIds
      .map((id) => edgeById.get(id))
      .filter((e): e is TransactionEdge => Boolean(e))
      .sort((a, b) => a.tsMs - b.tsMs || a.tx_id.localeCompare(b.tx_id));

    const tStart = subEdges[0];
    const tEnd = subEdges[subEdges.length - 1];
    const durationHours = (tEnd.tsMs - tStart.tsMs) / (3600 * 1000);
    const totalAmount = Math.round(subEdges.reduce((s, e) => s + e.amount, 0) * 100) / 100;

    const pairCounts = new Map<string, number>();
    for (const e of subEdges) {
      const k = `${e.sender}->${e.receiver}`;
      pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1);
    }
    let repeatTxCount = 0;
    for (const c of pairCounts.values()) {
      if (c > 1) repeatTxCount += c - 1;
    }

    const retCandidates = grp.map((a) =>
      Number(a.evidence.retention_ratio ?? a.evidence.min_hop_retention ?? 0.5)
    );
    const retention = retCandidates.length > 0 ? Math.max(...retCandidates) : 0.5;

    const { score, breakdown } = computePriorityScore({
      durationHours,
      totalAmount,
      numAccounts: allAccounts.length,
      retentionRatio: retention,
      repeatTxCount,
    });

    const typs = Array.from(new Set(grp.map((a) => a.typology))).sort();
    const typLabel = typs.length === 1 ? typs[0] : typs.join(' + ');
    const reasons = grp.flatMap((a) => a.reasons);

    const features = extractAlertFeatureVector({
      breakdown,
      typology: typLabel,
      txCount: allTxIds.length,
      durationHours,
    });
    const { xgbRiskScore, contributions } = scoreWithRiskModel(features, riskModel);

    const mergedAlert: Alert = {
      alert_id: `ALT_MRG_${String(mergeCounter).padStart(4, '0')}`,
      typology: typLabel,
      accounts: allAccounts,
      tx_ids: allTxIds,
      start_time: tStart.timestamp,
      end_time: tEnd.timestamp,
      total_amount: totalAmount,
      evidence: {
        merged_alert_count: grp.length,
        constituent_alert_ids: grp.map((a) => a.alert_id),
        retention_ratio: Math.round(retention * 10000) / 10000,
        window_hours: Math.round(durationHours * 100) / 100,
        repeat_txs: repeatTxCount,
      },
      reasons,
      priority_score: score,
      score_breakdown: breakdown,
      xgb_risk_score: xgbRiskScore,
      risk_delta: Math.round((xgbRiskScore - score) * 100) / 100,
      xgb_contributions: contributions,
      explanation: '',
    };
    mergedAlert.explanation = formatExplanation(mergedAlert);
    merged.push(mergedAlert);
  }

  merged.sort(
    (a, b) =>
      b.priority_score - a.priority_score ||
      b.total_amount - a.total_amount ||
      a.alert_id.localeCompare(b.alert_id)
  );
  return merged;
}

export interface DetectionPipelineOptions {
  K?: number;
  WHours?: number;
  cycleWHours?: number;
  HMinutes?: number;
  minRetention?: number;
  riskModel?: CalibratedRiskModel;
}

export interface DetectionPipelineResult {
  edges: TransactionEdge[];
  graph: TransactionGraph;
  rawAlerts: Alert[];
  alerts: Alert[];
  runtimeMs: number;
  edgesPerSec: number;
}

export function runDetectionPipeline(
  rows: RawTransactionInput[],
  options: DetectionPipelineOptions = {}
): DetectionPipelineResult {
  const startTime = performance.now();
  const edges = validateTransactions(rows);
  const graph = buildTransactionGraph(edges);

  if (edges.length === 0) {
    const runtimeMs = Math.max(0.1, Math.round((performance.now() - startTime) * 100) / 100);
    return { edges, graph, rawAlerts: [], alerts: [], runtimeMs, edgesPerSec: 0 };
  }

  const riskModel = options.riskModel ?? getDefaultCalibratedRiskModel();
  const rawAlerts: Alert[] = [
    ...detectFanInFanOut(graph, { K: options.K ?? 5, WHours: options.WHours ?? 24.0, riskModel }),
    ...detectChronologicalCycles(graph, {
      minLen: 2,
      maxLen: 6,
      WHours: options.cycleWHours ?? 48.0,
      riskModel,
    }),
    ...detectRapidPassthrough(graph, {
      minHops: 3,
      HMinutes: options.HMinutes ?? 60.0,
      minRetention: options.minRetention ?? 0.80,
      riskModel,
    }),
  ];

  const alerts = mergeAlerts(rawAlerts, edges, riskModel);
  const runtimeMs = Math.max(0.1, Math.round((performance.now() - startTime) * 100) / 100);
  const edgesPerSec = Math.round(edges.length / Math.max(0.001, runtimeMs / 1000));
  return { edges, graph, rawAlerts, alerts, runtimeMs, edgesPerSec };
}

/**
 * Extract highlighted motif edges + capped 1-hop context (default maxEdges = 75)
 * for Screen 2 (Forensic Graph Workbench).
 */
export function extractMotifSubgraph(
  edges: TransactionEdge[],
  alert: Alert | null,
  maxEdges = 75
): {
  motifEdges: TransactionEdge[];
  contextEdges: TransactionEdge[];
  combinedEdges: TransactionEdge[];
} {
  if (!alert) {
    const slice = edges.slice(0, maxEdges);
    return { motifEdges: [], contextEdges: slice, combinedEdges: slice };
  }

  const alertTxSet = new Set(alert.tx_ids);
  const alertAccSet = new Set(alert.accounts);

  const motifEdges = edges
    .filter((e) => alertTxSet.has(e.tx_id))
    .sort((a, b) => a.tsMs - b.tsMs || a.tx_id.localeCompare(b.tx_id));

  const remainingCap = Math.max(0, maxEdges - motifEdges.length);
  const contextEdges = edges
    .filter(
      (e) =>
        !alertTxSet.has(e.tx_id) &&
        (alertAccSet.has(e.sender) || alertAccSet.has(e.receiver))
    )
    .slice(0, remainingCap);

  const combinedEdges = [...motifEdges, ...contextEdges].sort(
    (a, b) => a.tsMs - b.tsMs || a.tx_id.localeCompare(b.tx_id)
  );

  return { motifEdges, contextEdges, combinedEdges };
}

export interface AdversarialMotifConfig {
  typology: 'Rapid Pass-through' | 'Chronological Cycle' | 'Fan-in/Fan-out';
  hopCount: number;
  retentionRatio: number;
  hopDelayMinutes: number;
  amountPerTx: number;
  wrongTimeOrder: boolean;
}

/**
 * Injects a configurable synthetic laundering motif into a sandbox copy of transactions
 * for Screen 3 (Adversarial Lab). Never mutates caller input.
 */
export function injectAdversarialMotif(
  baseEdges: TransactionEdge[],
  config: AdversarialMotifConfig
): {
  sandboxEdges: TransactionEdge[];
  injectedTxIds: string[];
  injectedAccounts: string[];
} {
  const maxTs =
    baseEdges.length > 0
      ? Math.max(...baseEdges.map((e) => e.tsMs))
      : new Date('2026-03-10T12:00:00Z').getTime();

  const startMs = maxTs + 30 * 60 * 1000;
  const injectedRows: RawTransactionInput[] = [];
  const injectedTxIds: string[] = [];
  const injectedAccSet = new Set<string>();

  if (config.typology === 'Rapid Pass-through') {
    const hops = Math.max(3, Math.min(6, config.hopCount));
    let amt = config.amountPerTx;
    for (let i = 0; i < hops; i++) {
      const txId = `ADV_PT_${String(i + 1).padStart(2, '0')}`;
      const sender = `ADV_MULE_${i + 1}`;
      const receiver = `ADV_MULE_${i + 2}`;
      const offsetMin =
        config.wrongTimeOrder && i === 1
          ? -45
          : i * config.hopDelayMinutes;
      injectedRows.push({
        tx_id: txId,
        sender,
        receiver,
        amount: Math.round(amt * 100) / 100,
        timestamp: new Date(startMs + offsetMin * 60 * 1000).toISOString(),
        is_laundering: config.wrongTimeOrder ? 0 : 1,
        ring_id: 'ADV_RING',
        typology_label: 'Rapid Pass-through',
      });
      injectedTxIds.push(txId);
      injectedAccSet.add(sender);
      injectedAccSet.add(receiver);
      amt *= config.retentionRatio;
    }
  } else if (config.typology === 'Chronological Cycle') {
    const hops = Math.max(2, Math.min(6, config.hopCount));
    let amt = config.amountPerTx;
    for (let i = 0; i < hops; i++) {
      const txId = `ADV_CYC_${String(i + 1).padStart(2, '0')}`;
      const sender = `ADV_CYC_${i + 1}`;
      const receiver = `ADV_CYC_${((i + 1) % hops) + 1}`;
      const offsetMin =
        config.wrongTimeOrder && i === 1
          ? -35
          : i * config.hopDelayMinutes;
      injectedRows.push({
        tx_id: txId,
        sender,
        receiver,
        amount: Math.round(amt * 100) / 100,
        timestamp: new Date(startMs + offsetMin * 60 * 1000).toISOString(),
        is_laundering: config.wrongTimeOrder ? 0 : 1,
        ring_id: 'ADV_RING',
        typology_label: 'Chronological Cycle',
      });
      injectedTxIds.push(txId);
      injectedAccSet.add(sender);
      injectedAccSet.add(receiver);
      amt *= config.retentionRatio;
    }
  } else {
    const kCount = Math.max(3, Math.min(10, config.hopCount));
    const hub = 'ADV_HUB_01';
    for (let i = 0; i < kCount; i++) {
      const txId = `ADV_FAN_${String(i + 1).padStart(2, '0')}`;
      const sender = `ADV_SRC_${i + 1}`;
      const offsetMin = i * Math.max(2, Math.round(config.hopDelayMinutes / 2));
      injectedRows.push({
        tx_id: txId,
        sender,
        receiver: hub,
        amount: Math.round(config.amountPerTx * 100) / 100,
        timestamp: new Date(startMs + offsetMin * 60 * 1000).toISOString(),
        is_laundering: 1,
        ring_id: 'ADV_RING',
        typology_label: 'Fan-in/Fan-out',
      });
      injectedTxIds.push(txId);
      injectedAccSet.add(sender);
      injectedAccSet.add(hub);
    }
  }

  const sandboxEdges = validateTransactions([...baseEdges, ...injectedRows]);
  return {
    sandboxEdges,
    injectedTxIds,
    injectedAccounts: Array.from(injectedAccSet),
  };
}
