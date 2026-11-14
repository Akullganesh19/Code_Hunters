import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
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
    sendHtml(response, 200, `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TraceLayer Agent API</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #0d1511; color: #edf4ef; }
    body { margin: 0; padding: 48px 20px; }
    main { max-width: 720px; margin: 0 auto; }
    h1 { margin: 0 0 8px; font-size: 32px; }
    p, li { color: #a7b5ac; line-height: 1.6; }
    .status { display: inline-flex; gap: 9px; align-items: center; border: 1px solid #24543a; border-radius: 999px; padding: 7px 12px; color: #9de4b3; background: #10251a; font-size: 13px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #52d27b; }
    section { margin-top: 28px; padding: 20px; border: 1px solid #26352c; border-radius: 14px; background: #121d16; }
    a { color: #a8d8b4; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { color: #d9eadf; }
    pre { overflow-x: auto; padding: 14px; border-radius: 9px; background: #09100c; color: #d9eadf; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>TraceLayer Agent API</h1>
    <p>The isolated upgrade service is running. This is its API landing page; the judge/demo frontend remains on its own port.</p>
    <span class="status"><span class="dot"></span>API available on localhost</span>
    <section>
      <h2>Endpoints</h2>
      <ul>
        <li><a href="/api/agent/health">Health</a></li>
        <li><a href="/api/agent/capabilities">Registered screen capabilities</a></li>
        <li><a href="/api/agent/workflows">Registered workflows</a></li>
        <li><code>POST /api/agent/tasks</code> — plan and execute a model-selected task</li>
        <li><code>POST /api/agent/runs</code> — execute the deterministic five-screen workflow</li>
      </ul>
    </section>
    <section>
      <h2>Model setup</h2>
      <p>Model-driven tasks need the fine-tuned Gemma adapter loaded by the local model service. Until that is running, <code>POST /api/agent/tasks</code> returns a service-unavailable response.</p>
      <p>See <a href="https://github.com/Akullganesh19/Code_Hunters/tree/main/upgrades/gemma-agent">the Gemma setup guide</a>.</p>
    </section>
  </main>
</body>
</html>`);
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
