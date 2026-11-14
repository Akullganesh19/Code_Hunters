import type {AgentRun, AgentRunEvent} from './contracts';

export interface AgentRunStore {
  create(run: AgentRun): Promise<void>;
  update(run: AgentRun): Promise<void>;
  appendEvent(event: AgentRunEvent): Promise<void>;
  get(runId: string): Promise<AgentRun | null>;
  events(runId: string): Promise<AgentRunEvent[]>;
}

/** In-memory adapter for local prototyping; replace with a durable store before deployment. */
export class InMemoryAgentRunStore implements AgentRunStore {
  private readonly runs = new Map<string, AgentRun>();
  private readonly runEvents = new Map<string, AgentRunEvent[]>();

  async create(run: AgentRun): Promise<void> {
    if (this.runs.has(run.id)) throw new Error(`Run "${run.id}" already exists.`);
    this.runs.set(run.id, structuredClone(run));
    this.runEvents.set(run.id, []);
  }

  async update(run: AgentRun): Promise<void> {
    if (!this.runs.has(run.id)) throw new Error(`Run "${run.id}" was not found.`);
    this.runs.set(run.id, structuredClone(run));
  }

  async appendEvent(event: AgentRunEvent): Promise<void> {
    const events = this.runEvents.get(event.runId);
    if (!events) throw new Error(`Run "${event.runId}" was not found.`);
    events.push(structuredClone(event));
  }

  async get(runId: string): Promise<AgentRun | null> {
    const run = this.runs.get(runId);
    return run ? structuredClone(run) : null;
  }

  async events(runId: string): Promise<AgentRunEvent[]> {
    return structuredClone(this.runEvents.get(runId) ?? []);
  }
}
