import {randomUUID} from 'node:crypto';
import type {CapabilityDescriptor, WorkflowDefinition} from './contracts';
import {CapabilityRegistry} from './capability-registry';
import {AgentWorkflowRunner} from './workflow-runner';
import {fiveScreenReviewWorkflow} from './workflows/five-screen-review';

export interface PlannedCapability {
  capabilityId: string;
  arguments: Record<string, unknown>;
}

export interface AgentTaskResult {
  plan: PlannedCapability[];
  run: Awaited<ReturnType<AgentWorkflowRunner['start']>>;
  events: Awaited<ReturnType<AgentWorkflowRunner['getRunEvents']>>;
}

const toolCallPattern = /<\|tool_call>call:([a-zA-Z0-9_.-]+)\{/g;

function toolArguments(capability: CapabilityDescriptor): string {
  switch (capability.id) {
    case 'investigation.inspect_alert':
      return 'alertId:{type:<|"|>string<|"|>,description:<|"|>Alert identifier from the current analysis.<|"|>}';
    case 'adversarial.run_scenario':
      return 'config:{type:<|"|>object<|"|>,description:<|"|>Scenario settings for the sandbox.<|"|>},baselineThreshold:{type:<|"|>number<|"|>,description:<|"|>Simple amount threshold for comparison.<|"|>}';
    case 'dossier.draft_case':
      return 'alertIds:{type:<|"|>array<|"|>,description:<|"|>Alert identifiers to include; omit to use selected findings.<|"|>},sourceLabel:{type:<|"|>string<|"|>,description:<|"|>Dataset label for the evidence ledger.<|"|>}';
    case 'evaluation.run_benchmark':
      return 'rows:{type:<|"|>integer<|"|>,description:<|"|>Synthetic benchmark rows between 100 and 25000.<|"|>},seed:{type:<|"|>integer<|"|>,description:<|"|>Deterministic random seed.<|"|>}';
    default:
      return '';
  }
}

function promptFor(task: string, capabilities: CapabilityDescriptor[]): string {
  const declarations = capabilities.map((capability) =>
    `<|tool>declaration:${capability.id}{description:<|"|>${capability.description}<|"|>,parameters:{${toolArguments(capability)}}}<tool|>`
  ).join('');
  return [
    '<|turn>system\n',
    'You are the TraceLayer AML analyst agent. Select only the smallest set of tools needed. ',
    'Never invent results, alert IDs, or evidence. Analyze a dataset before investigating or drafting. ',
    'A SAR action creates a draft only and always needs an analyst review; never claim a report was filed. ',
    'Evaluation uses the synthetic benchmark unless the user asks otherwise. For requests outside these tools, ',
    'explain the limitation and do not call a tool. Tool call arguments must be valid JSON fields; use {} when no arguments are needed.\n',
    declarations,
    '<turn|>\n<|turn>user\n',
    task.trim().slice(0, 8000),
    '<turn|>\n<|turn>model\n',
  ].join('');
}

export class GemmaTaskAgent {
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly runner: AgentWorkflowRunner,
    private readonly endpoint = process.env.GEMMA_AGENT_URL ?? 'http://127.0.0.1:3210/generate',
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async run(task: string, input: unknown, startedBy: string): Promise<AgentTaskResult> {
    if (!task.trim()) throw new Error('Task cannot be empty.');
    const plan = await this.plan(task);
    if (plan.length === 0) throw new Error('Gemma returned no valid capability calls. No actions were run.');

    const capabilities = [...new Set(plan.map((call) => call.capabilityId))];
    const stepsByCapability = new Map(fiveScreenReviewWorkflow.steps.map((step) => [step.capabilityId, step]));
    const needsOverview = capabilities.some((id) => [
      'investigation.inspect_alert', 'adversarial.run_scenario', 'dossier.draft_case',
    ].includes(id));
    if (needsOverview && !capabilities.includes('overview.analyze_dataset')) {
      const inputObject = input && typeof input === 'object' ? input as Record<string, unknown> : {};
      if (!Array.isArray(inputObject.transactions)) {
        throw new Error('This action needs the current transaction dataset. No actions were run.');
      }
      capabilities.unshift('overview.analyze_dataset');
    } else if (needsOverview && capabilities[0] !== 'overview.analyze_dataset') {
      capabilities.splice(capabilities.indexOf('overview.analyze_dataset'), 1);
      capabilities.unshift('overview.analyze_dataset');
    }

    const steps = capabilities.map((capabilityId) => {
      const baseStep = stepsByCapability.get(capabilityId);
      if (baseStep) return baseStep;
      return {
        id: capabilityId.replace(/[^a-zA-Z0-9_-]/g, '_'),
        capabilityId,
        resolveInput(context: {initialInput: unknown}) {
          const initialInput = context.initialInput && typeof context.initialInput === 'object' && !Array.isArray(context.initialInput)
            ? context.initialInput as Record<string, unknown>
            : {};
          const {agentArguments: _agentArguments, ...sharedInput} = initialInput;
          return {...sharedInput, ...plan.find((call) => call.capabilityId === capabilityId)?.arguments};
        },
      };
    });
    const workflowId = `gemma.task.${randomUUID()}`;
    const workflowInput = input && typeof input === 'object' && !Array.isArray(input)
      ? {...input as Record<string, unknown>, agentArguments: Object.fromEntries(plan.map((call) => [call.capabilityId, call.arguments]))}
      : {agentArguments: Object.fromEntries(plan.map((call) => [call.capabilityId, call.arguments]))};
    const workflow: WorkflowDefinition = {
      id: workflowId,
      name: `Gemma task: ${task.trim().slice(0, 80)}`,
      description: 'A model-selected capability plan validated against the local registry.',
      steps,
      requiresHumanReview: capabilities.includes('dossier.draft_case'),
    };

    this.runner.registerWorkflow(workflow);
    try {
      const run = await this.runner.start(workflowId, workflowInput, startedBy);
      return {plan, run, events: await this.runner.getRunEvents(run.id)};
    } finally {
      this.runner.unregisterWorkflow(workflowId);
    }
  }

  private async plan(task: string): Promise<PlannedCapability[]> {
    const allowed = this.registry.list().filter((capability) => capability.permission !== 'write');
    const prompt = promptFor(task, allowed);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({prompt}),
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(error instanceof Error ? `Gemma service unavailable: ${error.message}` : 'Gemma service unavailable.');
    } finally {
      clearTimeout(timeout);
    }
    const payload = await response.json().catch(() => ({})) as {text?: unknown; error?: unknown};
    if (!response.ok || typeof payload.text !== 'string') {
      throw new Error(typeof payload.error === 'string' ? payload.error : `Gemma service returned HTTP ${response.status}.`);
    }

    const modelTurn = '<|turn>model\n';
    const modelTurnIndex = payload.text.indexOf(modelTurn);
    if (modelTurnIndex < 0) throw new Error('Gemma response did not include a model turn. No actions were run.');
    const generated = payload.text.slice(modelTurnIndex + modelTurn.length);
    const allowedIds = new Set(allowed.map((capability) => capability.id));
    const plan: PlannedCapability[] = [];
    for (const match of generated.matchAll(toolCallPattern)) {
      const capabilityId = match[1];
      if (!allowedIds.has(capabilityId)) {
        throw new Error(`Gemma proposed an unavailable or write capability "${capabilityId}". No actions were run.`);
      }
      if (!plan.some((call) => call.capabilityId === capabilityId)) {
        const argsStart = match.index! + match[0].length;
        const parsedArguments = parseToolArguments(generated, argsStart);
        plan.push({capabilityId, arguments: normalizeArguments(capabilityId, parsedArguments)});
      }
      if (plan.length >= 5) break;
    }
    return plan;
  }
}

function parseToolArguments(text: string, start: number): Record<string, unknown> {
  let depth = 1;
  let inString = false;
  let escaped = false;
  let end = start;
  for (; end < text.length; end++) {
    const char = text[end];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) break;
  }
  if (depth !== 0) throw new Error('Gemma returned malformed tool arguments. No actions were run.');
  const fields = text.slice(start, end).trim();
  if (!fields) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(`{${fields}}`);
  } catch {
    throw new Error('Gemma tool arguments were not valid JSON. No actions were run.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Gemma tool arguments must be a JSON object. No actions were run.');
  }
  return parsed as Record<string, unknown>;
}

function normalizeArguments(capabilityId: string, args: Record<string, unknown>): Record<string, unknown> {
  const allowedKeys: Record<string, string[]> = {
    'overview.analyze_dataset': ['options'],
    'investigation.inspect_alert': ['alertId'],
    'adversarial.run_scenario': ['config', 'baselineThreshold'],
    'dossier.draft_case': ['alertIds', 'sourceLabel'],
    'evaluation.run_benchmark': ['rows', 'seed'],
  };
  if (!(capabilityId in allowedKeys)) {
    if (Object.keys(args).length > 32) throw new Error('Future-screen tool arguments exceed 32 fields.');
    const encoded = JSON.stringify(args);
    if (encoded.length > 8_000) throw new Error('Future-screen tool arguments exceed the 8 KB limit.');
    if (Object.keys(args).some((key) => key === '__proto__' || key === 'constructor' || key === 'prototype')) {
      throw new Error('Future-screen tool arguments contain a prohibited key.');
    }
    return args;
  }
  const keys = allowedKeys[capabilityId] ?? [];
  for (const key of Object.keys(args)) {
    if (!keys.includes(key)) throw new Error(`Gemma proposed unsupported argument "${key}" for ${capabilityId}. No actions were run.`);
  }
  if (capabilityId === 'overview.analyze_dataset' && args.options !== undefined) {
    if (!args.options || typeof args.options !== 'object' || Array.isArray(args.options)) throw new Error('Analysis options must be an object.');
    const options = args.options as Record<string, unknown>;
    const ranges: Record<string, [number, number]> = {K: [3, 12], WHours: [4, 72], HMinutes: [30, 90], minRetention: [0.7, 0.95]};
    for (const [key, value] of Object.entries(options)) {
      const range = ranges[key];
      if (!range || typeof value !== 'number' || !Number.isFinite(value) || value < range[0] || value > range[1]) throw new Error(`Invalid analysis option "${key}".`);
    }
  }
  if (capabilityId === 'investigation.inspect_alert' && args.alertId !== undefined && (typeof args.alertId !== 'string' || args.alertId.length > 100)) throw new Error('Invalid alertId argument.');
  if (capabilityId === 'adversarial.run_scenario' && args.config !== undefined) {
    const config = args.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Scenario config must be an object.');
    const allowed = ['typology', 'hopCount', 'retentionRatio', 'hopDelayMinutes', 'amountPerTx', 'wrongTimeOrder'];
    if (Object.keys(config).some((key) => !allowed.includes(key))) throw new Error('Scenario config contains an unsupported field.');
    const scenario = config as Record<string, unknown>;
    if (scenario.typology !== undefined && !['Rapid Pass-through', 'Chronological Cycle', 'Fan-in/Fan-out'].includes(String(scenario.typology))) throw new Error('Invalid scenario typology.');
    if (scenario.hopCount !== undefined && (typeof scenario.hopCount !== 'number' || !Number.isInteger(scenario.hopCount) || scenario.hopCount < 3 || scenario.hopCount > 6)) throw new Error('Invalid scenario hopCount.');
    if (scenario.retentionRatio !== undefined && (typeof scenario.retentionRatio !== 'number' || scenario.retentionRatio < 0 || scenario.retentionRatio > 1)) throw new Error('Invalid scenario retentionRatio.');
    if (scenario.hopDelayMinutes !== undefined && (typeof scenario.hopDelayMinutes !== 'number' || scenario.hopDelayMinutes < 1 || scenario.hopDelayMinutes > 1440)) throw new Error('Invalid scenario hopDelayMinutes.');
    if (scenario.amountPerTx !== undefined && (typeof scenario.amountPerTx !== 'number' || !Number.isFinite(scenario.amountPerTx) || scenario.amountPerTx < 0 || scenario.amountPerTx > 1_000_000_000)) throw new Error('Invalid scenario amountPerTx.');
    if (scenario.wrongTimeOrder !== undefined && typeof scenario.wrongTimeOrder !== 'boolean') throw new Error('Invalid scenario wrongTimeOrder.');
  }
  if (capabilityId === 'adversarial.run_scenario' && args.baselineThreshold !== undefined && (typeof args.baselineThreshold !== 'number' || !Number.isFinite(args.baselineThreshold) || args.baselineThreshold < 0 || args.baselineThreshold > 1_000_000_000)) throw new Error('Invalid scenario baselineThreshold.');
  if (capabilityId === 'dossier.draft_case') {
    if (args.alertIds !== undefined && (!Array.isArray(args.alertIds) || args.alertIds.length > 100 || args.alertIds.some((id) => typeof id !== 'string' || id.length > 100))) throw new Error('Invalid dossier alertIds.');
    if (args.sourceLabel !== undefined && (typeof args.sourceLabel !== 'string' || args.sourceLabel.length > 120)) throw new Error('Invalid dossier sourceLabel.');
  }
  if (capabilityId === 'evaluation.run_benchmark') {
    if (args.rows !== undefined && (typeof args.rows !== 'number' || !Number.isInteger(args.rows) || args.rows < 100 || args.rows > 25_000)) throw new Error('Invalid evaluation rows.');
    if (args.seed !== undefined && (typeof args.seed !== 'number' || !Number.isInteger(args.seed) || args.seed < 0 || args.seed > 2_147_483_647)) throw new Error('Invalid evaluation seed.');
  }
  return args;
}
