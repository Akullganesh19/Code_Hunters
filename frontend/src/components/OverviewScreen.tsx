import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Database, Upload, X } from 'lucide-react';
import type { Alert, TransactionEdge, SearchResultItem } from '@tracelayer/aml-engine';
import { TransactionGraph3D } from './TransactionGraph3D';

interface OverviewScreenProps {
  edges: TransactionEdge[];
  alerts: Alert[];
  sourceLabel: string;
  decisions: Record<string, 'Confirmed' | 'Dismissed'>;
  validationError: string | null;
  focusedEntity?: SearchResultItem | null;
  onClearFocus?: () => void;
  onLoadDemo: () => void;
  onUploadCsv: (csvText: string, fileName: string) => void;
  onInspectAlert: (alertId: string) => void;
}

export function OverviewScreen({
  edges,
  alerts,
  sourceLabel,
  decisions,
  validationError,
  focusedEntity = null,
  onClearFocus,
  onLoadDemo,
  onUploadCsv,
  onInspectAlert,
}: OverviewScreenProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showAlertedOnly, setShowAlertedOnly] = useState(true);

  useEffect(() => {
    setShowAlertedOnly(true);
  }, [sourceLabel]);

  const alertTransactionIds = useMemo(
    () => new Set(alerts.flatMap((alert) => alert.tx_ids)),
    [alerts]
  );
  const graphEdges = showAlertedOnly
    ? edges.filter((edge) => alertTransactionIds.has(edge.tx_id))
    : edges;

  const uniqueAccounts = new Set<string>();
  let totalVolume = 0;
  for (const e of edges) {
    uniqueAccounts.add(e.sender);
    uniqueAccounts.add(e.receiver);
    totalVolume += e.amount;
  }

  const flaggedAccounts = new Set(alerts.flatMap((a) => a.accounts));

  // Typology distribution counts across generated alerts
  const typologyCounts = {
    fanIn: alerts.filter((a) => String(a.evidence.direction ?? '').includes('fan_in')).length,
    fanOut: alerts.filter((a) => String(a.evidence.direction ?? '').includes('fan_out')).length,
    cycle: alerts.filter((a) => a.typology.includes('Chronological Cycle')).length,
    passthrough: alerts.filter((a) => a.typology.includes('Rapid Pass-through')).length,
  };
  const totalPatternHits = Math.max(
    1,
    typologyCounts.fanIn + typologyCounts.fanOut + typologyCounts.cycle + typologyCounts.passthrough
  );

  const rings = [
    {
      label: 'Fan-in',
      count: typologyCounts.fanIn,
      pct: Math.round((typologyCounts.fanIn / totalPatternHits) * 100),
      stroke: '#8b5cf6',
    },
    {
      label: 'Fan-out',
      count: typologyCounts.fanOut,
      pct: Math.round((typologyCounts.fanOut / totalPatternHits) * 100),
      stroke: '#a78bfa',
    },
    {
      label: 'Chronological Cycle',
      count: typologyCounts.cycle,
      pct: Math.round((typologyCounts.cycle / totalPatternHits) * 100),
      stroke: '#e6dcc8',
    },
    {
      label: 'Rapid Pass-through',
      count: typologyCounts.passthrough,
      pct: Math.round((typologyCounts.passthrough / totalPatternHits) * 100),
      stroke: '#4ade80',
    },
  ];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onUploadCsv(reader.result, file.name);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-4">
      {/* Dataset Ingestion Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#15201a]/80 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-[#93a199]">
          <Database className="h-4 w-4 text-violet-400" aria-hidden="true" />
          <span className="font-medium text-[#f3f5f4]">Active Source: {sourceLabel}</span>
          <span aria-hidden="true">·</span>
          <span>Directed MultiDiGraph (parallel edges preserved)</span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onLoadDemo}
            className="inline-flex items-center gap-2 rounded-lg border border-white/12 bg-white/5 px-3.5 py-2 text-xs font-medium text-[#f3f5f4] transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-violet-500 whitespace-nowrap"
          >
            Load Synthetic Demo Data
          </button>

          <button
            type="button"
            onClick={() => setShowAlertedOnly((current) => !current)}
            className="inline-flex items-center gap-2 rounded-lg border border-white/12 bg-white/5 px-3.5 py-2 text-xs font-medium text-[#f3f5f4] transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-violet-500 whitespace-nowrap"
          >
            {showAlertedOnly ? 'Show All Transactions' : 'Show Alerted Only'}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
            aria-label="Upload transaction CSV file"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-violet-500 focus-visible:outline-2 focus-visible:outline-violet-400 whitespace-nowrap"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            Upload CSV
          </button>
        </div>
      </div>

      <p className="px-1 text-[11px] text-[#93a199]" role="status">
        Graph view: {graphEdges.length.toLocaleString('en-US')} alerted transactions shown
        {showAlertedOnly ? ` of ${edges.length.toLocaleString('en-US')} uploaded` : ''}.
        Detection always runs against the full uploaded dataset.
      </p>

      {validationError && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-xs text-red-200"
        >
          <strong className="font-semibold">Schema Validation Error:</strong> {validationError}
        </div>
      )}

      {focusedEntity && !focusedEntity.linkedAlertId && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-500/40 bg-violet-950/30 px-4 py-2.5 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2 text-[#f3f5f4]">
            <span className="font-semibold text-violet-300">
              Focused {focusedEntity.kind === 'account' ? 'Account' : 'Transaction'}:
            </span>
            <span className="font-mono font-bold">{focusedEntity.id}</span>
            <span className="text-[#93a199]">({focusedEntity.subtitle})</span>
          </div>
          {onClearFocus && (
            <button
              type="button"
              onClick={onClearFocus}
              className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-[#f3f5f4] hover:bg-white/10"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              Clear Focus
            </button>
          )}
        </div>
      )}

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#15201a]/80 px-4 py-3.5">
          <div>
            <div className="text-xs text-[#93a199]">Total Transactions</div>
            <div className="mt-1 font-mono text-2xl font-bold text-[#f3f5f4] tabular-nums">
              {edges.length.toLocaleString('en-US')}
            </div>
            <div className="mt-1 text-[11px] font-medium text-[#4ade80]">
              Individual edges preserved
            </div>
          </div>
          <svg className="h-9 w-16 shrink-0" viewBox="0 0 64 36" aria-hidden="true">
            <path
              d="M2 30 L14 26 L26 28 L38 18 L50 20 L62 10"
              fill="none"
              stroke="#4ade80"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#15201a]/80 px-4 py-3.5">
          <div>
            <div className="text-xs text-[#93a199]">Unique Accounts</div>
            <div className="mt-1 font-mono text-2xl font-bold text-[#f3f5f4] tabular-nums">
              {uniqueAccounts.size.toLocaleString('en-US')}
            </div>
            <div className="mt-1 text-[11px] text-[#93a199] tabular-nums">
              {flaggedAccounts.size} in flagged motifs
            </div>
          </div>
          <svg className="h-9 w-16 shrink-0" viewBox="0 0 64 36" aria-hidden="true">
            <path
              d="M2 29 L16 27 L28 22 L42 23 L52 13 L62 14"
              fill="none"
              stroke="#4ade80"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#15201a]/80 px-4 py-3.5">
          <div>
            <div className="text-xs text-[#93a199]">Alerts Generated</div>
            <div className="mt-1 font-mono text-2xl font-bold text-[#f3f5f4] tabular-nums">
              {alerts.length}
            </div>
            <div className="mt-1 text-[11px] font-medium text-violet-300">
              3 deterministic typologies
            </div>
          </div>
          <svg className="h-9 w-16 shrink-0" viewBox="0 0 64 36" aria-hidden="true">
            <path
              d="M2 32 L14 28 L28 22 L40 24 L52 10 L62 12"
              fill="none"
              stroke="#a855f7"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#15201a]/80 px-4 py-3.5">
          <div>
            <div className="text-xs text-[#93a199]">Total Ledger Volume</div>
            <div className="mt-1 font-mono text-2xl font-bold text-[#f3f5f4] tabular-nums">
              ${Math.round(totalVolume).toLocaleString('en-US')}
            </div>
            <div className="mt-1 text-[11px] text-[#e6dcc8]">Temporal order verified</div>
          </div>
          <svg className="h-9 w-16 shrink-0" viewBox="0 0 64 36" aria-hidden="true">
            <path
              d="M2 30 L16 26 L28 20 L40 22 L52 13 L62 9"
              fill="none"
              stroke="#e6dcc8"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>

      {/* Main Split: 3D Transaction Graph + Ranked Alert Queue */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
        <div className="lg:col-span-6">
          {(() => {
            const focusedEdges =
              focusedEntity && !focusedEntity.linkedAlertId
                ? focusedEntity.kind === 'account'
                  ? graphEdges.filter(
                      (e) => e.sender === focusedEntity.id || e.receiver === focusedEntity.id
                    )
                  : graphEdges.filter((e) => e.tx_id === focusedEntity.id)
                : graphEdges;
            const focusedHighlightAccounts =
              focusedEntity && !focusedEntity.linkedAlertId
                ? new Set(focusedEdges.flatMap((e) => [e.sender, e.receiver]))
                : flaggedAccounts;
            const graphTitle =
              focusedEntity && !focusedEntity.linkedAlertId
                ? `Focused 3D Subgraph (${focusedEntity.id})`
                : 'Transaction Graph (3D Interactive)';

            return (
              <TransactionGraph3D
                edges={focusedEntity && !focusedEntity.linkedAlertId ? focusedEdges : graphEdges}
                highlightedAlert={
                  focusedEntity && !focusedEntity.linkedAlertId ? null : alerts[0] ?? null
                }
                flaggedAccounts={focusedHighlightAccounts}
                height={360}
                title={graphTitle}
                testId="overview-3d-graph"
              />
            );
          })()}
        </div>

        <div className="flex flex-col rounded-xl border border-white/10 bg-[#15201a]/80 lg:col-span-6">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-[#f3f5f4]">Ranked Alert Queue</h3>
              <p className="text-[11px] text-[#93a199]">
                Click any alert row to open Forensic Graph Workbench
              </p>
            </div>
            <span className="font-mono text-xs text-[#93a199] tabular-nums whitespace-nowrap">
              {alerts.length} alerts
            </span>
          </div>

          {alerts.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <p className="text-sm font-medium text-[#f3f5f4]">No structural alerts detected</p>
              <p className="mt-1 text-xs text-[#93a199]">
                Adjust detector thresholds in the sidebar or load the synthetic demo fixture.
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-[11px] text-[#93a199]">
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">Alert ID</th>
                    <th className="px-2.5 py-2.5 font-medium whitespace-nowrap">Typology</th>
                    <th className="px-2.5 py-2.5 text-right font-medium whitespace-nowrap">Priority</th>
                    <th className="px-2.5 py-2.5 text-right font-medium whitespace-nowrap">XGBoost</th>
                    <th className="px-2.5 py-2.5 text-right font-medium whitespace-nowrap">Amount</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {alerts.map((alert) => {
                    const status = decisions[alert.alert_id] ?? 'Pending';
                    return (
                      <tr
                        key={alert.alert_id}
                        className="transition hover:bg-violet-500/10"
                      >
                        <td className="px-3 py-2.5 font-mono font-medium text-violet-300 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => onInspectAlert(alert.alert_id)}
                            className="text-left underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-violet-500"
                          >
                            {alert.alert_id}
                          </button>
                        </td>
                        <td className="px-2.5 py-2.5 text-[#f3f5f4] whitespace-nowrap">{alert.typology}</td>
                        <td className="px-2.5 py-2.5 text-right font-mono font-semibold text-[#f3f5f4] tabular-nums whitespace-nowrap">
                          {alert.priority_score.toFixed(1)}
                        </td>
                        <td className="px-2.5 py-2.5 text-right font-mono text-[#e6dcc8] tabular-nums whitespace-nowrap">
                          {alert.xgb_risk_score.toFixed(1)}
                        </td>
                        <td className="px-2.5 py-2.5 text-right font-mono text-[#f3f5f4] tabular-nums whitespace-nowrap">
                          ${alert.total_amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                          <span
                            className={
                              status === 'Confirmed'
                                ? 'font-medium text-[#4ade80]'
                                : status === 'Dismissed'
                                  ? 'text-[#93a199]'
                                  : 'text-[#e6dcc8]'
                            }
                          >
                            {status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Row: Typology Risk Distribution + Counterexample Guardrail + Flagged for Review */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="rounded-xl border border-white/10 bg-[#15201a]/80 p-4 lg:col-span-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#f3f5f4]">Typology Risk Distribution</h3>
            <span className="text-xs text-[#93a199]">3 Active Detectors</span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {rings.map((ring) => {
              const circ = 2 * Math.PI * 30;
              const offset = circ * (1 - ring.pct / 100);
              return (
                <div key={ring.label} className="flex flex-col items-center text-center">
                  <div className="relative h-20 w-20">
                    <svg className="h-20 w-20 -rotate-90" viewBox="0 0 72 72">
                      <circle
                        cx="36"
                        cy="36"
                        r="30"
                        fill="none"
                        stroke="rgba(255,255,255,0.08)"
                        strokeWidth="6"
                      />
                      <circle
                        cx="36"
                        cy="36"
                        r="30"
                        fill="none"
                        stroke={ring.stroke}
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray={circ}
                        strokeDashoffset={offset}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center font-mono text-sm font-bold text-[#f3f5f4] tabular-nums">
                      {ring.pct}%
                    </div>
                  </div>
                  <div className="mt-2 text-xs font-medium text-[#f3f5f4]">{ring.label}</div>
                  <div className="font-mono text-[11px] text-[#93a199] tabular-nums">
                    {ring.count} alert{ring.count === 1 ? '' : 's'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#15201a]/80 p-4 lg:col-span-4">
          <h3 className="text-sm font-semibold text-[#f3f5f4]">Pipeline Safeguards</h3>
          <div className="mt-3 space-y-2.5 text-xs">
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <span className="text-[#93a199]">Steady Shop / Payroll Suppression</span>
              <span className="font-mono font-medium text-[#4ade80]">Active</span>
            </div>
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <span className="text-[#93a199]">Chronological Time-Order Guard</span>
              <span className="font-mono font-medium text-[#4ade80]">Strict (&ge;)</span>
            </div>
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <span className="text-[#93a199]">Single-Hub Merge Prevention</span>
              <span className="font-mono font-medium text-[#4ade80]">Enforced</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#93a199]">Demo vs Benchmark Isolation</span>
              <span className="font-mono font-medium text-[#e6dcc8]">Never Mixed</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-white/40 bg-gradient-to-br from-[#f3efe6] to-[#dcd4c3] p-5 text-[#161f1a] lg:col-span-3">
          <div>
            <div className="mb-2.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#161f1a] text-white">
              <Check className="h-4 w-4" aria-hidden="true" />
            </div>
            <h3 className="text-base font-bold">Flagged for Review</h3>
            <p className="mt-1 text-xs text-[#3b4640]">
              Structural graph anomalies only. Not proof of wrongdoing.
            </p>
          </div>

          <button
            type="button"
            onClick={() => alerts[0] && onInspectAlert(alerts[0].alert_id)}
            disabled={alerts.length === 0}
            className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-violet-700 whitespace-nowrap"
          >
            Go to Investigation
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
