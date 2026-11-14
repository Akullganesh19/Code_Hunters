import { useMemo, useState } from 'react';
import { FlaskConical, RotateCcw } from 'lucide-react';
import {
  injectAdversarialMotif,
  MAX_ADVERSARIAL_SANDBOX_ROWS,
  runDetectionPipeline,
  type AdversarialMotifConfig,
} from '@tracelayer/aml-engine';
import type { TransactionEdge } from '@tracelayer/aml-engine';
import { TransactionGraph3D } from './TransactionGraph3D';

interface AdversarialLabScreenProps {
  baseEdges: TransactionEdge[];
}

const QUICK_REGULATORY_PRESETS: Array<{
  label: string;
  config: AdversarialMotifConfig;
  baselineT: number;
}> = [
  {
    label: 'FIU-IND Sub-50k Mule Chain',
    config: {
      typology: 'Rapid Pass-through',
      hopCount: 4,
      retentionRatio: 0.94,
      hopDelayMinutes: 15,
      amountPerTx: 48000,
      wrongTimeOrder: false,
    },
    baselineT: 50000,
  },
  {
    label: 'FinCEN Sub-10k Smurfing',
    config: {
      typology: 'Fan-in/Fan-out',
      hopCount: 6,
      retentionRatio: 0.95,
      hopDelayMinutes: 12,
      amountPerTx: 9200,
      wrongTimeOrder: false,
    },
    baselineT: 10000,
  },
  {
    label: 'Invalid Time-Order Cycle (Guard Test)',
    config: {
      typology: 'Chronological Cycle',
      hopCount: 3,
      retentionRatio: 0.95,
      hopDelayMinutes: 20,
      amountPerTx: 125000,
      wrongTimeOrder: true,
    },
    baselineT: 100000,
  },
];

export function AdversarialLabScreen({ baseEdges }: AdversarialLabScreenProps) {
  const [typology, setTypology] =
    useState<AdversarialMotifConfig['typology']>('Rapid Pass-through');
  const [hopCount, setHopCount] = useState<number>(4);
  const [retentionRatio, setRetentionRatio] = useState<number>(0.94);
  const [hopDelayMinutes, setHopDelayMinutes] = useState<number>(20);
  const [amountPerTx, setAmountPerTx] = useState<number>(8500);
  const [wrongTimeOrder, setWrongTimeOrder] = useState<boolean>(false);
  const [baselineT, setBaselineT] = useState<number>(10000);
  const [injectedConfig, setInjectedConfig] = useState<AdversarialMotifConfig | null>({
    typology: 'Rapid Pass-through',
    hopCount: 4,
    retentionRatio: 0.94,
    hopDelayMinutes: 20,
    amountPerTx: 8500,
    wrongTimeOrder: false,
  });

  const simulation = useMemo(() => {
    if (!injectedConfig) {
      return null;
    }

    const { sandboxEdges, injectedTxIds, injectedAccounts } = injectAdversarialMotif(
      baseEdges,
      injectedConfig
    );
    const result = runDetectionPipeline(sandboxEdges, {}, MAX_ADVERSARIAL_SANDBOX_ROWS);

    const injectedSet = new Set(injectedTxIds);
    const matchingAlerts = result.alerts.filter((a) =>
      a.tx_ids.some((id) => injectedSet.has(id))
    );
    const graphCaughtIds = new Set(
      matchingAlerts.flatMap((a) => a.tx_ids.filter((id) => injectedSet.has(id)))
    );

    const injectedEdgesOnly = sandboxEdges.filter((e) => injectedSet.has(e.tx_id));
    const baselineCaughtIds = new Set(
      injectedEdgesOnly.filter((e) => e.amount >= baselineT).map((e) => e.tx_id)
    );

    return {
      sandboxEdges,
      injectedTxIds,
      injectedAccounts,
      injectedEdgesOnly,
      matchingAlerts,
      graphCaughtCount: graphCaughtIds.size,
      baselineCaughtCount: baselineCaughtIds.size,
      totalInjected: injectedTxIds.length,
    };
  }, [baseEdges, injectedConfig, baselineT]);

  const handleRunInjection = () => {
    setInjectedConfig({
      typology,
      hopCount,
      retentionRatio,
      hopDelayMinutes,
      amountPerTx,
      wrongTimeOrder,
    });
  };

  const handleApplyPreset = (preset: (typeof QUICK_REGULATORY_PRESETS)[number]) => {
    setTypology(preset.config.typology);
    setHopCount(preset.config.hopCount);
    setRetentionRatio(preset.config.retentionRatio);
    setHopDelayMinutes(preset.config.hopDelayMinutes);
    setAmountPerTx(preset.config.amountPerTx);
    setWrongTimeOrder(preset.config.wrongTimeOrder);
    setBaselineT(preset.baselineT);
    setInjectedConfig(preset.config);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Sandbox Configuration Panel */}
        <div className="rounded-xl border border-white/10 bg-[#15201a]/80 p-5 lg:col-span-5">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-[#f3f5f4]">
                Adversarial Motif Configurator
              </h3>
              <p className="text-[11px] text-[#93a199]">
                Inject synthetic structuring or timing perturbations into an isolated sandbox graph
              </p>
            </div>
            <FlaskConical className="h-4 w-4 text-violet-400" aria-hidden="true" />
          </div>

          <div className="mt-4 space-y-3.5 text-xs">
            <div className="space-y-2">
              <div className="font-medium text-[#93a199]">Quick Regulatory Stress Presets</div>
              <div className="flex flex-wrap gap-2">
                {QUICK_REGULATORY_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    className="rounded-lg border border-emerald-500/25 bg-gradient-to-r from-emerald-500/10 to-violet-500/10 px-2.5 py-1.5 text-left text-[10px] font-medium text-[#c8d8ce] transition hover:border-emerald-400/50 hover:bg-emerald-500/15 hover:text-white focus-visible:outline-2 focus-visible:outline-violet-500"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="adv-typology" className="block font-medium text-[#93a199]">
                Target Laundering Typology
              </label>
              <select
                id="adv-typology"
                value={typology}
                onChange={(e) =>
                  setTypology(e.target.value as AdversarialMotifConfig['typology'])
                }
                className="mt-1 w-full rounded-lg border border-white/15 bg-[#0e1813] px-3 py-2 text-xs text-[#f3f5f4]"
              >
                <option value="Rapid Pass-through">Rapid Pass-through Chain</option>
                <option value="Chronological Cycle">Chronological Cycle</option>
                <option value="Fan-in/Fan-out">Fan-in Structuring Burst</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="adv-hops" className="block font-medium text-[#93a199]">
                  Hops / Counterparties ({hopCount})
                </label>
                <input
                  id="adv-hops"
                  type="range"
                  min={3}
                  max={8}
                  value={hopCount}
                  onChange={(e) => setHopCount(Number(e.target.value))}
                  className="mt-1.5 w-full accent-violet-500"
                />
              </div>

              <div>
                <label htmlFor="adv-retention" className="block font-medium text-[#93a199]">
                  Hop Retention ({Math.round(retentionRatio * 100)}%)
                </label>
                <input
                  id="adv-retention"
                  type="range"
                  min={0.5}
                  max={1.0}
                  step={0.01}
                  value={retentionRatio}
                  onChange={(e) => setRetentionRatio(Number(e.target.value))}
                  className="mt-1.5 w-full accent-violet-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="adv-delay" className="block font-medium text-[#93a199]">
                  Hop Delay Speed ({hopDelayMinutes} min)
                </label>
                <input
                  id="adv-delay"
                  type="range"
                  min={5}
                  max={120}
                  step={1}
                  value={hopDelayMinutes}
                  onChange={(e) => setHopDelayMinutes(Number(e.target.value))}
                  className="mt-1.5 w-full accent-violet-500"
                />
              </div>

              <div>
                <label htmlFor="adv-amount" className="block font-medium text-[#93a199]">
                  Amount per Tx ($)
                </label>
                <input
                  id="adv-amount"
                  type="number"
                  min={500}
                  max={500000}
                  step={500}
                  value={amountPerTx}
                  onChange={(e) => setAmountPerTx(Math.max(500, Number(e.target.value) || 8500))}
                  className="mt-1 w-full rounded-lg border border-white/15 bg-[#0e1813] px-3 py-1.5 font-mono text-xs text-[#f3f5f4] tabular-nums"
                />
              </div>
            </div>

            <div>
              <label htmlFor="adv-baseline-t" className="block font-medium text-[#93a199]">
                Single-Tx Baseline Threshold T ($)
              </label>
              <input
                id="adv-baseline-t"
                type="number"
                min={1000}
                max={500000}
                step={1000}
                value={baselineT}
                onChange={(e) => setBaselineT(Math.max(1000, Number(e.target.value) || 10000))}
                className="mt-1 w-full rounded-lg border border-white/15 bg-[#0e1813] px-3 py-1.5 font-mono text-xs text-[#f3f5f4] tabular-nums"
              />
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-white/10 bg-[#0d1611] px-3 py-2">
              <input
                type="checkbox"
                checked={wrongTimeOrder}
                onChange={(e) => setWrongTimeOrder(e.target.checked)}
                className="h-4 w-4 accent-violet-500"
              />
              <span className="text-xs text-[#f3f5f4]">
                Invert hop #2 timestamp (wrong chronological order counterexample)
              </span>
            </label>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleRunInjection}
                className="flex-1 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-500 focus-visible:outline-2 focus-visible:outline-violet-400"
              >
                Inject & Run Stress Test
              </button>
              <button
                type="button"
                onClick={() => setInjectedConfig(null)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-[#f3f5f4] hover:bg-white/10"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* Live Detection Comparison & 3D Sandbox Graph */}
        <div className="space-y-4 lg:col-span-7">
          {simulation ? (
            <>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-[#15201a]/80 p-4">
                  <div className="text-xs text-[#93a199]">
                    Single-Transaction Baseline (amount &ge; ${baselineT.toLocaleString('en-US')})
                  </div>
                  <div className="mt-1.5 font-mono text-2xl font-bold text-[#e6dcc8] tabular-nums">
                    {simulation.baselineCaughtCount} / {simulation.totalInjected} txs flagged
                  </div>
                  <div className="mt-1 text-xs text-[#93a199]">
                    {simulation.baselineCaughtCount === 0
                      ? 'Evaded by sub-threshold structuring amounts.'
                      : 'Flagged by static amount threshold.'}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-[#15201a]/80 p-4">
                  <div className="text-xs text-[#93a199]">TraceLayer Graph Detector</div>
                  <div className="mt-1.5 font-mono text-2xl font-bold text-[#4ade80] tabular-nums">
                    {simulation.graphCaughtCount} / {simulation.totalInjected} txs caught
                  </div>
                  <div className="mt-1 text-xs text-[#93a199]">
                    {simulation.matchingAlerts.length > 0
                      ? `Triggered ${simulation.matchingAlerts[0].alert_id} (Score ${simulation.matchingAlerts[0].priority_score.toFixed(1)}/100)`
                      : injectedConfig?.wrongTimeOrder
                        ? 'Correctly rejected: invalid chronological timestamp order.'
                        : 'Below motif detection bounds (delay / retention / K).'}
                  </div>
                </div>
              </div>

              <TransactionGraph3D
                edges={simulation.injectedEdgesOnly}
                highlightedAlert={simulation.matchingAlerts[0] ?? null}
                flaggedAccounts={new Set(simulation.injectedAccounts)}
                height={320}
                title="Sandbox Injected Motif (3D View)"
                testId="adversarial-3d-graph"
              />
            </>
          ) : (
            <div className="flex h-full min-h-[340px] flex-col items-center justify-center rounded-xl border border-white/10 bg-[#15201a]/80 p-8 text-center">
              <h4 className="text-sm font-semibold text-[#f3f5f4]">Sandbox Cleared</h4>
              <p className="mt-1 text-xs text-[#93a199]">
                Configure motif parameters on the left and click Inject & Run Stress Test.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
