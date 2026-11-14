import type {RawTransactionInput, TransactionEdge, Alert} from '@tracelayer/aml-engine';
import type {WorkflowDefinition, WorkflowContext} from '../contracts';

interface FiveScreenReviewInput {
  transactions: RawTransactionInput[];
  sourceLabel?: string;
  benchmarkRows?: number;
  seed?: number;
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
        return {transactions: input.transactions};
      },
    },
    {
      id: 'investigation',
      capabilityId: 'investigation.inspect_alert',
      resolveInput(context) {
        const {edges, alerts} = overview(context);
        const alert = [...alerts].sort((a, b) => b.priority_score - a.priority_score)[0];
        if (!alert) return {transactions: edges, alert: null};
        return {transactions: edges, alert};
      },
    },
    {
      id: 'adversarial_lab',
      capabilityId: 'adversarial.run_scenario',
      resolveInput(context) {
        const {edges} = overview(context);
        return {
          transactions: edges,
          baselineThreshold: 10_000,
          config: {
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
        return {
          transactions: edges,
          alerts: topAlert ? [topAlert] : [],
          sourceLabel: input.sourceLabel ?? 'synthetic demo data',
        };
      },
    },
    {
      id: 'evaluation',
      capabilityId: 'evaluation.run_benchmark',
      resolveInput(context) {
        const input = initialInput(context);
        return {rows: input.benchmarkRows ?? 400, seed: input.seed ?? 42};
      },
    },
  ],
};
