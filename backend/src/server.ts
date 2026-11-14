import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {runDetectionPipeline, type DetectionPipelineOptions, type RawTransactionInput} from '@tracelayer/aml-engine';

const port = Number(process.env.PORT ?? 3001);
const maxBodyBytes = 25 * 1024 * 1024;

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8'});
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBodyBytes) {
      throw new Error('Request body exceeds the 25 MB limit.');
    }
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
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
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    response.end();
    return;
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, {status: 'ok', service: 'tracelayer-api'});
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/analyze') {
    try {
      const body = await readJson(request);
      if (!body || typeof body !== 'object' || !('transactions' in body)) {
        sendJson(response, 400, {error: 'Expected a transactions array.'});
        return;
      }

      const payload = body as {
        transactions: RawTransactionInput[];
        options?: DetectionPipelineOptions;
      };
      const result = runDetectionPipeline(payload.transactions, payload.options);
      sendJson(response, 200, {
        edges: result.edges,
        alerts: result.alerts,
        runtimeMs: result.runtimeMs,
        edgesPerSec: result.edgesPerSec,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analysis request failed.';
      const status = message.includes('25 MB limit') ? 413 : 422;
      sendJson(response, status, {error: message});
    }
    return;
  }

  sendJson(response, 404, {error: 'Route not found.'});
});

server.listen(port, '127.0.0.1', () => {
  console.log(`TraceLayer API listening on http://127.0.0.1:${port}`);
});
