import { useMemo, useRef, useState } from 'react';
import { BarChart3, Play, Upload } from 'lucide-react';
import {
  DOCUMENTED_LIMITATIONS,
  evaluateTemporalSplit,
  runCounterexampleSuite,
  type EvaluationReport,
} from '@tracelayer/aml-engine';
import {
  BENCHMARK_SOURCE_LABEL,
  generateIbmAmlBenchmark,
  parseCsvTransactions,
} from '@tracelayer/aml-engine';

export function EvaluationScreen() {
  const [splitRatio, setSplitRatio] = useState<number>(0.7);
  const [seed, setSeed] = useState<number>(42);
  const [benchmarkRows, setBenchmarkRows] = useState<number>(15000);
  const [customCsvName, setCustomCsvName] = useState<string | null>(null);
  const [customCsvText, setCustomCsvText] = useState<string | null>(null);
  const [report, setReport] = useState<EvaluationReport>(() => {
    const initial = generateIbmAmlBenchmark(12000, 42);
    return evaluateTemporalSplit(initial, { splitRatio: 0.7, seed: 42, rowCapApplied: 12000 });
  });
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const counterexamples = useMemo(() => runCounterexampleSuite(), []);

  const handleRunEvaluation = () => {
    try {
      setError(null);
      const edges = customCsvText
        ? parseCsvTransactions(customCsvText, benchmarkRows)
        : generateIbmAmlBenchmark(benchmarkRows, seed);
      const rep = evaluateTemporalSplit(edges, {
        splitRatio,
        seed,
        rowCapApplied: benchmarkRows,
      });
      setReport(rep);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Evaluation failed.');
    }
  };

  const handleUploadBenchmark = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCustomCsvText(reader.result);
        setCustomCsvName(file.name);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-4">
      {/* Benchmark Controls */}
      <div className="rounded-xl border border-white/10 bg-[#15201a]/80 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-violet-400" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-[#f3f5f4]">
                3-Tier Temporal-Split Benchmark ({BENCHMARK_SOURCE_LABEL})
              </h3>
            </div>
            <p className="mt-0.5 text-xs text-[#93a199]">
              Strictly separated from demo data. Tunes T, graph parameters, and XGBoost risk model
              on first {(splitRatio * 100).toFixed(0)}% of timeline; reports exclusively on held-out remainder.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleUploadBenchmark}
              className="hidden"
              aria-label="Upload IBM AML HI-Small CSV"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-[#f3f5f4] hover:bg-white/10 whitespace-nowrap"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              {customCsvName ? `CSV: ${customCsvName}` : 'Upload IBM HI-Small CSV'}
            </button>
            <button
              type="button"
              onClick={handleRunEvaluation}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-500 whitespace-nowrap"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              Run 3-Tier Temporal Evaluation
            </button>
          </div>
        </div>

        <div className="mt-3.5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="eval-split" className="block text-xs font-medium text-[#93a199]">
              Temporal Train Split ({(splitRatio * 100).toFixed(0)}% train /{' '}
              {((1 - splitRatio) * 100).toFixed(0)}% held-out)
            </label>
            <input
              id="eval-split"
              type="range"
              min={0.6}
              max={0.8}
              step={0.05}
              value={splitRatio}
              onChange={(e) => setSplitRatio(Number(e.target.value))}
              className="mt-1.5 w-full accent-violet-500"
            />
          </div>

          <div>
            <label htmlFor="eval-rows" className="block text-xs font-medium text-[#93a199]">
              Benchmark Subsample Row Cap
            </label>
            <select
              id="eval-rows"
              value={benchmarkRows}
              onChange={(e) => setBenchmarkRows(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-white/15 bg-[#0e1813] px-3 py-1.5 font-mono text-xs text-[#f3f5f4]"
            >
              <option value={12000}>12,000 rows (Fast Interactive)</option>
              <option value={25000}>25,000 rows (Balanced)</option>
              <option value={100000}>100,000 rows (HI-Small Subsample)</option>
              <option value={150000}>150,000 rows (HI-Small Full Cap)</option>
            </select>
          </div>

          <div>
            <label htmlFor="eval-seed" className="block text-xs font-medium text-[#93a199]">
              Deterministic Seed
            </label>
            <input
              id="eval-seed"
              type="number"
              min={1}
              max={99999}
              value={seed}
              onChange={(e) => setSeed(Math.max(1, Number(e.target.value) || 42))}
              className="mt-1 w-full rounded-lg border border-white/15 bg-[#0e1813] px-3 py-1.5 font-mono text-xs text-[#f3f5f4] tabular-nums"
            />
          </div>
        </div>

        {error && (
          <div role="alert" className="mt-3 rounded-lg border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-200">
            {error}
          </div>
        )}
      </div>

      {/* Logged Anti-Leakage Split Banner */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-white/10 bg-[#0d1611] px-4 py-2.5 font-mono text-xs text-[#93a199] tabular-nums">
        <span>
          Seed: <strong className="text-[#f3f5f4]">{report.seed}</strong>
        </span>
        <span>
          Split Boundary: <strong className="text-violet-300">{report.splitBoundary}</strong>
        </span>
        <span>
          Train Rows: <strong className="text-[#f3f5f4]">{report.trainRows.toLocaleString('en-US')}</strong>
        </span>
        <span>
          Held-Out Test Rows:{' '}
          <strong className="text-[#4ade80]">{report.testRows.toLocaleString('en-US')}</strong>
        </span>
        <span>
          Tuned T: <strong className="text-[#e6dcc8]">${report.tunedT.toLocaleString('en-US')}</strong>
        </span>
      </div>

      {/* 3-Tier Ablation Table */}
      <div className="rounded-xl border border-white/10 bg-[#15201a]/80">
        <div className="border-b border-white/10 px-4 py-3">
          <h3 className="text-sm font-semibold text-[#f3f5f4]">
            3-Tier Ablation Table (Held-Out Test Set Only)
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-[11px] text-[#93a199]">
                <th className="px-4 py-2.5 font-medium">Detection Tier</th>
                <th className="px-3 py-2.5 text-right font-medium">Tx Prec</th>
                <th className="px-3 py-2.5 text-right font-medium">Tx Recall</th>
                <th className="px-3 py-2.5 text-right font-medium">Tx F1</th>
                <th className="px-3 py-2.5 text-right font-medium">Cluster Prec</th>
                <th className="px-3 py-2.5 text-right font-medium">Cluster Recall</th>
                <th className="px-3 py-2.5 text-right font-medium">Cluster F1</th>
                <th className="px-3 py-2.5 text-right font-medium">Mean Jaccard IoU</th>
                <th className="px-4 py-2.5 text-right font-medium">Alerts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono tabular-nums">
              {report.ablationTable.map((row) => (
                <tr key={row.tier} className="hover:bg-white/5">
                  <td className="px-4 py-2.5 font-sans font-medium text-[#f3f5f4]">{row.tier}</td>
                  <td className="px-3 py-2.5 text-right text-[#f3f5f4]">{row.txPrecision.toFixed(3)}</td>
                  <td className="px-3 py-2.5 text-right text-[#f3f5f4]">{row.txRecall.toFixed(3)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-violet-300">{row.txF1.toFixed(3)}</td>
                  <td className="px-3 py-2.5 text-right text-[#f3f5f4]">{row.clusterPrecision.toFixed(3)}</td>
                  <td className="px-3 py-2.5 text-right text-[#4ade80]">{row.clusterRecall.toFixed(3)}</td>
                  <td className="px-3 py-2.5 text-right text-[#f3f5f4]">{row.clusterF1.toFixed(3)}</td>
                  <td className="px-3 py-2.5 text-right text-[#e6dcc8]">{row.meanJaccardIoU.toFixed(3)}</td>
                  <td className="px-4 py-2.5 text-right text-[#93a199]">{row.alertsCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-Typology Recall + Confusion Counts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-[#15201a]/80">
          <div className="border-b border-white/10 px-4 py-3">
            <h3 className="text-sm font-semibold text-[#f3f5f4]">
              Per-Typology Held-Out Recall
            </h3>
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-[11px] text-[#93a199]">
                <th className="px-4 py-2 font-medium">Typology</th>
                <th className="px-3 py-2 text-right font-medium">Tx Caught</th>
                <th className="px-3 py-2 text-right font-medium">Tx Recall</th>
                <th className="px-3 py-2 text-right font-medium">Rings Caught</th>
                <th className="px-4 py-2 text-right font-medium">Ring Recall</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono tabular-nums">
              {report.perTypologyRecall.map((row) => (
                <tr key={row.typology}>
                  <td className="px-4 py-2.5 font-sans text-[#f3f5f4]">{row.typology}</td>
                  <td className="px-3 py-2.5 text-right text-[#93a199]">
                    {row.txCaught}/{row.txTotal}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[#4ade80]">
                    {(row.txRecall * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2.5 text-right text-[#93a199]">
                    {row.ringsCaught}/{row.ringsTotal}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-violet-300">
                    {(row.ringRecall * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#15201a]/80">
          <div className="border-b border-white/10 px-4 py-3">
            <h3 className="text-sm font-semibold text-[#f3f5f4]">
              Held-Out Transaction Confusion Counts
            </h3>
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-[11px] text-[#93a199]">
                <th className="px-4 py-2 font-medium">Model Tier</th>
                <th className="px-3 py-2 text-right font-medium">TP</th>
                <th className="px-3 py-2 text-right font-medium">FP</th>
                <th className="px-3 py-2 text-right font-medium">TN</th>
                <th className="px-4 py-2 text-right font-medium">FN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono tabular-nums">
              {[
                { name: 'Tier 1: Baseline (amount >= T)', c: report.baselineConfusion },
                { name: 'Tier 2: Graph Detector', c: report.graphConfusion },
                { name: 'Tier 3: Graph + XGBoost Hybrid', c: report.hybridConfusion },
              ].map((item) => (
                <tr key={item.name}>
                  <td className="px-4 py-2.5 font-sans text-[#f3f5f4]">{item.name}</td>
                  <td className="px-3 py-2.5 text-right text-[#4ade80]">{item.c.tp}</td>
                  <td className="px-3 py-2.5 text-right text-amber-300">{item.c.fp}</td>
                  <td className="px-3 py-2.5 text-right text-[#93a199]">{item.c.tn.toLocaleString('en-US')}</td>
                  <td className="px-4 py-2.5 text-right text-red-300">{item.c.fn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Counterexample Pass/Fail Verification + Sampling & Drift Telemetry */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="rounded-xl border border-white/10 bg-[#15201a]/80 lg:col-span-7">
          <div className="border-b border-white/10 px-4 py-3">
            <h3 className="text-sm font-semibold text-[#f3f5f4]">
              Counterexample Pass / Fail Verification Table
            </h3>
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-[11px] text-[#93a199]">
                <th className="px-4 py-2 font-medium">Verification Case</th>
                <th className="px-3 py-2 font-medium">Expected</th>
                <th className="px-3 py-2 font-medium">Observed</th>
                <th className="px-4 py-2 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {counterexamples.map((ce) => (
                <tr key={ce.caseName}>
                  <td className="px-4 py-2 text-[#f3f5f4]">{ce.caseName}</td>
                  <td className="px-3 py-2 text-[#93a199]">{ce.expected}</td>
                  <td className="px-3 py-2 text-[#e6dcc8]">{ce.observed}</td>
                  <td
                    className={`px-4 py-2 text-right font-mono font-semibold ${
                      ce.status === 'PASS' ? 'text-[#4ade80]' : 'text-red-400'
                    }`}
                  >
                    {ce.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-4 lg:col-span-5">
          <div className="rounded-xl border border-white/10 bg-[#15201a]/80 p-4">
            <h3 className="text-sm font-semibold text-[#f3f5f4]">Sampling & Drift Telemetry</h3>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between border-b border-white/5 pb-1.5">
                <span className="text-[#93a199]">Amount Distribution PSI</span>
                <span className="font-mono text-[#f3f5f4] tabular-nums">
                  {report.telemetry.amountPsi.toFixed(4)} ({report.telemetry.driftStatus})
                </span>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-1.5">
                <span className="text-[#93a199]">Train / Test Positive Rate</span>
                <span className="font-mono text-[#f3f5f4] tabular-nums">
                  {(report.telemetry.trainPositiveRate * 100).toFixed(2)}% /{' '}
                  {(report.telemetry.testPositiveRate * 100).toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-1.5">
                <span className="text-[#93a199]">Active Account Overlap (Test in Train)</span>
                <span className="font-mono text-[#e6dcc8] tabular-nums">
                  {report.telemetry.activeAccountOverlapPct.toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#93a199]">Subsample Row Cap Applied</span>
                <span className="font-mono text-[#f3f5f4] tabular-nums">
                  {report.telemetry.rowCapApplied.toLocaleString('en-US')}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#15201a]/80 p-4">
            <h3 className="text-sm font-semibold text-[#f3f5f4]">Documented Limitations</h3>
            <ul className="mt-2.5 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-[#93a199]">
              {DOCUMENTED_LIMITATIONS.map((lim) => (
                <li key={lim}>{lim}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
