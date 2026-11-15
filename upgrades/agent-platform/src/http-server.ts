import {createServer, type ServerResponse} from 'node:http';
import {createHash, randomUUID} from 'node:crypto';
import path from 'node:path';
import {createAmlCapabilityRegistry} from './capabilities/aml-capabilities';
import {redactRun, SqliteAgentRunStore} from './sqlite-run-store';
import {AgentWorkflowRunner} from './workflow-runner';
import {IdempotencyConflictError} from './run-store';
import {fiveScreenReviewWorkflow} from './workflows/five-screen-review';
import {runAgentChat} from './agent-chat';
import type {AgentAuditEvent} from './contracts';
import {APICallError} from 'ai';
import {z} from 'zod';
import {MAX_TRANSACTIONS_PER_REQUEST, validateTransactions} from '@tracelayer/aml-engine';
import {
  configureHttpTimeouts,
  getInternalToken,
  readJsonBody,
  rejectCrossOriginMutation,
  RequestBodyTooLargeError,
  requireInternalToken,
} from '../../../shared/httpSecurity';

const port = Number(process.env.AGENT_PORT ?? process.env.PORT ?? 3100);
const host = process.env.HOST ?? '127.0.0.1';
const maxBodyBytes = 25 * 1024 * 1024;
const maxConcurrentAgentRequests = 2;
const internalToken = getInternalToken();
let activeAgentRequests = 0;
const registry = createAmlCapabilityRegistry();
let runStore: SqliteAgentRunStore | undefined;
let runner: AgentWorkflowRunner;

const transactionSchema = z.object({
  tx_id: z.union([z.string(), z.number()]),
  sender: z.union([z.string(), z.number()]),
  receiver: z.union([z.string(), z.number()]),
  amount: z.union([z.string(), z.number()]),
  timestamp: z.union([z.string(), z.number()]),
  is_laundering: z.number().optional(),
  ring_id: z.string().optional(),
  typology_label: z.string().optional(),
});

const optionsSchema = z.object({
  K: z.number().int().min(2).max(100).optional(),
  WHours: z.number().min(1).max(720).optional(),
  cycleWHours: z.number().min(1).max(720).optional(),
  HMinutes: z.number().min(1).max(1440).optional(),
  minRetention: z.number().min(0).max(1).optional(),
}).strict();

const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4_000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(4_000),
  })).max(10).default([]),
  transactions: z.array(transactionSchema).max(MAX_TRANSACTIONS_PER_REQUEST),
  sourceLabel: z.string().max(200).default('current dataset'),
  hasGroundTruthLabels: z.boolean().default(false),
  activeScreen: z.enum(['Overview', 'Investigation', 'Adversarial Lab', 'SAR Case Dossier', 'Evaluation']),
  options: optionsSchema.default({}),
}).strict();

const runRequestSchema = z.object({
  workflowId: z.literal('aml.five_screen_review'),
  input: z.object({
    transactions: z.array(transactionSchema).max(MAX_TRANSACTIONS_PER_REQUEST),
    sourceLabel: z.string().max(200).optional(),
    benchmarkRows: z.number().int().min(100).max(25_000).optional(),
    seed: z.number().int().min(1).max(99_999).optional(),
  }).strict(),
}).strict();

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8'});
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  const allowedOrigin = process.env.CORS_ORIGIN ?? 'http://127.0.0.1:3000';
  if (origin === allowedOrigin) {
    response.setHeader('access-control-allow-origin', allowedOrigin);
    response.setHeader('vary', 'Origin');
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-methods': 'DELETE,GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,idempotency-key',
    });
    response.end();
    return;
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

  if (request.method === 'GET' && url.pathname === '/api/agent/health') {
    sendJson(response, 200, {status: 'ok', service: 'tracelayer-agent-upgrade'});
    return;
  }

  if (rejectCrossOriginMutation(request, response, allowedOrigin)) return;
  if (!requireInternalToken(request, response, internalToken)) return;

  if (request.method === 'GET' && url.pathname === '/api/agent/capabilities') {
    sendJson(response, 200, {capabilities: registry.list()});
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/agent/audit') {
    const rawLimit = url.searchParams.get('limit');
    const limit = rawLimit === null ? 100 : Number(rawLimit);
    const sessionId = url.searchParams.get('sessionId') ?? undefined;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000 || (sessionId !== undefined && !/^[0-9a-f-]{36}$/i.test(sessionId))) {
      sendJson(response, 400, {error: 'Audit limit must be 1 to 1,000 and sessionId must be a UUID.'});
      return;
    }
    sendJson(response, 200, {events: await runStore!.auditEvents(limit, sessionId)});
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/agent/workflows') {
    sendJson(response, 200, {workflows: runner.listWorkflows()});
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/agent/runs') {
    const rawLimit = url.searchParams.get('limit');
    const limit = rawLimit === null ? 20 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      sendJson(response, 400, {error: 'Run history limit must be an integer from 1 to 100.'});
      return;
    }
    sendJson(response, 200, {runs: await runner.listRuns(limit)});
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/agent/chat') {
    if (activeAgentRequests >= maxConcurrentAgentRequests) {
      response.setHeader('retry-after', '2');
      sendJson(response, 429, {error: 'Agent capacity is busy. Retry shortly.'});
      return;
    }
    activeAgentRequests++;
    const abortController = new AbortController();
    const abortWhenDisconnected = () => {
      if (!response.writableEnded && !abortController.signal.aborted) {
        abortController.abort(new Error('Analyst disconnected before the agent finished.'));
      }
    };
    request.once('aborted', abortWhenDisconnected);
    response.once('close', abortWhenDisconnected);
    try {
      const parsed = chatRequestSchema.safeParse(await readJsonBody(request, maxBodyBytes));
      if (!parsed.success) {
        sendJson(response, 400, {error: parsed.error.issues[0]?.message ?? 'Invalid agent chat request.'});
        return;
      }
      const auditSessionId = randomUUID();
      const recordAuditEvent = async (event: Omit<AgentAuditEvent, 'id' | 'sessionId' | 'timestamp' | 'actor' | 'screen'>) => {
        await runStore!.appendAuditEvent({
          ...event,
          id: randomUUID(),
          sessionId: auditSessionId,
          timestamp: new Date().toISOString(),
          actor: 'unattributed-local-session',
          screen: parsed.data.activeScreen,
        });
      };
      await recordAuditEvent({type: 'chat_started'});
      try {
        const result = await runAgentChat({...parsed.data, recordAuditEvent}, abortController.signal);
        for (const action of result.pendingActions) {
          await recordAuditEvent({type: 'analyst_action_proposed', actionType: action.type});
        }
        await recordAuditEvent({type: 'chat_completed'});
        if (!abortController.signal.aborted && !response.destroyed) sendJson(response, 200, {...result, auditSessionId});
      } catch (error) {
        try {
          await recordAuditEvent({type: abortController.signal.aborted ? 'chat_cancelled' : 'chat_failed', outcome: 'error'});
        } catch {
          console.error('[agent-audit] failed to persist chat outcome');
        }
        throw error;
      }
    } catch (error) {
      if (abortController.signal.aborted || response.destroyed) return;
      console.error(`[agent-chat] ${error instanceof Error ? error.name : 'Error'}`);
      const rateLimited = APICallError.isInstance(error) && error.statusCode === 429;
      if (rateLimited) response.setHeader('retry-after', error.responseHeaders?.['retry-after'] ?? '2');
      const status = error instanceof RequestBodyTooLargeError ? 413
        : error instanceof SyntaxError ? 400
          : error instanceof Error && error.name === 'ValidationError' ? 422
            : rateLimited ? 429 : 502;
      sendJson(response, status, {
        error: status === 413
          ? 'Request body exceeds the 25 MB limit.'
          : status === 400
            ? 'Invalid JSON request body.'
            : status === 422
              ? 'The transaction data failed validation.'
              : status === 429
                ? 'The configured agent provider is rate-limiting requests. Retry shortly.'
                : 'The configured agent model provider could not complete the request. Check the provider endpoint, model, credentials, and availability.',
      });
    } finally {
      request.off('aborted', abortWhenDisconnected);
      response.off('close', abortWhenDisconnected);
      activeAgentRequests--;
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/agent/runs') {
    if (activeAgentRequests >= maxConcurrentAgentRequests) {
      response.setHeader('retry-after', '2');
      sendJson(response, 429, {error: 'Agent capacity is busy. Retry shortly.'});
      return;
    }
    activeAgentRequests++;
    try {
      const parsed = runRequestSchema.safeParse(await readJsonBody(request, maxBodyBytes));
      if (!parsed.success) {
        sendJson(response, 400, {error: parsed.error.issues[0]?.message ?? 'Invalid workflow request.'});
        return;
      }

      const payload = parsed.data;
      validateTransactions(payload.input.transactions);
      const idempotencyHeader = request.headers['idempotency-key'];
      if (Array.isArray(idempotencyHeader) || (idempotencyHeader !== undefined && !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyHeader))) {
        sendJson(response, 400, {error: 'Idempotency-Key must be 8 to 128 letters, numbers, periods, underscores, colons, or hyphens.'});
        return;
      }
      const idempotency = typeof idempotencyHeader === 'string' ? {
        key: idempotencyHeader,
        fingerprint: createHash('sha256').update(JSON.stringify({workflowId: payload.workflowId, input: payload.input})).digest('hex'),
      } : undefined;
      const run = await runner.enqueue(
        payload.workflowId,
        payload.input,
        'unattributed-local-session',
        idempotency,
      );
      const status = run.status === 'queued' || run.status === 'running' ? 202 : 200;
      sendJson(response, status, {run: redactRun(run), events: await runner.getRunEvents(run.id)});
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        sendJson(response, 409, {error: error.message});
        return;
      }
      const message = error instanceof Error ? error.message : 'Could not start workflow.';
      const status = error instanceof RequestBodyTooLargeError ? 413 : error instanceof SyntaxError ? 400 : 422;
      sendJson(response, status, {error: status === 413 ? 'Request body exceeds the 25 MB limit.' : status === 400 ? 'Invalid JSON request body.' : message});
    } finally {
      activeAgentRequests--;
    }
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/agent\/runs\/([^/]+)(?:\/(events))?$/);
  if (request.method === 'DELETE' && runMatch && !runMatch[2]) {
    const runId = decodeURIComponent(runMatch[1]);
    const run = await runner.cancel(runId);
    sendJson(response, run ? 200 : 404, run ? {run: redactRun(run)} : {error: 'Run not found.'});
    return;
  }

  if (request.method === 'GET' && runMatch) {
    const runId = decodeURIComponent(runMatch[1]);
    if (runMatch[2] === 'events') {
      sendJson(response, 200, {events: await runner.getRunEvents(runId)});
      return;
    }
    const run = await runner.getRun(runId);
    sendJson(response, run ? 200 : 404, run ? {run} : {error: 'Run not found.'});
    return;
  }

  sendJson(response, 404, {error: 'Route not found.'});
});

configureHttpTimeouts(server);

async function startServer(): Promise<void> {
  const databasePath = path.resolve(process.env.AGENT_RUNS_DB_PATH ?? '../../data/agent-runs.sqlite');
  const retentionLimit = Number(process.env.AGENT_RUN_RETENTION_COUNT ?? 1_000);
  runStore = await SqliteAgentRunStore.open(databasePath, retentionLimit);
  runner = new AgentWorkflowRunner(registry, runStore);
  runner.registerWorkflow(fiveScreenReviewWorkflow);
  server.listen(port, host, () => {
    console.log(`TraceLayer agent upgrade listening on http://${host}:${port}`);
  });
}

async function shutdown(): Promise<void> {
  if (!server.listening) {
    await runStore?.close();
    return;
  }
  server.close(() => {
    void runStore?.close().catch((error: unknown) => {
      console.error(`[agent-store] close failed: ${error instanceof Error ? error.name : 'Error'}`);
      process.exitCode = 1;
    });
  });
}

process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });

void startServer().catch((error: unknown) => {
  console.error(`[agent-startup] ${error instanceof Error ? error.message : 'Could not initialize the agent service.'}`);
  process.exitCode = 1;
});
