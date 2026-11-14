import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {readFile} from 'node:fs/promises';
import {getDemoTransactions} from '@tracelayer/aml-engine';
import {createAmlCapabilityRegistry} from './capabilities/aml-capabilities';
import {InMemoryAgentRunStore} from './run-store';
import {AgentWorkflowRunner} from './workflow-runner';
import {fiveScreenReviewWorkflow} from './workflows/five-screen-review';
import {GemmaTaskAgent} from './gemma-task-agent';

const port = Number(process.env.AGENT_PORT ?? 3100);
const maxBodyBytes = 25 * 1024 * 1024;
const registry = createAmlCapabilityRegistry();
const runner = new AgentWorkflowRunner(registry, new InMemoryAgentRunStore());
runner.registerWorkflow(fiveScreenReviewWorkflow);
const gemmaTaskAgent = new GemmaTaskAgent(registry, runner);

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8'});
  response.end(JSON.stringify(body));
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {'content-type': 'text/html; charset=utf-8'});
  response.end(html);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBodyBytes) throw new Error('Request body exceeds the 25 MB limit.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

  if (request.method === 'GET' && url.pathname === '/') {
    const page = await readFile(new URL('../console/index.html', import.meta.url), 'utf8');
    sendHtml(response, 200, page);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/agent/health') {
    sendJson(response, 200, {status: 'ok', service: 'tracelayer-agent-upgrade'});
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/agent/capabilities') {
    sendJson(response, 200, {capabilities: registry.list()});
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/agent/demo-input') {
    sendJson(response, 200, {sourceLabel: 'synthetic demo data', transactions: getDemoTransactions()});
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/agent/workflows') {
    sendJson(response, 200, {workflows: runner.listWorkflows()});
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/agent/tasks') {
    try {
      const body = await readJson(request);
      if (!body || typeof body !== 'object' || !('task' in body)) {
        sendJson(response, 400, {error: 'Expected a task string and optional input fields.'});
        return;
      }
      const payload = body as {task: unknown; input?: unknown; startedBy?: string};
      if (typeof payload.task !== 'string' || !payload.task.trim()) {
        sendJson(response, 400, {error: 'Task must be a non-empty string.'});
        return;
      }
      const result = await gemmaTaskAgent.run(
        payload.task,
        payload.input ?? {},
        payload.startedBy?.trim() || 'local-user'
      );
      const status = result.run.status === 'failed' ? 422 : result.run.status === 'needs_review' ? 202 : 201;
      sendJson(response, status, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not run the Gemma agent task.';
      const status = message.includes('Gemma service unavailable') ? 503 : 400;
      sendJson(response, status, {error: message});
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/agent/runs') {
    try {
      const body = await readJson(request);
      if (!body || typeof body !== 'object' || !('workflowId' in body) || !('input' in body)) {
        sendJson(response, 400, {error: 'Expected workflowId and input fields.'});
        return;
      }

      const payload = body as {workflowId: string; input: unknown; startedBy?: string};
      const run = await runner.start(
        payload.workflowId,
        payload.input,
        payload.startedBy?.trim() || 'local-user'
      );
      const status = run.status === 'failed' ? 422 : run.status === 'needs_review' ? 202 : 201;
      sendJson(response, status, {run, events: await runner.getRunEvents(run.id)});
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start workflow.';
      sendJson(response, message.includes('25 MB limit') ? 413 : 400, {error: message});
    }
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/agent\/runs\/([^/]+)(?:\/(events))?$/);
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

server.listen(port, '127.0.0.1', () => {
  console.log(`TraceLayer agent upgrade listening on http://127.0.0.1:${port}`);
});
