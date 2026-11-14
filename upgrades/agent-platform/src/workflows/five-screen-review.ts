import type {RawTransactionInput, TransactionEdge, Alert, AdversarialMotifConfig} from '@tracelayer/aml-engine';
import type {WorkflowDefinition, WorkflowContext} from '../contracts';

interface FiveScreenReviewInput {
  transactions: RawTransactionInput[];
  sourceLabel?: string;
  benchmarkRows?: number;
  seed?: number;
  selectedAlertId?: string;
  alertIds?: string[];
  adversarialConfig?: AdversarialMotifConfig;
  baselineThreshold?: number;
  agentArguments?: Record<string, Record<string, unknown>>;
  options?: Record<string, number>;
}

function initialInput(context: WorkflowContext): FiveScreenReviewInput {
  const input = context.initialInput as Partial<FiveScreenReviewInput> | null;
  if (!input || !Array.isArray(input.transactions)) {
    throw new Error('Five-screen review needs a transactions array.');
  }
  return input as FiveScreenReviewInput;
}

function overview(context: WorkflowContext): {edges: TransactionEdge[]; alerts: Alert[]} {
  const result = context.outputs.overview as {edges?: TransactionEdge[]; alerts?: Alert[]} | undefined;
  if (!result?.edges || !result.alerts) {
    throw new Error('Overview analysis must run before downstream review steps.');
  }
  return {edges: result.edges, alerts: result.alerts};
}

function agentArguments(context: WorkflowContext, capabilityId: string): Record<string, unknown> {
  const input = context.initialInput as Partial<FiveScreenReviewInput> | null;
  return input?.agentArguments?.[capabilityId] ?? {};
}

export const fiveScreenReviewWorkflow: WorkflowDefinition = {
  id: 'aml.five_screen_review',
  name: 'Five-screen AML review',
  description: 'Analyze a dataset, inspect evidence, test a synthetic scenario, draft a case, and run a benchmark.',
  requiresHumanReview: true,
  steps: [
    {
      id: 'overview',
      capabilityId: 'overview.analyze_dataset',
      resolveInput(context) {
        const input = initialInput(context);
        const args = agentArguments(context, 'overview.analyze_dataset');
        return {transactions: input.transactions, options: args.options ?? input.options};
      },
    },
    {
      id: 'investigation',
      capabilityId: 'investigation.inspect_alert',
      resolveInput(context) {
        const {edges, alerts} = overview(context);
        const input = initialInput(context);
        const requestedAlertId = agentArguments(context, 'investigation.inspect_alert').alertId ?? input.selectedAlertId;
        const alert = (typeof requestedAlertId === 'string' ? alerts.find((item) => item.alert_id === requestedAlertId) : undefined)
          ?? [...alerts].sort((a, b) => b.priority_score - a.priority_score)[0];
        if (!alert) return {transactions: edges, alert: null};
        return {transactions: edges, alert};
      },
    },
    {
      id: 'adversarial_lab',
      capabilityId: 'adversarial.run_scenario',
      resolveInput(context) {
        const input = initialInput(context);
        const {edges} = overview(context);
        const args = agentArguments(context, 'adversarial.run_scenario');
        return {
          transactions: edges,
          baselineThreshold: args.baselineThreshold ?? input.baselineThreshold ?? 10_000,
          config: args.config ?? input.adversarialConfig ?? {
            typology: 'Rapid Pass-through',
            hopCount: 4,
            retentionRatio: 0.94,
            hopDelayMinutes: 20,
            amountPerTx: 8_500,
            wrongTimeOrder: false,
          },
        };
      },
    },
    {
      id: 'sar_dossier',
      capabilityId: 'dossier.draft_case',
      resolveInput(context) {
        const input = initialInput(context);
        const {edges, alerts} = overview(context);
        const topAlert = [...alerts].sort((a, b) => b.priority_score - a.priority_score)[0];
        const args = agentArguments(context, 'dossier.draft_case');
        const requestedIds = Array.isArray(args.alertIds) ? args.alertIds : input.alertIds;
        const selectedAlerts = requestedIds?.length
          ? alerts.filter((alert) => requestedIds.includes(alert.alert_id))
          : topAlert ? [topAlert] : [];
        return {
          transactions: edges,
          alerts: selectedAlerts,
          sourceLabel: args.sourceLabel ?? input.sourceLabel ?? 'synthetic demo data',
        };
      },
    },
    {
      id: 'evaluation',
      capabilityId: 'evaluation.run_benchmark',
      resolveInput(context) {
        const input = (context.initialInput && typeof context.initialInput === 'object'
          ? context.initialInput
          : {}) as Partial<FiveScreenReviewInput>;
        const args = agentArguments(context, 'evaluation.run_benchmark');
        return {rows: args.rows ?? input.benchmarkRows ?? 400, seed: args.seed ?? input.seed ?? 42};
      },
    },
  ],
};
