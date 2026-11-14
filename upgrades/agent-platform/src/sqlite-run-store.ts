import {randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import initSqlJs, {type Database} from 'sql.js';
import type {AgentRun, AgentRunEvent} from './contracts';
import type {AgentRunStore} from './run-store';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm') as string;

function redactRun(run: AgentRun): AgentRun {
  const outputs = Object.fromEntries(Object.entries(run.outputs).map(([step, output]) => {
    const value = output && typeof output === 'object' ? output as Record<string, unknown> : {};
    if (step === 'overview') {
      return [step, {
        redacted: true,
        transactionCount: Number(value.transactionCount ?? (Array.isArray(value.edges) ? value.edges.length : 0)),
        alertCount: Number(value.alertCount ?? (Array.isArray(value.alerts) ? value.alerts.length : 0)),
      }];
    }
    if (step === 'investigation') {
      return [step, {
        redacted: true,
        evidenceTransactionCount: Number(value.evidenceTransactionCount ?? (Array.isArray(value.combinedEdges) ? value.combinedEdges.length : 0)),
      }];
    }
    if (step === 'adversarial_lab') {
      return [step, {
        redacted: true,
        graphCaughtCount: Number(value.graphCaughtCount ?? 0),
        baselineCaughtCount: Number(value.baselineCaughtCount ?? 0),
        totalInjected: Number(value.totalInjected ?? 0),
      }];
    }
    if (step === 'evaluation') {
      return [step, {
        redacted: true,
        trainRows: Number(value.trainRows ?? 0),
        testRows: Number(value.testRows ?? 0),
        seed: Number(value.seed ?? 0),
      }];
    }
    if (step === 'sar_dossier') {
      return [step, {redacted: true, draftReady: Boolean(value.draftReady ?? value.dossier)}];
    }
    return [step, {redacted: true, resultAvailable: output !== undefined}];
  }));

  return {
    ...run,
    startedBy: 'unattributed-local-session',
    outputs,
    ...(run.error ? {
      error: run.error.includes('agent service restarted before this workflow finished')
        ? 'The agent service restarted before this workflow finished.'
        : 'Workflow failed. Review the request and service logs.',
    } : {}),
  };
}

function redactEvent(event: AgentRunEvent): AgentRunEvent {
  return {
    ...event,
    ...(event.type === 'run_failed' ? {detail: 'Workflow failed. Review the request and service logs.'} : {}),
  };
}

function parseJson<T>(value: unknown): T {
  if (typeof value !== 'string') throw new Error('Agent run database contains an invalid record.');
  return JSON.parse(value) as T;
}

export class SqliteAgentRunStore implements AgentRunStore {
  private persistQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly database: Database,
    private readonly filePath: string,
    private readonly retentionLimit: number,
  ) {}

  static async open(filePath: string, retentionLimit = 1_000): Promise<SqliteAgentRunStore> {
    if (!Number.isInteger(retentionLimit) || retentionLimit < 1 || retentionLimit > 100_000) {
      throw new Error('Agent run retention count must be an integer between 1 and 100,000.');
    }
    const SQL = await initSqlJs({locateFile: () => wasmPath});
    let database: Database;
    try {
      const bytes = await readFile(filePath);
      database = new SQL.Database(bytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      database = new SQL.Database();
    }

    const store = new SqliteAgentRunStore(database, path.resolve(filePath), retentionLimit);
    database.run(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS agent_runs (
        run_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_run_events (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
        timestamp TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_run_events_run_time
        ON agent_run_events(run_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_created
        ON agent_runs(created_at DESC);
    `);
    await store.recoverInterruptedRuns();
    await store.persist();
    return store;
  }

  async create(run: AgentRun): Promise<void> {
    this.database.run(
      'INSERT INTO agent_runs (run_id, created_at, updated_at, payload) VALUES (?, ?, ?, ?)',
      [run.id, run.createdAt, run.updatedAt, JSON.stringify(redactRun(run))],
    );
    this.database.run(
      `DELETE FROM agent_runs
       WHERE run_id IN (
         SELECT run_id FROM agent_runs
         ORDER BY created_at DESC, run_id DESC
         LIMIT -1 OFFSET ?
       )`,
      [this.retentionLimit],
    );
    await this.persist();
  }

  async update(run: AgentRun): Promise<void> {
    this.database.run(
      'UPDATE agent_runs SET updated_at = ?, payload = ? WHERE run_id = ?',
      [run.updatedAt, JSON.stringify(redactRun(run)), run.id],
    );
    if (this.database.getRowsModified() === 0) throw new Error(`Run "${run.id}" was not found.`);
    await this.persist();
  }

  async appendEvent(event: AgentRunEvent): Promise<void> {
    this.database.run(
      'INSERT INTO agent_run_events (event_id, run_id, timestamp, payload) VALUES (?, ?, ?, ?)',
      [event.id, event.runId, event.timestamp, JSON.stringify(redactEvent(event))],
    );
    await this.persist();
  }

  async get(runId: string): Promise<AgentRun | null> {
    const result = this.database.exec('SELECT payload FROM agent_runs WHERE run_id = ?', [runId]);
    const payload = result[0]?.values[0]?.[0];
    return payload === undefined ? null : parseJson<AgentRun>(payload);
  }

  async list(limit: number): Promise<AgentRun[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const result = this.database.exec(
      'SELECT payload FROM agent_runs ORDER BY updated_at DESC, run_id DESC LIMIT ?',
      [safeLimit],
    );
    return (result[0]?.values ?? []).map(([payload]) => parseJson<AgentRun>(payload));
  }

  async events(runId: string): Promise<AgentRunEvent[]> {
    const result = this.database.exec(
      'SELECT payload FROM agent_run_events WHERE run_id = ? ORDER BY timestamp, event_id',
      [runId],
    );
    return (result[0]?.values ?? []).map(([payload]) => parseJson<AgentRunEvent>(payload));
  }

  async close(): Promise<void> {
    await this.persist();
    this.database.close();
  }

  private async recoverInterruptedRuns(): Promise<void> {
    const result = this.database.exec('SELECT run_id, payload FROM agent_runs');
    const now = new Date().toISOString();
    for (const [runIdValue, payloadValue] of result[0]?.values ?? []) {
      const runId = String(runIdValue);
      const run = parseJson<AgentRun>(payloadValue);
      if (run.status !== 'running' && run.status !== 'queued') continue;
      run.status = 'failed';
      run.error = 'The agent service restarted before this workflow finished.';
      run.updatedAt = now;
      this.database.run(
        'UPDATE agent_runs SET updated_at = ?, payload = ? WHERE run_id = ?',
        [now, JSON.stringify(redactRun(run)), runId],
      );
      const eventId = randomUUID();
      this.database.run(
        'INSERT INTO agent_run_events (event_id, run_id, timestamp, payload) VALUES (?, ?, ?, ?)',
        [eventId, runId, now, JSON.stringify({
          id: eventId,
          runId,
          type: 'run_failed',
          timestamp: now,
          detail: 'The agent service restarted before this workflow finished.',
        } satisfies AgentRunEvent)],
      );
    }
  }

  private persist(): Promise<void> {
    const write = this.persistQueue.then(async () => {
      const directory = path.dirname(this.filePath);
      await mkdir(directory, {recursive: true});
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, this.database.export(), {mode: 0o600});
        await rename(temporaryPath, this.filePath);
      } catch (error) {
        await rm(temporaryPath, {force: true});
        throw error;
      }
    });
    this.persistQueue = write.catch(() => undefined);
    return write;
  }
}

export {redactRun};
