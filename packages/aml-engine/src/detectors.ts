import type { Alert, TransactionEdge, TransactionGraph } from './schema';
import { computePriorityScore } from './scoring';
import { extractAlertFeatureVector, scoreWithRiskModel, type CalibratedRiskModel, getDefaultCalibratedRiskModel } from './riskModel';

function countRepeatTxs(edges: TransactionEdge[]): number {
  const counts = new Map<string, number>();
  for (const e of edges) {
    const key = `${e.sender}->${e.receiver}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let repeats = 0;
  for (const c of counts.values()) {
    if (c > 1) repeats += c - 1;
  }
  return repeats;
}

function isSteadyBehavior(
  allEdges: TransactionEdge[],
  windowMs: number,
  peakDistinct: number,
  direction: 'fan_in' | 'fan_out'
): { steady: boolean; burstRatio: number } {
  if (allEdges.length < 2) {
    return { steady: false, burstRatio: Math.max(1, peakDistinct) };
  }

  let tMin = Infinity;
  let tMax = -Infinity;
  for (const e of allEdges) {
    if (e.tsMs < tMin) tMin = e.tsMs;
    if (e.tsMs > tMax) tMax = e.tsMs;
  }
  const totalSpan = tMax - tMin;

  // Needs history spanning at least 2.5 windows to evaluate steadiness
  if (totalSpan < 2.5 * windowMs) {
    return { steady: false, burstRatio: peakDistinct };
  }

  const buckets = new Map<number, Set<string>>();
  for (const e of allEdges) {
    const b = Math.floor((e.tsMs - tMin) / windowMs);
    let set = buckets.get(b);
    if (!set) {
      set = new Set<string>();
      buckets.set(b, set);
    }
    set.add(direction === 'fan_in' ? e.sender : e.receiver);
  }

  const counts = Array.from(buckets.values(), (s) => s.size).filter((n) => n > 0);
  if (counts.length < 3) {
    return { steady: false, burstRatio: peakDistinct };
  }

  const sorted = [...counts].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((a, c) => a + (c - mean) ** 2, 0) / counts.length;
  const cv = Math.sqrt(variance) / Math.max(1e-6, mean);
  const burstRatio = Math.round((peakDistinct / Math.max(1, median)) * 100) / 100;

  const steady = burstRatio <= 1.85 || (cv <= 0.35 && burstRatio <= 2.2);
  return { steady, burstRatio };
}

function attachRiskScores(
  alert: Omit<Alert, 'xgb_risk_score' | 'risk_delta' | 'xgb_contributions' | 'explanation'>,
  durationHours: number,
  riskModel: CalibratedRiskModel
): Alert {
  const features = extractAlertFeatureVector({
    breakdown: alert.score_breakdown,
    typology: alert.typology,
    txCount: alert.tx_ids.length,
    durationHours,
  });
  const { xgbRiskScore, contributions } = scoreWithRiskModel(features, riskModel);
  const delta = Math.round((xgbRiskScore - alert.priority_score) * 100) / 100;
  return {
    ...alert,
    xgb_risk_score: xgbRiskScore,
    risk_delta: delta,
    xgb_contributions: contributions,
    explanation: '',
  };
}

export function detectFanInFanOut(
  G: TransactionGraph,
  options: { K?: number; WHours?: number; riskModel?: CalibratedRiskModel } = {}
): Alert[] {
  const K = options.K ?? 5;
  const WHours = options.WHours ?? 24.0;
  const riskModel = options.riskModel ?? getDefaultCalibratedRiskModel();
  const windowMs = WHours * 3600 * 1000;
  const alerts: Alert[] = [];
  let counter = 0;

  const sortedNodes = Array.from(G.nodes).sort();

  for (const acc of sortedNodes) {
    const inEdges = [...(G.inEdges.get(acc) ?? [])].sort(
      (a, b) => a.tsMs - b.tsMs || a.tx_id.localeCompare(b.tx_id)
    );
    const outEdges = [...(G.outEdges.get(acc) ?? [])].sort(
      (a, b) => a.tsMs - b.tsMs || a.tx_id.localeCompare(b.tx_id)
    );

    const findings: Array<{
      direction: 'fan_in' | 'fan_out';
      edges: TransactionEdge[];
      distinct: number;
      burstRatio: number;
    }> = [];

    for (const [direction, edges] of [
      ['fan_in', inEdges],
      ['fan_out', outEdges],
    ] as const) {
      if (edges.length < K) continue;

      let left = 0;
      const cpCounts = new Map<string, number>();
      let bestWindowEdges: TransactionEdge[] = [];
      let bestDistinct = 0;

      for (let right = 0; right < edges.length; right++) {
        const edge = edges[right];
        const cp = direction === 'fan_in' ? edge.sender : edge.receiver;
        cpCounts.set(cp, (cpCounts.get(cp) ?? 0) + 1);

        while (edges[right].tsMs - edges[left].tsMs > windowMs) {
          const leftEdge = edges[left];
          const lcp = direction === 'fan_in' ? leftEdge.sender : leftEdge.receiver;
          const nextCnt = (cpCounts.get(lcp) ?? 1) - 1;
          if (nextCnt <= 0) cpCounts.delete(lcp);
          else cpCounts.set(lcp, nextCnt);
          left++;
        }

        const distinctNow = cpCounts.size;
        if (distinctNow >= K) {
          const slice = edges.slice(left, right + 1);
          if (
            distinctNow > bestDistinct ||
            (distinctNow === bestDistinct && slice.length > bestWindowEdges.length)
          ) {
            bestDistinct = distinctNow;
            bestWindowEdges = slice;
          }
        }
      }

      if (bestDistinct >= K && bestWindowEdges.length > 0) {
        const { steady, burstRatio } = isSteadyBehavior(edges, windowMs, bestDistinct, direction);
        if (steady) {
          continue; // Suppress steady shop / payroll pattern
        }
        findings.push({ direction, edges: bestWindowEdges, distinct: bestDistinct, burstRatio });
      }
    }

    if (findings.length === 0) continue;

    const seenTx = new Set<string>();
    const combinedEdges: TransactionEdge[] = [];
    for (const f of findings) {
      for (const e of f.edges) {
        if (!seenTx.has(e.tx_id)) {
          seenTx.add(e.tx_id);
          combinedEdges.push(e);
        }
      }
    }
    combinedEdges.sort((a, b) => a.tsMs - b.tsMs || a.tx_id.localeCompare(b.tx_id));

    const tStart = combinedEdges[0];
    const tEnd = combinedEdges[combinedEdges.length - 1];
    const durationHours = (tEnd.tsMs - tStart.tsMs) / (3600 * 1000);
    const totalAmount = Math.round(combinedEdges.reduce((s, e) => s + e.amount, 0) * 100) / 100;
    const txIds = combinedEdges.map((e) => e.tx_id);

    const accSet = new Set<string>([acc]);
    let inAmt = 0;
    let outAmt = 0;
    for (const e of combinedEdges) {
      accSet.add(e.sender);
      accSet.add(e.receiver);
      if (e.receiver === acc) inAmt += e.amount;
      if (e.sender === acc) outAmt += e.amount;
    }
    const accounts = Array.from(accSet).sort();
    const counterpartiesCount = accounts.filter((a) => a !== acc).length;
    const retentionRatio =
      inAmt > 0 && outAmt > 0 ? Math.min(inAmt, outAmt) / Math.max(inAmt, outAmt) : 0.5;
    const repeatTxCount = countRepeatTxs(combinedEdges);

    const { score, breakdown } = computePriorityScore({
      durationHours,
      totalAmount,
      numAccounts: accounts.length,
      retentionRatio,
      repeatTxCount,
    });

    counter++;
    const maxBurstRatio = Math.max(...findings.map((f) => f.burstRatio));
    const dirsLabel = findings.map((f) => f.direction).join('/');
    const typology =
      findings.length > 1
        ? 'Fan-in/Fan-out'
        : findings[0].direction === 'fan_in'
          ? 'Fan-in'
          : 'Fan-out';

    alerts.push(
      attachRiskScores(
        {
          alert_id: `ALT_FI_${String(counter).padStart(4, '0')}`,
          typology,
          accounts,
          tx_ids: txIds,
          start_time: tStart.timestamp,
          end_time: tEnd.timestamp,
          total_amount: totalAmount,
          evidence: {
            hub_account: acc,
            direction: dirsLabel,
            distinct_counterparties: counterpartiesCount,
            tx_count: txIds.length,
            window_hours: Math.round(durationHours * 100) / 100,
            burst_ratio: maxBurstRatio,
            in_amount: Math.round(inAmt * 100) / 100,
            out_amount: Math.round(outAmt * 100) / 100,
            repeat_txs: repeatTxCount,
          },
          reasons: [
            `Account ${acc} transacted with ${counterpartiesCount} distinct counterparties across ${txIds.length} transactions within ${durationHours.toFixed(2)} hours.`,
            `Burst ratio vs baseline was ${maxBurstRatio.toFixed(2)}x (threshold K=${K}, W=${WHours}h).`,
          ],
          priority_score: score,
          score_breakdown: breakdown,
        },
        durationHours,
        riskModel
      )
    );
  }

  return alerts;
}

export function detectChronologicalCycles(
  G: TransactionGraph,
  options: {
    minLen?: number;
    maxLen?: number;
    WHours?: number;
    minRetention?: number;
    maxExpansionsPerRoot?: number;
    riskModel?: CalibratedRiskModel;
  } = {}
): Alert[] {
  const minLen = options.minLen ?? 2;
  const maxLen = options.maxLen ?? 6;
  const WHours = options.WHours ?? 48.0;
  const minRetention = options.minRetention ?? 0.60;
  const maxExpansionsPerRoot = options.maxExpansionsPerRoot ?? 2500;
  const riskModel = options.riskModel ?? getDefaultCalibratedRiskModel();
  const windowMs = WHours * 3600 * 1000;

  const alerts: Alert[] = [];
  const seenTxSets = new Set<string>();
  let counter = 0;

  const sortedNodes = Array.from(G.nodes).sort();

  for (const startNode of sortedNodes) {
    const startEdges = G.outEdges.get(startNode) ?? [];
    for (const e0 of startEdges) {
      if (e0.receiver === startNode) continue;
      const t0 = e0.tsMs;

      const stack: Array<{
        curr: string;
        pathNodes: string[];
        pathEdges: TransactionEdge[];
      }> = [{ curr: e0.receiver, pathNodes: [startNode, e0.receiver], pathEdges: [e0] }];

      let expansions = 0;
      while (stack.length > 0) {
        const frame = stack.pop()!;
        expansions++;
        if (expansions > maxExpansionsPerRoot) break;

        const hops = frame.pathEdges.length;
        const lastTs = frame.pathEdges[hops - 1].tsMs;

        const out = G.outEdges.get(frame.curr) ?? [];
        for (const eNext of out) {
          // Strict chronological ordering: every hop timestamp >= previous hop timestamp
          if (eNext.tsMs < lastTs) continue;
          if (eNext.tsMs - t0 > windowMs) break; // outEdges are sorted chronologically

          if (eNext.receiver === startNode) {
            const cycLen = hops + 1;
            if (cycLen >= minLen && cycLen <= maxLen) {
              const fullEdges = [...frame.pathEdges, eNext];
              const canonicalKey = fullEdges
                .map((e) => e.tx_id)
                .sort()
                .join('|');
              if (seenTxSets.has(canonicalKey)) continue;
              seenTxSets.add(canonicalKey);

              const amounts = fullEdges.map((e) => e.amount);
              const minAmt = Math.min(...amounts);
              const maxAmt = Math.max(...amounts);
              const retention = maxAmt > 0 ? minAmt / maxAmt : 0;
              if (retention < minRetention) continue;

              const totalAmount = Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
              const tEnd = fullEdges[fullEdges.length - 1];
              const durationHours = (tEnd.tsMs - t0) / (3600 * 1000);
              const accounts = Array.from(new Set(frame.pathNodes));
              const txIds = fullEdges.map((e) => e.tx_id);
              const repeatTxCount = countRepeatTxs(fullEdges);

              const { score, breakdown } = computePriorityScore({
                durationHours,
                totalAmount,
                numAccounts: accounts.length,
                retentionRatio: retention,
                repeatTxCount,
              });

              counter++;
              const cyclePath = [...frame.pathNodes, startNode].join(' -> ');
              alerts.push(
                attachRiskScores(
                  {
                    alert_id: `ALT_CYC_${String(counter).padStart(4, '0')}`,
                    typology: 'Chronological Cycle',
                    accounts,
                    tx_ids: txIds,
                    start_time: e0.timestamp,
                    end_time: tEnd.timestamp,
                    total_amount: totalAmount,
                    evidence: {
                      cycle_length: cycLen,
                      cycle_path: cyclePath,
                      span_hours: Math.round(durationHours * 100) / 100,
                      retention_ratio: Math.round(retention * 10000) / 10000,
                      min_hop_amount: Math.round(minAmt * 100) / 100,
                      max_hop_amount: Math.round(maxAmt * 100) / 100,
                    },
                    reasons: [
                      `Directed ${cycLen}-hop cycle (${cyclePath}) completed in non-decreasing time order within ${durationHours.toFixed(2)} hours.`,
                      `Cycle retained ${(retention * 100).toFixed(1)}% of peak hop amount across $${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total volume.`,
                    ],
                    priority_score: score,
                    score_breakdown: breakdown,
                  },
                  durationHours,
                  riskModel
                )
              );
            }
          } else if (!frame.pathNodes.includes(eNext.receiver) && hops + 1 < maxLen) {
            stack.push({
              curr: eNext.receiver,
              pathNodes: [...frame.pathNodes, eNext.receiver],
              pathEdges: [...frame.pathEdges, eNext],
            });
          }
        }
      }
    }
  }

  return alerts;
}

export function detectRapidPassthrough(
  G: TransactionGraph,
  options: {
    minHops?: number;
    maxHops?: number;
    HMinutes?: number;
    minRetention?: number;
    maxExpansionsPerRoot?: number;
    riskModel?: CalibratedRiskModel;
  } = {}
): Alert[] {
  const minHops = options.minHops ?? 3;
  const maxHops = options.maxHops ?? 6;
  const HMinutes = options.HMinutes ?? 60.0;
  const minRetention = options.minRetention ?? 0.80;
  const maxExpansionsPerRoot = options.maxExpansionsPerRoot ?? 2500;
  const riskModel = options.riskModel ?? getDefaultCalibratedRiskModel();
  const maxDelayMs = HMinutes * 60 * 1000;

  const alerts: Alert[] = [];
  const seenTxSets = new Set<string>();
  let counter = 0;

  const sortedNodes = Array.from(G.nodes).sort();

  for (const startNode of sortedNodes) {
    const startEdges = G.outEdges.get(startNode) ?? [];
    for (const e0 of startEdges) {
      if (e0.receiver === startNode) continue;

      const stack: Array<{
        curr: string;
        pathNodes: string[];
        pathEdges: TransactionEdge[];
      }> = [{ curr: e0.receiver, pathNodes: [startNode, e0.receiver], pathEdges: [e0] }];

      let expansions = 0;
      while (stack.length > 0) {
        const frame = stack.pop()!;
        expansions++;
        if (expansions > maxExpansionsPerRoot) break;

        const hops = frame.pathEdges.length;
        const prevEdge = frame.pathEdges[hops - 1];

        let extended = false;
        if (hops < maxHops) {
          const out = G.outEdges.get(frame.curr) ?? [];
          for (const eNext of out) {
            if (frame.pathNodes.includes(eNext.receiver)) continue;
            const dt = eNext.tsMs - prevEdge.tsMs;
            if (dt < 0) continue;
            if (dt > maxDelayMs) break;
            if (eNext.amount >= minRetention * prevEdge.amount) {
              extended = true;
              stack.push({
                curr: eNext.receiver,
                pathNodes: [...frame.pathNodes, eNext.receiver],
                pathEdges: [...frame.pathEdges, eNext],
              });
            }
          }
        }

        if (!extended && hops >= minHops) {
          const key = frame.pathEdges.map((e) => e.tx_id).join('|');
          if (seenTxSets.has(key)) continue;
          seenTxSets.add(key);

          const t0 = frame.pathEdges[0];
          const tEnd = frame.pathEdges[frame.pathEdges.length - 1];
          const durationHours = (tEnd.tsMs - t0.tsMs) / (3600 * 1000);
          const amounts = frame.pathEdges.map((e) => e.amount);

          const hopDelaysMin: number[] = [];
          const hopRetentions: number[] = [];
          for (let i = 1; i < frame.pathEdges.length; i++) {
            hopDelaysMin.push((frame.pathEdges[i].tsMs - frame.pathEdges[i - 1].tsMs) / 60000);
            hopRetentions.push(frame.pathEdges[i].amount / frame.pathEdges[i - 1].amount);
          }

          const minHopRet = Math.min(...hopRetentions);
          const endToEndRet = amounts[0] > 0 ? amounts[amounts.length - 1] / amounts[0] : 0;
          const totalAmount = Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
          const txIds = frame.pathEdges.map((e) => e.tx_id);
          const repeatTxCount = countRepeatTxs(frame.pathEdges);

          const { score, breakdown } = computePriorityScore({
            durationHours,
            totalAmount,
            numAccounts: frame.pathNodes.length,
            retentionRatio: minHopRet,
            repeatTxCount,
          });

          counter++;
          const chainPath = frame.pathNodes.join(' -> ');
          const maxDelay = Math.max(...hopDelaysMin);
          const avgDelay = hopDelaysMin.reduce((a, b) => a + b, 0) / hopDelaysMin.length;

          alerts.push(
            attachRiskScores(
              {
                alert_id: `ALT_PT_${String(counter).padStart(4, '0')}`,
                typology: 'Rapid Pass-through',
                accounts: [...frame.pathNodes],
                tx_ids: txIds,
                start_time: t0.timestamp,
                end_time: tEnd.timestamp,
                total_amount: totalAmount,
                evidence: {
                  hops,
                  chain_path: chainPath,
                  max_hop_delay_min: Math.round(maxDelay * 100) / 100,
                  avg_hop_delay_min: Math.round(avgDelay * 100) / 100,
                  min_hop_retention: Math.round(minHopRet * 10000) / 10000,
                  end_to_end_retention: Math.round(endToEndRet * 10000) / 10000,
                  initial_amount: Math.round(amounts[0] * 100) / 100,
                  final_amount: Math.round(amounts[amounts.length - 1] * 100) / 100,
                },
                reasons: [
                  `${hops}-hop rapid pass-through chain (${chainPath}) forwarded funds with max hop delay ${maxDelay.toFixed(1)} min (limit ${HMinutes.toFixed(0)} min).`,
                  `Minimum hop retention was ${(minHopRet * 100).toFixed(1)}% (end-to-end ${(endToEndRet * 100).toFixed(1)}%).`,
                ],
                priority_score: score,
                score_breakdown: breakdown,
              },
              durationHours,
              riskModel
            )
          );
        }
      }
    }
  }

  const maximalAlerts = alerts.filter((cand) => {
    return !alerts.some(
      (other) =>
        other.alert_id !== cand.alert_id &&
        other.tx_ids.length > cand.tx_ids.length &&
        cand.tx_ids.every((id) => other.tx_ids.includes(id))
    );
  });

  return maximalAlerts;
}
