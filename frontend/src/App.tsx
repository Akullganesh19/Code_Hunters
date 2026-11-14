import { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  FileText,
  FlaskConical,
  Home,
  Search,
  Shield,
} from 'lucide-react';
import { AdversarialLabScreen } from './components/AdversarialLabScreen';
import { EvaluationScreen } from './components/EvaluationScreen';
import { InvestigationScreen } from './components/InvestigationScreen';
import { OverviewScreen } from './components/OverviewScreen';
import { ParticleWaveCanvas } from './components/ParticleWaveCanvas';
import { SarDossierScreen } from './components/SarDossierScreen';
import { SidebarSearch } from './components/SidebarSearch';
import {
  DEMO_SOURCE_LABEL,
  getDemoTransactions,
  parseCsvTransactions,
} from '@tracelayer/aml-engine';
import {
  ENTERPRISE_SCREENS,
  type ScreenId,
} from '@tracelayer/aml-engine';
import type { TransactionEdge, SearchResultItem } from '@tracelayer/aml-engine';
import { analyzeTransactions, type AnalysisResponse } from './services/api';

const SCREEN_ICONS: Record<ScreenId, typeof Home> = {
  Overview: Home,
  Investigation: Search,
  'Adversarial Lab': FlaskConical,
  'SAR Case Dossier': FileText,
  Evaluation: BarChart3,
};

export default function App() {
  const [activeScreen, setActiveScreen] = useState<ScreenId>('Overview');
  const [edges, setEdges] = useState<TransactionEdge[]>(() => getDemoTransactions());
  const [sourceLabel, setSourceLabel] = useState<string>(DEMO_SOURCE_LABEL);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [focusedEntity, setFocusedEntity] = useState<SearchResultItem | null>(null);
  const [focusedTxId, setFocusedTxId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, 'Confirmed' | 'Dismissed'>>({});

  // Detector parameters
  const [kMin, setKMin] = useState<number>(5);
  const [wHours, setWHours] = useState<number>(24);
  const [hMinutes, setHMinutes] = useState<number>(60);
  const [minRetention, setMinRetention] = useState<number>(0.8);

  const [pipelineResult, setPipelineResult] = useState<AnalysisResponse>({
    edges: [],
    alerts: [],
    runtimeMs: 0,
    edgesPerSec: 0,
  });

  useEffect(() => {
    let active = true;
    analyzeTransactions(edges, {
      K: kMin,
      WHours: wHours,
      HMinutes: hMinutes,
      minRetention,
    })
      .then((result) => {
        if (active) {
          setPipelineResult(result);
          setValidationError(null);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setValidationError(error instanceof Error ? error.message : 'Analysis service unavailable.');
        }
      });

    return () => {
      active = false;
    };
  }, [edges, kMin, wHours, hMinutes, minRetention]);

  const handleLoadDemo = () => {
    setValidationError(null);
    setEdges(getDemoTransactions());
    setSourceLabel(DEMO_SOURCE_LABEL);
    setDecisions({});
    setSelectedAlertId(null);
    setFocusedEntity(null);
    setFocusedTxId(null);
  };

  const handleUploadCsv = (csvText: string, fileName: string) => {
    try {
      const parsed = parseCsvTransactions(csvText);
      setEdges(parsed);
      setSourceLabel(`uploaded CSV: ${fileName}`);
      setValidationError(null);
      setDecisions({});
      setSelectedAlertId(null);
      setFocusedEntity(null);
      setFocusedTxId(null);
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Invalid CSV file.');
    }
  };

  const handleInspectAlert = (alertId: string) => {
    setSelectedAlertId(alertId);
    setFocusedTxId(null);
    setActiveScreen('Investigation');
  };

  const handleSelectSearchResult = (item: SearchResultItem) => {
    setFocusedEntity(item);
    if (item.linkedAlertId) {
      setSelectedAlertId(item.linkedAlertId);
      setFocusedTxId(item.kind === 'transaction' ? item.id : null);
      setActiveScreen('Investigation');
    } else {
      setFocusedTxId(item.kind === 'transaction' ? item.id : null);
      setActiveScreen('Overview');
    }
  };

  const handleSetDecision = (alertId: string, decision: 'Confirmed' | 'Dismissed') => {
    setDecisions((prev) => ({ ...prev, [alertId]: decision }));
  };

  return (
    <div className="relative flex min-h-screen flex-col md:flex-row">
      {/* Ambient 3D Emerald Particle Wave in Top-Right Background */}
      <ParticleWaveCanvas
        colorRgb="110, 175, 130"
        cols={62}
        rows={20}
        tiltX={40}
        className="fixed top-0 right-0 left-0 h-56 opacity-70 md:left-60"
      />

      {/* Sidebar Navigation — Strictly 5 Screens */}
      <aside className="relative z-10 flex w-full shrink-0 flex-col justify-between border-b border-white/10 bg-[#0e1813]/95 backdrop-blur-xl md:w-60 md:border-r md:border-b-0">
        <div className="p-4">
          <div className="mb-6 flex items-center gap-3 px-2 pt-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-violet-500/40 bg-violet-600/20 text-violet-300">
              <Activity className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="font-display text-lg font-bold tracking-tight text-white">
                Trace<span className="text-violet-400">Layer</span>
              </div>
              <div className="text-[11px] text-[#93a199]">Detect. Investigate. Prevent.</div>
            </div>
          </div>

          <SidebarSearch
            edges={pipelineResult.edges}
            alerts={pipelineResult.alerts}
            onSelectResult={handleSelectSearchResult}
          />

          <nav aria-label="Enterprise AML Command Center" className="flex flex-row gap-1 overflow-x-auto md:flex-col">
            {ENTERPRISE_SCREENS.map((screen) => {
              const Icon = SCREEN_ICONS[screen];
              const isActive = activeScreen === screen;
              return (
                <button
                  key={screen}
                  type="button"
                  onClick={() => setActiveScreen(screen)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-violet-500 ${
                    isActive
                      ? 'border border-violet-500/50 bg-gradient-to-r from-violet-600/80 to-violet-500/40 text-white shadow-lg shadow-violet-950/40'
                      : 'border border-transparent text-[#93a199] hover:bg-white/5 hover:text-[#f3f5f4]'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{screen}</span>
                </button>
              );
            })}
          </nav>

          {/* Detector Parameters */}
          <div className="mt-6 hidden space-y-3 rounded-xl border border-white/10 bg-[#132019]/80 p-3.5 md:block">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#f3f5f4]">
              <Shield className="h-3.5 w-3.5 text-[#4ade80]" aria-hidden="true" />
              <span>Detector Thresholds</span>
            </div>

            <div className="text-[11px]">
              <label htmlFor="param-k" className="flex justify-between text-[#93a199]">
                <span>Min counterparties (K)</span>
                <span className="font-mono text-[#f3f5f4] tabular-nums">{kMin}</span>
              </label>
              <input
                id="param-k"
                type="range"
                min={3}
                max={12}
                value={kMin}
                onChange={(e) => setKMin(Number(e.target.value))}
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            <div className="text-[11px]">
              <label htmlFor="param-w" className="flex justify-between text-[#93a199]">
                <span>Fan window W (hours)</span>
                <span className="font-mono text-[#f3f5f4] tabular-nums">{wHours}h</span>
              </label>
              <input
                id="param-w"
                type="range"
                min={4}
                max={72}
                step={2}
                value={wHours}
                onChange={(e) => setWHours(Number(e.target.value))}
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            <div className="text-[11px]">
              <label htmlFor="param-h" className="flex justify-between text-[#93a199]">
                <span>Pass-through delay H</span>
                <span className="font-mono text-[#f3f5f4] tabular-nums">{hMinutes}m</span>
              </label>
              <input
                id="param-h"
                type="range"
                min={30}
                max={90}
                step={5}
                value={hMinutes}
                onChange={(e) => setHMinutes(Number(e.target.value))}
                className="mt-1 w-full accent-violet-500"
              />
            </div>

            <div className="text-[11px]">
              <label htmlFor="param-r" className="flex justify-between text-[#93a199]">
                <span>Min retention (R)</span>
                <span className="font-mono text-[#f3f5f4] tabular-nums">
                  {Math.round(minRetention * 100)}%
                </span>
              </label>
              <input
                id="param-r"
                type="range"
                min={0.7}
                max={0.95}
                step={0.05}
                value={minRetention}
                onChange={(e) => setMinRetention(Number(e.target.value))}
                className="mt-1 w-full accent-violet-500"
              />
            </div>
          </div>
        </div>

        <div className="relative hidden overflow-hidden px-4 pt-12 pb-4 md:block">
          <ParticleWaveCanvas
            colorRgb="168, 85, 247"
            cols={36}
            rows={12}
            tiltX={22}
            className="absolute inset-x-0 bottom-6 h-24 opacity-70"
          />
          <div className="relative z-10 text-[11px] text-[#93a199]">
            Temporal Graph AML Engine · 5-Screen Command Center
          </div>
        </div>
      </aside>

      {/* Main Content Workspace */}
      <main className="relative z-10 min-w-0 flex-1 p-5 md:p-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-[#f3f5f4]">
              {activeScreen === 'Overview' ? (
                <>
                  Welcome to <span className="text-violet-400">TraceLayer</span>
                </>
              ) : (
                activeScreen
              )}
            </h1>
            <p className="mt-1 text-xs text-[#93a199]">
              {activeScreen === 'Overview' &&
                'Command Center: dataset ingestion, typology risk distribution, 3D transaction graph, and ranked alert queue.'}
              {activeScreen === 'Investigation' &&
                'Forensic Graph Workbench: capped 1-hop context, chronological hop-by-hop replay, Heuristic vs. XGBoost delta, and analyst disposition.'}
              {activeScreen === 'Adversarial Lab' &&
                'What-If Stress-Test Sandbox: configure and inject synthetic laundering motifs to compare graph detection against single-tx thresholds.'}
              {activeScreen === 'SAR Case Dossier' &&
                'Compliance & Export: audit-ready Suspicious Activity Report narrative, chronological ledger, and deterministic SHA-256 evidence digest.'}
              {activeScreen === 'Evaluation' &&
                '3-Tier Benchmark & Telemetry: held-out temporal split metrics, ablation table, counterexample verification, and PSI drift telemetry.'}
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs text-[#93a199]">
            <span className="font-mono tabular-nums">
              {Object.values(decisions).filter((d) => d === 'Confirmed').length} confirmed
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{pipelineResult.alerts.length} active alerts</span>
            <span
              aria-label={`Pipeline runtime ${pipelineResult.runtimeMs.toFixed(1)} milliseconds, ${pipelineResult.edgesPerSec.toLocaleString('en-US')} edges per second`}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 font-mono tabular-nums text-emerald-300"
            >
              <span
                className="h-1.5 w-1.5 rounded-full bg-[#4ade80] shadow-[0_0_8px_rgba(74,222,128,0.75)]"
                aria-hidden="true"
              />
              <span>
                {pipelineResult.runtimeMs.toFixed(1)} ms •{' '}
                {pipelineResult.edgesPerSec.toLocaleString('en-US')} edges/s
              </span>
            </span>
          </div>
        </header>

        {activeScreen === 'Overview' && (
          <OverviewScreen
            edges={pipelineResult.edges}
            alerts={pipelineResult.alerts}
            sourceLabel={sourceLabel}
            decisions={decisions}
            validationError={validationError}
            focusedEntity={focusedEntity}
            onClearFocus={() => {
              setFocusedEntity(null);
              setFocusedTxId(null);
            }}
            onLoadDemo={handleLoadDemo}
            onUploadCsv={handleUploadCsv}
            onInspectAlert={handleInspectAlert}
          />
        )}

        {activeScreen === 'Investigation' && (
          <InvestigationScreen
            edges={pipelineResult.edges}
            alerts={pipelineResult.alerts}
            selectedAlertId={selectedAlertId}
            focusedTxId={focusedTxId}
            decisions={decisions}
            onSelectAlert={(id) => {
              setSelectedAlertId(id);
              setFocusedTxId(null);
            }}
            onSetDecision={handleSetDecision}
            onOpenDossier={() => setActiveScreen('SAR Case Dossier')}
          />
        )}

        {activeScreen === 'Adversarial Lab' && (
          <AdversarialLabScreen baseEdges={pipelineResult.edges} />
        )}

        {activeScreen === 'SAR Case Dossier' && (
          <SarDossierScreen
            edges={pipelineResult.edges}
            alerts={pipelineResult.alerts}
            decisions={decisions}
            sourceLabel={sourceLabel}
          />
        )}

        {activeScreen === 'Evaluation' && <EvaluationScreen />}
      </main>
    </div>
  );
}
