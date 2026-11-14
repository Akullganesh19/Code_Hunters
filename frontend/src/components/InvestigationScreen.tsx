import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Pause,
  Play,
  XCircle,
} from 'lucide-react';
import { extractMotifSubgraph } from '@tracelayer/aml-engine';
import type { Alert, TransactionEdge } from '@tracelayer/aml-engine';
import { TransactionGraph3D } from './TransactionGraph3D';

interface InvestigationScreenProps {
  edges: TransactionEdge[];
  alerts: Alert[];
  selectedAlertId: string | null;
  focusedTxId?: string | null;
  decisions: Record<string, 'Confirmed' | 'Dismissed'>;
  onSelectAlert: (alertId: string) => void;
  onSetDecision: (alertId: string, decision: 'Confirmed' | 'Dismissed') => void;
  onOpenDossier: () => void;
}

export function InvestigationScreen({
  edges,
  alerts,
  selectedAlertId,
  focusedTxId = null,
  decisions,
  onSelectAlert,
  onSetDecision,
  onOpenDossier,
}: InvestigationScreenProps) {
  const [contextCap, setContextCap] = useState<number>(75);
  const [replayStep, setReplayStep] = useState<number>(1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const selectedAlert = useMemo(() => {
    if (alerts.length === 0) return null;
    return alerts.find((a) => a.alert_id === selectedAlertId) ?? alerts[0];
  }, [alerts, selectedAlertId]);

  const { motifEdges, contextEdges, combinedEdges } = useMemo(
    () => extractMotifSubgraph(edges, selectedAlert, contextCap),
    [edges, selectedAlert, contextCap]
  );

  // Reset or jump replay scrubber when selected alert or focusedTxId changes
  useEffect(() => {
    setIsPlaying(false);
    if (focusedTxId) {
      const idx = motifEdges.findIndex((e) => e.tx_id === focusedTxId);
      if (idx >= 0) {
        setReplayStep(idx + 1);
        return;
      }
    }
    setReplayStep(motifEdges.length > 0 ? motifEdges.length : 1);
  }, [selectedAlert?.alert_id, focusedTxId, motifEdges]);

  useEffect(() => {
    if (!isPlaying || motifEdges.length <= 1) return;
    const timer = window.setInterval(() => {
      setReplayStep((prev) => {
        if (prev >= motifEdges.length) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 950);
    return () => window.clearInterval(timer);
  }, [isPlaying, motifEdges.length]);

  if (!selectedAlert) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#15201a]/80 p-8 text-center">
        <h3 className="text-base font-semibold text-[#f3f5f4]">No Alerts Available to Investigate</h3>
        <p className="mt-1 text-xs text-[#93a199]">
          Load the synthetic demo dataset or upload a transaction CSV on the Overview screen.
        </p>
      </div>
    );
  }

  const flaggedAccounts = new Set(selectedAlert.accounts);
  const currentDecision = decisions[selectedAlert.alert_id] ?? 'Pending Review';
  const activeHopEdge = motifEdges[Math.min(Math.max(0, replayStep - 1), motifEdges.length - 1)];

  const deltaColor =
    selectedAlert.risk_delta > 0
      ? 'text-[#4ade80]'
      : selectedAlert.risk_delta < 0
        ? 'text-amber-300'
        : 'text-[#93a199]';

  return (
    <div className="space-y-4">
      {/* Workbench Control Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#15201a]/80 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="alert-select" className="text-xs font-medium text-[#93a199]">
            Investigating Alert
          </label>
          <select
            id="alert-select"
            value={selectedAlert.alert_id}
            onChange={(e) => onSelectAlert(e.target.value)}
            className="rounded-lg border border-white/15 bg-[#0e1813] px-3 py-1.5 font-mono text-xs text-[#f3f5f4] focus-visible:outline-2 focus-visible:outline-violet-500"
          >
            {alerts.map((a) => (
              <option key={a.alert_id} value={a.alert_id}>
                {a.alert_id} · {a.typology} · Score {a.priority_score.toFixed(1)} · $
                {Math.round(a.total_amount).toLocaleString('en-US')}
              </option>
            ))}
          </select>

          <span className="text-xs text-[#93a199]">
            Disposition:{' '}
            <strong
              className={
                currentDecision === 'Confirmed'
                  ? 'text-[#4ade80]'
                  : currentDecision === 'Dismissed'
                    ? 'text-[#93a199]'
                    : 'text-[#e6dcc8]'
              }
            >
              {currentDecision}
            </strong>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onSetDecision(selectedAlert.alert_id, 'Confirmed')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-violet-500 focus-visible:outline-2 focus-visible:outline-violet-400 whitespace-nowrap"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Confirm Alert
          </button>
          <button
            type="button"
            onClick={() => onSetDecision(selectedAlert.alert_id, 'Dismissed')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-medium text-[#f3f5f4] transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-violet-500 whitespace-nowrap"
          >
            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
            Dismiss Alert
          </button>
          <button
            type="button"
            onClick={onOpenDossier}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-medium text-[#e6dcc8] transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-violet-500 whitespace-nowrap"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            SAR Dossier
          </button>
        </div>
      </div>

      {/* Main Split: Forensic 3D Subgraph + Replay Scrubber vs Risk Comparison & Trail */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-7">
          <TransactionGraph3D
            edges={combinedEdges}
            highlightedAlert={selectedAlert}
            flaggedAccounts={flaggedAccounts}
            replayStep={replayStep}
            height={360}
            title={`Forensic Subgraph (${motifEdges.length} motif + ${contextEdges.length} context)`}
            testId="investigation-3d-graph"
          />

          {/* Chronological Hop-by-Hop Replay Scrubber/Stepper */}
          <div className="rounded-xl border border-white/10 bg-[#15201a]/80 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-xs font-semibold text-[#f3f5f4]">
                  Chronological Hop-by-Hop Replay Stepper
                </h4>
                <p className="text-[11px] text-[#93a199]">
                  Transfers stepped in exact ascending timestamp order ({motifEdges.length} hops)
                </p>
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="context-cap" className="text-[11px] text-[#93a199]">
                  Edge Cap:
                </label>
                <input
                  id="context-cap"
                  type="number"
                  min={15}
                  max={250}
                  step={15}
                  value={contextCap}
                  onChange={(e) => setContextCap(Math.max(15, Math.min(250, Number(e.target.value) || 75)))}
                  className="w-16 rounded border border-white/15 bg-[#0e1813] px-2 py-1 font-mono text-xs text-[#f3f5f4] tabular-nums"
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  if (replayStep >= motifEdges.length) setReplayStep(1);
                  setIsPlaying((p) => !p);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 whitespace-nowrap"
              >
                {isPlaying ? (
                  <>
                    <Pause className="h-3.5 w-3.5" aria-hidden="true" /> Pause
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" aria-hidden="true" /> Replay
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setReplayStep((s) => Math.max(1, s - 1));
                }}
                aria-label="Previous chronological hop"
                className="inline-flex items-center rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-[#f3f5f4] hover:bg-white/10"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Prev
              </button>

              <input
                type="range"
                min={1}
                max={Math.max(1, motifEdges.length)}
                value={replayStep}
                onChange={(e) => {
                  setIsPlaying(false);
                  setReplayStep(Number(e.target.value));
                }}
                aria-label="Chronological hop replay scrubber"
                className="flex-1 accent-violet-500"
              />

              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setReplayStep((s) => Math.min(motifEdges.length, s + 1));
                }}
                aria-label="Next chronological hop"
                className="inline-flex items-center rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-[#f3f5f4] hover:bg-white/10"
              >
                Next <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>

              <span className="font-mono text-xs font-semibold text-[#4ade80] tabular-nums">
                Hop {replayStep}/{motifEdges.length}
              </span>
            </div>

            {activeHopEdge && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#0d1611] px-3 py-2 font-mono text-xs">
                <span className="text-[#4ade80]">{activeHopEdge.tx_id}</span>
                <span className="text-[#f3f5f4]">
                  {activeHopEdge.sender} &rarr; {activeHopEdge.receiver}
                </span>
                <span className="text-[#e6dcc8] tabular-nums">
                  ${activeHopEdge.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
                <span className="text-[#93a199]">{activeHopEdge.timestamp}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Side-by-Side Heuristic vs XGBoost + Plain-Language Trail */}
        <div className="space-y-4 lg:col-span-5">
          {/* Plain-Language Trail */}
          <div className="rounded-xl border border-white/40 bg-gradient-to-br from-[#f3efe6] to-[#dcd4c3] p-4 text-[#161f1a]">
            <div className="text-[11px] font-bold tracking-wide text-[#49544e]">
              PLAIN-LANGUAGE FACTUAL TRAIL
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[#161f1a]">
              {selectedAlert.explanation}
            </p>
          </div>

          {/* Side-by-Side Heuristic vs XGBoost Risk Breakdown (Delta) */}
          <div className="rounded-xl border border-white/10 bg-[#15201a]/80 p-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-semibold text-[#f3f5f4]">
                Heuristic vs. XGBoost Risk Breakdown
              </h3>
              <span className={`font-mono text-xs font-semibold tabular-nums ${deltaColor}`}>
                &Delta; {selectedAlert.risk_delta >= 0 ? '+' : ''}
                {selectedAlert.risk_delta.toFixed(2)} pts
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-white/10 bg-[#0d1611] p-3">
                <div className="text-[11px] text-[#93a199]">Heuristic Priority Score</div>
                <div className="mt-1 font-mono text-xl font-bold text-violet-300 tabular-nums">
                  {selectedAlert.priority_score.toFixed(1)} / 100
                </div>
                <div className="mt-2 space-y-1 font-mono text-[11px] text-[#93a199] tabular-nums">
                  <div className="flex justify-between">
                    <span>30&times;speed</span>
                    <span className="text-[#f3f5f4]">
                      {selectedAlert.score_breakdown.speed_pts.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>25&times;amount</span>
                    <span className="text-[#f3f5f4]">
                      {selectedAlert.score_breakdown.amount_pts.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>15&times;accounts</span>
                    <span className="text-[#f3f5f4]">
                      {selectedAlert.score_breakdown.accounts_pts.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>20&times;retention</span>
                    <span className="text-[#f3f5f4]">
                      {selectedAlert.score_breakdown.retention_pts.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>10&times;repeat</span>
                    <span className="text-[#f3f5f4]">
                      {selectedAlert.score_breakdown.repeat_pts.toFixed(1)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-[#0d1611] p-3">
                <div className="text-[11px] text-[#93a199]">Calibrated XGBoost Risk</div>
                <div className="mt-1 font-mono text-xl font-bold text-[#e6dcc8] tabular-nums">
                  {selectedAlert.xgb_risk_score.toFixed(1)} / 100
                </div>
                <div className="mt-2 space-y-1 font-mono text-[11px] text-[#93a199] tabular-nums">
                  {selectedAlert.xgb_contributions.slice(0, 5).map((c) => (
                    <div key={c.feature} className="flex justify-between">
                      <span className="truncate pr-1">{c.feature.replace('_norm', '')}</span>
                      <span className={c.contribution >= 0 ? 'text-[#4ade80]' : 'text-amber-300'}>
                        {c.contribution >= 0 ? '+' : ''}
                        {c.contribution.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Calculated Evidence Metrics */}
          <div className="rounded-xl border border-white/10 bg-[#15201a]/80 p-4">
            <h3 className="text-sm font-semibold text-[#f3f5f4]">Calculated Evidence Metrics</h3>
            <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              {Object.entries(selectedAlert.evidence).map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between border-b border-white/5 py-1"
                >
                  <span className="text-[#93a199]">{k}</span>
                  <span className="font-mono text-[#f3f5f4] tabular-nums">
                    {Array.isArray(v) ? v.join(', ') : String(v)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Chronological Evidence Ledger */}
      <div className="rounded-xl border border-white/10 bg-[#15201a]/80">
        <div className="border-b border-white/10 px-4 py-3">
          <h3 className="text-sm font-semibold text-[#f3f5f4]">
            Motif Transaction Ledger ({motifEdges.length} Individual Edges)
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-[11px] text-[#93a199]">
                <th className="px-4 py-2 font-medium">Hop</th>
                <th className="px-4 py-2 font-medium">tx_id</th>
                <th className="px-4 py-2 font-medium">Sender</th>
                <th className="px-4 py-2 font-medium">Receiver</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono">
              {motifEdges.map((e, idx) => {
                const isActive = idx + 1 === replayStep;
                return (
                  <tr
                    key={e.tx_id}
                    className={isActive ? 'bg-emerald-500/15' : 'hover:bg-white/5'}
                  >
                    <td className="px-4 py-2 text-[#93a199] tabular-nums">
                      {idx + 1}/{motifEdges.length}
                    </td>
                    <td className="px-4 py-2 text-violet-300">{e.tx_id}</td>
                    <td className="px-4 py-2 text-[#f3f5f4]">{e.sender}</td>
                    <td className="px-4 py-2 text-[#f3f5f4]">{e.receiver}</td>
                    <td className="px-4 py-2 text-right text-[#e6dcc8] tabular-nums">
                      ${e.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-2 text-[#93a199]">{e.timestamp}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
