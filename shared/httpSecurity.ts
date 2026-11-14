import {timingSafeEqual} from 'node:crypto';
import type {IncomingMessage, Server, ServerResponse} from 'node:http';

export const INTERNAL_TOKEN_HEADER = 'x-tracelayer-internal-token';

export class RequestBodyTooLargeError extends Error {
  constructor(limitBytes: number) {
    super(`Request body exceeds the ${Math.floor(limitBytes / (1024 * 1024))} MB limit.`);
    this.name = 'RequestBodyTooLargeError';
  }
}

export function getInternalToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = env.TRACELAYER_INTERNAL_TOKEN?.trim();
  if (env.NODE_ENV === 'production' && (!token || token.length < 32)) {
    throw new Error('Production requires a TRACELAYER_INTERNAL_TOKEN of at least 32 characters.');
  }
  if (token && token.length < 32) {
    throw new Error('TRACELAYER_INTERNAL_TOKEN must be at least 32 characters.');
  }
  return token || undefined;
}

export function isValidInternalToken(provided: string | undefined, expected: string | undefined): boolean {
  if (!expected) return true;
  if (!provided) return false;
  const providedBytes = Buffer.from(provided, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

export function isCrossOriginMutation(
  method: string | undefined,
  origin: string | undefined,
  fetchSite: string | undefined,
  allowedOrigin: string,
): boolean {
  if (!method || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) return false;
  if (fetchSite?.toLowerCase() === 'cross-site') return true;
  return origin !== undefined && origin !== allowedOrigin;
}

export function rejectCrossOriginMutation(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigin: string,
): boolean {
  if (!isCrossOriginMutation(
    request.method,
    request.headers.origin,
    request.headers['sec-fetch-site'],
    allowedOrigin,
  )) return false;

  sendJson(response, 403, {error: 'Cross-origin requests are not allowed.'});
  return true;
}

export function requireInternalToken(
  request: IncomingMessage,
  response: ServerResponse,
  expected: string | undefined,
): boolean {
  if (!expected) return true;
  const provided = request.headers[INTERNAL_TOKEN_HEADER];
  if (typeof provided === 'string' && isValidInternalToken(provided, expected)) return true;

  response.setHeader('www-authenticate', 'Bearer realm="TraceLayer internal API"');
  response.setHeader('cache-control', 'no-store');
  sendJson(response, 401, {error: 'Authentication required.'});
  return false;
}

export async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyTooLargeError(maxBytes);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) throw new RequestBodyTooLargeError(maxBytes);
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function configureHttpTimeouts(server: Server): void {
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8'});
  response.end(JSON.stringify(body));
}
