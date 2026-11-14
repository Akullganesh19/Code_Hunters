import type {TransactionEdge} from '@tracelayer/aml-engine';
import type {DetectionPipelineOptions} from '@tracelayer/aml-engine';

export interface AgentRun {
  id: string;
  workflowId: string;
  status: 'queued' | 'running' | 'needs_review' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  completedSteps: string[];
  outputs: Record<string, unknown>;
  error?: string;
}

const agentBaseUrl = import.meta.env.VITE_AGENT_BASE_URL ?? '';

export async function listRecentAgentRuns(limit = 8): Promise<AgentRun[]> {
  const response = await fetch(`${agentBaseUrl}/api/agent/runs?limit=${limit}`, {
    credentials: 'same-origin',
  });
  const payload = (await response.json()) as {runs?: AgentRun[]; error?: string};
  if (!response.ok) throw new Error(payload.error ?? 'Could not load recent agent reviews.');
  return payload.runs ?? [];
}

export interface AgentChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnalystDecisionAction {
  type: 'set_alert_decision';
  alertId: string;
  decision: 'Confirmed' | 'Dismissed';
  typology: string;
}

export interface AgentNavigationAction {
  type: 'navigate_screen';
  screen: 'Overview' | 'Investigation' | 'Adversarial Lab' | 'SAR Case Dossier' | 'Evaluation';
  alertId?: string;
}

export type AgentUiAction = AnalystDecisionAction | AgentNavigationAction;

export interface AgentChatResponse {
  text: string;
  model: string;
  pendingActions: AgentUiAction[];
}

export async function sendAgentMessage(args: {
  message: string;
  history: AgentChatMessage[];
  transactions: TransactionEdge[];
  sourceLabel: string;
  hasGroundTruthLabels: boolean;
  activeScreen: string;
  options: DetectionPipelineOptions;
  signal?: AbortSignal;
}): Promise<AgentChatResponse> {
  const {signal, ...payloadArgs} = args;
  const response = await fetch(`${agentBaseUrl}/api/agent/chat`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({...payloadArgs, history: args.history.slice(-10)}),
    signal,
  });
  const payload = (await response.json()) as AgentChatResponse & {error?: string};
  if (!response.ok) throw new Error(payload.error ?? 'The TraceLayer agent could not respond.');
  return payload;
}

export async function startFiveScreenReview(
  transactions: TransactionEdge[],
  sourceLabel: string
): Promise<AgentRun> {
  const response = await fetch(`${agentBaseUrl}/api/agent/runs`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      workflowId: 'aml.five_screen_review',
      input: {transactions, sourceLabel, benchmarkRows: 400},
    }),
  });
  const payload = (await response.json()) as {run?: AgentRun; error?: string};
  if (!response.ok && !payload.run) {
    throw new Error(payload.error ?? 'The agent could not start this review.');
  }
  if (!payload.run) throw new Error('The agent service returned an empty run.');
  return payload.run;
}

export async function getAgentRun(runId: string): Promise<AgentRun> {
  const response = await fetch(`${agentBaseUrl}/api/agent/runs/${encodeURIComponent(runId)}`, {
    credentials: 'same-origin',
  });
  const payload = (await response.json()) as {run?: AgentRun; error?: string};
  if (!response.ok || !payload.run) throw new Error(payload.error ?? 'Could not load the agent run status.');
  return payload.run;
}

export async function cancelAgentRun(runId: string): Promise<AgentRun> {
  const response = await fetch(`${agentBaseUrl}/api/agent/runs/${encodeURIComponent(runId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  const payload = (await response.json()) as {run?: AgentRun; error?: string};
  if (!response.ok || !payload.run) throw new Error(payload.error ?? 'Could not cancel the agent run.');
  return payload.run;
}
