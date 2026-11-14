import {
  buildSarCaseDossier,
  evaluateTemporalSplit,
  extractMotifSubgraph,
  formatDossierMarkdown,
  generateIbmAmlBenchmark,
  injectAdversarialMotif,
  MAX_ADVERSARIAL_SANDBOX_ROWS,
  runDetectionPipeline,
  searchDataset,
  validateTransactions,
  type AdversarialMotifConfig,
  type Alert,
  type DetectionPipelineOptions,
  type RawTransactionInput,
  type TransactionEdge,
  validateSarCaseDossier,
} from '@tracelayer/aml-engine';
import {CapabilityRegistry} from '../capability-registry';

function objectInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Capability input must be an object.');
  }
  return input as Record<string, unknown>;
}

function transactionsFrom(input: Record<string, unknown>): RawTransactionInput[] {
  if (!Array.isArray(input.transactions)) {
    throw new Error('Capability input must include a transactions array.');
  }
  return input.transactions as RawTransactionInput[];
}

function candidateOptionsFrom(value: unknown): DetectionPipelineOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Comparison settings must be an object.');
  }
  const candidate = value as Record<string, unknown>;
  const bounds: Record<string, {min: number; max: number; integer?: boolean}> = {
    K: {min: 2, max: 100, integer: true},
    WHours: {min: 1, max: 720},
    cycleWHours: {min: 1, max: 720},
    HMinutes: {min: 1, max: 1440},
    minRetention: {min: 0, max: 1},
  };
  const options: DetectionPipelineOptions = {};
  for (const [key, rawValue] of Object.entries(candidate)) {
    const bound = bounds[key];
    if (!bound) throw new Error(`Unsupported comparison setting "${key}".`);
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || rawValue < bound.min || rawValue > bound.max || (bound.integer && !Number.isInteger(rawValue))) {
      throw new Error(`Comparison setting "${key}" is outside its supported range.`);
    }
    options[key as keyof DetectionPipelineOptions] = rawValue as never;
  }
  if (Object.keys(options).length === 0) throw new Error('Provide at least one comparison setting.');
  return options;
}

function alertSignature(alert: Alert): string {
  return JSON.stringify([
    alert.typology,
    [...alert.accounts].sort(),
    [...alert.tx_ids].sort(),
  ]);
}

function benchmarkSettingsFrom(input: Record<string, unknown>) {
  const rows = input.rows ?? 4_000;
  const seedA = input.seedA ?? 42;
  const seedB = input.seedB ?? 43;
  const splitRatio = input.splitRatio ?? 0.7;
  if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < 100 || rows > 25_000) {
    throw new Error('Benchmark rows must be an integer from 100 to 25,000.');
  }
  for (const [name, value] of [['seedA', seedA], ['seedB', seedB]] as const) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 99_999) {
      throw new Error(`${name} must be an integer from 1 to 99,999.`);
    }
  }
  if (seedA === seedB) throw new Error('Benchmark comparison requires two different seeds.');
  if (typeof splitRatio !== 'number' || !Number.isFinite(splitRatio) || splitRatio < 0.6 || splitRatio > 0.8) {
    throw new Error('Benchmark split ratio must be between 0.6 and 0.8.');
  }
  return {
    rows: rows as number,
    seedA: seedA as number,
    seedB: seedB as number,
    splitRatio: splitRatio as number,
  };
}

function benchmarkSummary(report: ReturnType<typeof evaluateTemporalSplit>) {
  const tier = (name: 'baselineConfusion' | 'graphConfusion' | 'hybridConfusion') => ({
    precision: report[name].precision,
    recall: report[name].recall,
    f1: report[name].f1,
  });
  const cluster = (tier: string) => report.ablationTable.find((row) => row.tier.startsWith(tier))?.clusterF1 ?? 0;
  return {
    seed: report.seed,
    trainRows: report.trainRows,
    testRows: report.testRows,
    singleTransaction: tier('baselineConfusion'),
    graph: tier('graphConfusion'),
    hybrid: tier('hybridConfusion'),
    graphClusterF1: cluster('Tier 2:'),
    hybridClusterF1: cluster('Tier 3:'),
    amountPsi: report.telemetry.amountPsi,
    driftStatus: report.telemetry.driftStatus,
  };
}

export function compareSyntheticBenchmarks(input: Record<string, unknown>) {
  const {rows, seedA, seedB, splitRatio} = benchmarkSettingsFrom(input);
  const evaluate = (seed: number) => evaluateTemporalSplit(generateIbmAmlBenchmark(rows, seed), {
    splitRatio,
    seed,
    rowCapApplied: rows,
  });
  const first = benchmarkSummary(evaluate(seedA));
  const second = benchmarkSummary(evaluate(seedB));
  const delta = (a: number, b: number) => Math.round((b - a) * 10_000) / 10_000;
  return {
    synthetic: true,
    rows,
    splitRatio,
    runs: [first, second],
    candidateMinusBaseline: {
      singleTransactionF1: delta(first.singleTransaction.f1, second.singleTransaction.f1),
      graphF1: delta(first.graph.f1, second.graph.f1),
      hybridF1: delta(first.hybrid.f1, second.hybrid.f1),
      graphClusterF1: delta(first.graphClusterF1, second.graphClusterF1),
      hybridClusterF1: delta(first.hybridClusterF1, second.hybridClusterF1),
      amountPsi: delta(first.amountPsi, second.amountPsi),
    },
    interpretation: 'Different deterministic seeds create different synthetic samples. Metric deltas are a seed-sensitivity check, not evidence of real-world or production performance.',
  };
}

export function compareDetectorSettings(
  edges: TransactionEdge[],
  baselineAlerts: Alert[],
  candidateOptions: unknown,
) {
  const options = candidateOptionsFrom(candidateOptions);
  const result = runDetectionPipeline(edges, options);
  const baselineBySignature = new Map(baselineAlerts.map((alert) => [alertSignature(alert), alert]));
  const candidateBySignature = new Map(result.alerts.map((alert) => [alertSignature(alert), alert]));
  const added = result.alerts.filter((alert) => !baselineBySignature.has(alertSignature(alert)));
  const removed = baselineAlerts.filter((alert) => !candidateBySignature.has(alertSignature(alert)));
  return {
    baselineAlertCount: baselineAlerts.length,
    candidateAlertCount: result.alerts.length,
    addedAlertCount: added.length,
    removedAlertCount: removed.length,
    unchangedAlertCount: result.alerts.length - added.length,
    candidateOptions: options,
    runtimeMs: result.runtimeMs,
    addedExamples: added.slice(0, 12).map(({alert_id, typology, priority_score, accounts, tx_ids}) => ({
      alertId: alert_id, typology, priority: priority_score, accounts, transactionIds: tx_ids,
    })),
    removedExamples: removed.slice(0, 12).map(({alert_id, typology, priority_score, accounts, tx_ids}) => ({
      alertId: alert_id, typology, priority: priority_score, accounts, transactionIds: tx_ids,
    })),
    note: 'This read-only what-if uses the current dataset. It does not change active settings or analyst dispositions.',
  };
}

export function createAmlCapabilityRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry();

  registry.register({
    descriptor: {
      id: 'overview.search_dataset',
      screen: 'overview',
      permission: 'read',
      description: 'Search current alerts, accounts, and transaction IDs in the active dataset.',
    },
    execute(input) {
      const payload = objectInput(input);
      const edges = validateTransactions(transactionsFrom(payload));
      const analysis = runDetectionPipeline(edges, payload.options as never);
      return searchDataset(String(payload.query ?? ''), edges, analysis.alerts, 12);
    },
  });

  registry.register({
    descriptor: {
      id: 'overview.compare_detector_settings',
      screen: 'overview',
      permission: 'read',
      description: 'Compare candidate detector settings with active findings without changing the current dataset or settings.',
    },
    execute(input) {
      const payload = objectInput(input);
      const edges = validateTransactions(transactionsFrom(payload));
      const baselineAlerts = payload.baselineAlerts;
      if (!Array.isArray(baselineAlerts)) throw new Error('Comparison input must include the active baseline alerts.');
      return compareDetectorSettings(edges, baselineAlerts as Alert[], payload.candidateOptions);
    },
  });

  registry.register({
    descriptor: {
      id: 'overview.analyze_dataset',
      screen: 'overview',
      permission: 'read',
      description: 'Run the deterministic AML pipeline and return ranked alerts with normalized transactions.',
    },
    execute(input) {
      const payload = objectInput(input);
      const result = runDetectionPipeline(transactionsFrom(payload), payload.options as never);
      return {
        edges: result.edges,
        alerts: result.alerts,
        runtimeMs: result.runtimeMs,
        edgesPerSec: result.edgesPerSec,
      };
    },
  });

  registry.register({
    descriptor: {
      id: 'investigation.inspect_alert',
      screen: 'investigation',
      permission: 'read',
      description: 'Return a bounded graph subgraph for an alert and preserve transaction chronology.',
    },
    execute(input) {
      const payload = objectInput(input);
      const edges = transactionsFrom(payload) as TransactionEdge[];
      const alert = payload.alert as Alert | undefined;
      if (!alert) {
        return {
          motifEdges: [],
          contextEdges: [],
          combinedEdges: [],
          message: 'No alert was generated; there is no finding to inspect.',
        };
      }
      return extractMotifSubgraph(edges, alert, 75);
    },
  });

  registry.register({
    descriptor: {
      id: 'investigation.lookup_transaction',
      screen: 'investigation',
      permission: 'read',
      description: 'Look up one transaction by exact ID and return linked alert evidence.',
    },
    execute(input) {
      const payload = objectInput(input);
      const txId = String(payload.txId ?? '');
      const edges = validateTransactions(transactionsFrom(payload));
      const transaction = edges.find((edge) => edge.tx_id === txId);
      if (!transaction) return {found: false, txId};
      const analysis = runDetectionPipeline(edges, payload.options as never);
      const linkedAlerts = analysis.alerts
        .filter((alert) => alert.tx_ids.includes(txId))
        .map((alert) => ({alertId: alert.alert_id, typology: alert.typology}));
      return {found: true, transaction, linkedAlerts};
    },
  });

  registry.register({
    descriptor: {
      id: 'investigation.account_activity',
      screen: 'investigation',
      permission: 'read',
      description: 'Summarize an account’s transaction activity and linked alerts.',
    },
    execute(input) {
      const payload = objectInput(input);
      const accountId = String(payload.accountId ?? '');
      const edges = validateTransactions(transactionsFrom(payload));
      const activity = edges.filter((edge) => edge.sender === accountId || edge.receiver === accountId);
      const analysis = runDetectionPipeline(edges, payload.options as never);
      return {
        accountId,
        transactionCount: activity.length,
        inboundCount: activity.filter((edge) => edge.receiver === accountId).length,
        outboundCount: activity.filter((edge) => edge.sender === accountId).length,
        totalVolume: Math.round(activity.reduce((sum, edge) => sum + edge.amount, 0) * 100) / 100,
        linkedAlerts: analysis.alerts
          .filter((alert) => alert.accounts.includes(accountId))
          .map((alert) => ({alertId: alert.alert_id, typology: alert.typology, priority: alert.priority_score})),
        recentTransactions: activity.slice(-30),
      };
    },
  });

  registry.register({
    descriptor: {
      id: 'investigation.propose_disposition',
      screen: 'investigation',
      permission: 'write',
      description: 'Prepare a Confirmed or Dismissed disposition proposal; the analyst must apply it in the UI.',
    },
    execute(input) {
      const payload = objectInput(input);
      const alertId = String(payload.alertId ?? '');
      const decision = payload.decision;
      if (decision !== 'Confirmed' && decision !== 'Dismissed') {
        throw new Error('Decision must be Confirmed or Dismissed.');
      }
      const edges = validateTransactions(transactionsFrom(payload));
      const analysis = runDetectionPipeline(edges, payload.options as never);
      const alert = analysis.alerts.find((item) => item.alert_id === alertId);
      if (!alert) throw new Error(`Alert "${alertId}" is not in the current dataset.`);
      return {
        requiresAnalystConfirmation: true,
        alertId,
        decision,
        typology: alert.typology,
        message: 'No disposition was changed. The analyst must apply this proposal in TraceLayer.',
      };
    },
  });

  registry.register({
    descriptor: {
      id: 'adversarial.run_scenario',
      screen: 'adversarial_lab',
      permission: 'read',
      description: 'Run a synthetic laundering motif and compare detector findings with a simple amount threshold.',
    },
    execute(input) {
      const payload = objectInput(input);
      const baseEdges = transactionsFrom(payload) as TransactionEdge[];
      const config = payload.config as AdversarialMotifConfig | undefined;
      if (!config) throw new Error('Capability input must include a scenario config.');
      const baselineThreshold = Number(payload.baselineThreshold ?? 10_000);
      const injected = injectAdversarialMotif(baseEdges, config);
      const analysis = runDetectionPipeline(injected.sandboxEdges, {}, MAX_ADVERSARIAL_SANDBOX_ROWS);
      const injectedIds = new Set(injected.injectedTxIds);
      const matchingAlerts = analysis.alerts.filter((alert) =>
        alert.tx_ids.some((txId) => injectedIds.has(txId))
      );
      const graphCaught = new Set(matchingAlerts.flatMap((alert) =>
        alert.tx_ids.filter((txId) => injectedIds.has(txId))
      ));
      const injectedEdges = injected.sandboxEdges.filter((edge) => injectedIds.has(edge.tx_id));
      const baselineCaught = injectedEdges.filter((edge) => edge.amount >= baselineThreshold);

      return {
        injectedTxIds: injected.injectedTxIds,
        injectedAccounts: injected.injectedAccounts,
        matchingAlerts,
        graphCaughtCount: graphCaught.size,
        baselineCaughtCount: baselineCaught.length,
        totalInjected: injected.injectedTxIds.length,
      };
    },
  });

  registry.register({
    descriptor: {
      id: 'dossier.draft_case',
      screen: 'sar_dossier',
      permission: 'draft',
      description: 'Create and validate an evidence-linked case draft before returning exportable Markdown; never submit it externally.',
    },
    execute(input) {
      const payload = objectInput(input);
      const alerts = payload.alerts;
      if (!Array.isArray(alerts)) throw new Error('Capability input must include an alerts array.');
      const edges = validateTransactions(transactionsFrom(payload));
      const dossier = buildSarCaseDossier({
        selectedAlerts: alerts as Alert[],
        allEdges: edges,
        sourceLabel: String(payload.sourceLabel ?? 'uploaded dataset'),
      });
      const validation = validateSarCaseDossier(dossier, edges);
      return {
        dossier,
        validation,
        draftReady: validation.valid,
        ...(validation.valid ? {markdown: formatDossierMarkdown(dossier)} : {}),
      };
    },
  });

  registry.register({
    descriptor: {
      id: 'evaluation.run_benchmark',
      screen: 'evaluation',
      permission: 'read',
      description: 'Run a reproducible temporal benchmark and return held-out metrics.',
    },
    execute(input) {
      const payload = objectInput(input);
      const rows = Math.max(100, Math.min(25_000, Number(payload.rows ?? 4_000)));
      const seed = Number(payload.seed ?? 42);
      const edges = generateIbmAmlBenchmark(rows, seed);
      return evaluateTemporalSplit(edges, {
        splitRatio: Number(payload.splitRatio ?? 0.7),
        seed,
        rowCapApplied: rows,
      });
    },
  });

  registry.register({
    descriptor: {
      id: 'evaluation.compare_benchmarks',
      screen: 'evaluation',
      permission: 'read',
      description: 'Compare held-out metrics across two bounded, deterministic synthetic benchmark seeds and report seed sensitivity.',
    },
    execute(input) {
      return compareSyntheticBenchmarks(objectInput(input));
    },
  });

  return registry;
}
