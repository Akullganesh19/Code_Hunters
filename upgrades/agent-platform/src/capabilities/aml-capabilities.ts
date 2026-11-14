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
  type RawTransactionInput,
  type TransactionEdge,
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
      description: 'Create an evidence-linked SAR case draft for analyst review; never submit it externally.',
    },
    execute(input) {
      const payload = objectInput(input);
      const alerts = payload.alerts;
      if (!Array.isArray(alerts)) throw new Error('Capability input must include an alerts array.');
      const dossier = buildSarCaseDossier({
        selectedAlerts: alerts as Alert[],
        allEdges: transactionsFrom(payload) as TransactionEdge[],
        sourceLabel: String(payload.sourceLabel ?? 'uploaded dataset'),
      });
      return {dossier, markdown: formatDossierMarkdown(dossier)};
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

  return registry;
}
