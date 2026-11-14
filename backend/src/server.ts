import {Worker} from 'node:worker_threads';
import {createServer, type ServerResponse} from 'node:http';
import {MAX_TRANSACTIONS_PER_REQUEST, ValidationError, type DetectionPipelineOptions, type RawTransactionInput} from '@tracelayer/aml-engine';
import {
  configureHttpTimeouts,
  getInternalToken,
  readJsonBody,
  rejectCrossOriginMutation,
  RequestBodyTooLargeError,
  requireInternalToken,
} from '../../shared/httpSecurity';

const port = Number(process.env.PORT ?? 3001);
const maxBodyBytes = 25 * 1024 * 1024;
const maxConcurrentAnalyses = 2;
const analysisTimeoutMs = 30_000;
const internalToken = getInternalToken();
let activeAnalyses = 0;

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8'});
  response.end(JSON.stringify(body));
}

class AnalysisTimeoutError extends Error {
  constructor() {
    super('Analysis exceeded the 30 second processing limit.');
    this.name = 'AnalysisTimeoutError';
  }
}

function validateOptions(value: unknown): DetectionPipelineOptions {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('Analysis options must be an object.');
  }

  const limits: Record<string, {min: number; max: number; integer?: boolean}> = {
    K: {min: 2, max: 100, integer: true},
    WHours: {min: 1, max: 720},
    cycleWHours: {min: 1, max: 720},
    HMinutes: {min: 1, max: 1440},
    minRetention: {min: 0, max: 1},
  };
  const candidate = value as Record<string, unknown>;
  const options: DetectionPipelineOptions = {};

  for (const [key, rawValue] of Object.entries(candidate)) {
    const limit = limits[key];
    if (!limit) throw new ValidationError(`Unsupported analysis option "${key}".`);
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || rawValue < limit.min || rawValue > limit.max || (limit.integer && !Number.isInteger(rawValue))) {
      throw new ValidationError(`Analysis option "${key}" must be ${limit.integer ? 'an integer' : 'a number'} between ${limit.min} and ${limit.max}.`);
    }
    options[key as keyof DetectionPipelineOptions] = rawValue as never;
  }
  return options;
}

function runAnalysisInWorker(
  transactions: RawTransactionInput[],
  options: DetectionPipelineOptions,
  response: ServerResponse,
): Promise<{
  edges: unknown[];
  alerts: unknown[];
  runtimeMs: number;
  edgesPerSec: number;
}> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./analysis-worker.ts', import.meta.url), {
      workerData: {transactions, options},
    });
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      response.off('close', onResponseClose);
      callback();
    };
    const onResponseClose = () => {
      if (!response.writableEnded) {
        void worker.terminate();
        finish(() => reject(new Error('Client disconnected during analysis.')));
      }
    };
    const timer = setTimeout(() => {
      void worker.terminate();
      finish(() => reject(new AnalysisTimeoutError()));
    }, analysisTimeoutMs);

    response.once('close', onResponseClose);
    worker.once('message', (message: {ok: boolean; result?: {edges: unknown[]; alerts: unknown[]; runtimeMs: number; edgesPerSec: number}; name?: string; message?: string}) => {
      if (message.ok && message.result) {
        finish(() => resolve(message.result!));
      } else {
        const error = new Error(message.message ?? 'Analysis request failed.');
        error.name = message.name ?? 'Error';
        finish(() => reject(error));
      }
    });
    worker.once('error', (error) => finish(() => reject(error)));
    worker.once('exit', (code) => {
      if (!settled) finish(() => reject(new Error(`Analysis worker exited with code ${code}.`)));
    });
  });
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

  if (rejectCrossOriginMutation(request, response, allowedOrigin)) return;
  if (!requireInternalToken(request, response, internalToken)) return;

  if (request.method === 'POST' && url.pathname === '/api/analyze') {
    if (activeAnalyses >= maxConcurrentAnalyses) {
      response.setHeader('retry-after', '1');
      sendJson(response, 429, {error: 'Analysis capacity is busy. Retry shortly.'});
      return;
    }
    activeAnalyses++;
    try {
      const body = await readJsonBody(request, maxBodyBytes);
      if (!body || typeof body !== 'object' || !('transactions' in body)) {
        sendJson(response, 400, {error: 'Expected a transactions array.'});
        return;
      }

      const candidate = body as {transactions?: unknown; options?: unknown};
      if (!Array.isArray(candidate.transactions)) {
        sendJson(response, 400, {error: 'Transactions must be an array.'});
        return;
      }
      if (candidate.transactions.length > MAX_TRANSACTIONS_PER_REQUEST) {
        sendJson(response, 413, {error: `At most ${MAX_TRANSACTIONS_PER_REQUEST.toLocaleString('en-US')} transactions are allowed per request.`});
        return;
      }
      const options = validateOptions(candidate.options);
      const result = await runAnalysisInWorker(candidate.transactions as RawTransactionInput[], options, response);
      sendJson(response, 200, {
        edges: result.edges,
        alerts: result.alerts,
        runtimeMs: result.runtimeMs,
        edgesPerSec: result.edgesPerSec,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analysis request failed.';
      if (message.includes('Client disconnected')) return;
      const status = error instanceof RequestBodyTooLargeError ? 413
        : error instanceof SyntaxError ? 400
          : error instanceof AnalysisTimeoutError ? 504
            : error instanceof ValidationError || (error instanceof Error && error.name === 'ValidationError') ? 422
              : 500;
      sendJson(response, status, {error: message});
    } finally {
      activeAnalyses--;
    }
    return;
  }

  sendJson(response, 404, {error: 'Route not found.'});
});

configureHttpTimeouts(server);
server.listen(port, '127.0.0.1', () => {
  console.log(`TraceLayer API listening on http://127.0.0.1:${port}`);
});
