export type AgentScreen =
  | 'overview'
  | 'investigation'
  | 'adversarial_lab'
  | 'sar_dossier'
  | 'evaluation';

export type CapabilityPermission = 'read' | 'draft' | 'write';
export type AgentRunStatus = 'queued' | 'running' | 'needs_review' | 'completed' | 'failed' | 'cancelled';

export interface CapabilityDescriptor {
  id: string;
  contractVersion: number;
  screen: AgentScreen;
  permission: CapabilityPermission;
  description: string;
}

export interface CapabilityContext {
  runId: string;
  workflowId: string;
  startedBy: string;
  signal?: AbortSignal;
}

export interface Capability<I = unknown, O = unknown> {
  descriptor: CapabilityDescriptor;
  execute(input: I, context: CapabilityContext): Promise<O> | O;
}

export interface WorkflowContext {
  initialInput: unknown;
  outputs: Readonly<Record<string, unknown>>;
}

export interface WorkflowStep {
  id: string;
  capabilityId: string;
  resolveInput(context: WorkflowContext): unknown;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  requiresHumanReview?: boolean;
}

export interface AgentRun {
  id: string;
  workflowId: string;
  status: AgentRunStatus;
  startedBy: string;
  createdAt: string;
  updatedAt: string;
  completedSteps: string[];
  outputs: Record<string, unknown>;
  error?: string;
}

export interface AgentRunEvent {
  id: string;
  runId: string;
  type:
    | 'run_started'
    | 'step_started'
    | 'step_completed'
    | 'approval_required'
    | 'run_completed'
    | 'run_cancelled'
    | 'run_failed';
  timestamp: string;
  stepId?: string;
  capabilityId?: string;
  detail?: string;
  durationMs?: number;
}
