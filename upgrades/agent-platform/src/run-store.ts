import type {AgentAuditEvent, AgentRun, AgentRunEvent} from './contracts';

export interface AgentRunStore {
  create(run: AgentRun, idempotency?: {key: string; fingerprint: string}): Promise<AgentRun | null>;
  update(run: AgentRun): Promise<void>;
  appendEvent(event: AgentRunEvent): Promise<void>;
  get(runId: string): Promise<AgentRun | null>;
  list(limit: number): Promise<AgentRun[]>;
  events(runId: string): Promise<AgentRunEvent[]>;
  appendAuditEvent(event: AgentAuditEvent): Promise<void>;
  auditEvents(limit: number, sessionId?: string): Promise<AgentAuditEvent[]>;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was already used for a different workflow request.');
    this.name = 'IdempotencyConflictError';
  }
}

/** In-memory adapter for tests; the HTTP service uses the durable SQLite adapter. */
export class InMemoryAgentRunStore implements AgentRunStore {
  private readonly runs = new Map<string, AgentRun>();
  private readonly runEvents = new Map<string, AgentRunEvent[]>();
  private readonly idempotencyKeys = new Map<string, {fingerprint: string; runId: string}>();
  private readonly auditLog: AgentAuditEvent[] = [];

  async create(run: AgentRun, idempotency?: {key: string; fingerprint: string}): Promise<AgentRun | null> {
    if (idempotency) {
      const existing = this.idempotencyKeys.get(idempotency.key);
      if (existing) {
        if (existing.fingerprint !== idempotency.fingerprint) {
          throw new IdempotencyConflictError();
        }
        return this.get(existing.runId);
      }
    }
    if (this.runs.has(run.id)) throw new Error(`Run "${run.id}" already exists.`);
    this.runs.set(run.id, structuredClone(run));
    this.runEvents.set(run.id, []);
    if (idempotency) this.idempotencyKeys.set(idempotency.key, {fingerprint: idempotency.fingerprint, runId: run.id});
    return null;
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

  async list(limit: number): Promise<AgentRun[]> {
    return [...this.runs.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((run) => structuredClone(run));
  }

  async events(runId: string): Promise<AgentRunEvent[]> {
    return structuredClone(this.runEvents.get(runId) ?? []);
  }

  async appendAuditEvent(event: AgentAuditEvent): Promise<void> {
    this.auditLog.push(structuredClone(event));
  }

  async auditEvents(limit: number, sessionId?: string): Promise<AgentAuditEvent[]> {
    const events = sessionId ? this.auditLog.filter((event) => event.sessionId === sessionId) : this.auditLog;
    return structuredClone(events.slice(-Math.max(1, Math.min(1_000, Math.trunc(limit)))).reverse());
  }
}
