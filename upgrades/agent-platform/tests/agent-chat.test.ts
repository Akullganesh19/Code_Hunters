import assert from 'node:assert/strict';
import test from 'node:test';
import type {AgentChatInput} from '../src/agent-chat';

test('cancelling an agent chat aborts the in-flight model provider request', async () => {
  const previousBaseUrl = process.env.AGENT_MODEL_BASE_URL;
  const previousApiKey = process.env.AGENT_MODEL_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.AGENT_MODEL_BASE_URL = 'https://provider.invalid/v1';
  process.env.AGENT_MODEL_API_KEY = 'test-key-not-a-secret';

  let providerSignal: AbortSignal | undefined;
  let providerStarted!: () => void;
  const started = new Promise<void>((resolve) => { providerStarted = resolve; });
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    providerSignal = init?.signal ?? undefined;
    providerStarted();
    return new Promise<Response>((_resolve, reject) => {
      if (providerSignal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      providerSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once: true});
    });
  }) as typeof fetch;

  try {
    const {runAgentChat} = await import('../src/agent-chat');
    const input: AgentChatInput = {
      message: 'Summarize this dataset.',
      history: [],
      transactions: [{tx_id: 'cancel-test-1', sender: 'A', receiver: 'B', amount: 10, timestamp: '2025-01-01T00:00:00Z'}],
      sourceLabel: 'test dataset',
      hasGroundTruthLabels: false,
      activeScreen: 'Overview',
      options: {},
    };
    const controller = new AbortController();
    const operation = runAgentChat(input, controller.signal);
    await started;
    assert.ok(providerSignal);
    assert.equal(providerSignal.aborted, false);
    controller.abort();
    await assert.rejects(operation);
    assert.equal(providerSignal.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousBaseUrl === undefined) delete process.env.AGENT_MODEL_BASE_URL;
    else process.env.AGENT_MODEL_BASE_URL = previousBaseUrl;
    if (previousApiKey === undefined) delete process.env.AGENT_MODEL_API_KEY;
    else process.env.AGENT_MODEL_API_KEY = previousApiKey;
  }
});

test('agent tool lifecycle audit callbacks contain capability metadata but no tool data', async () => {
  const previousBaseUrl = process.env.AGENT_MODEL_BASE_URL;
  const previousApiKey = process.env.AGENT_MODEL_API_KEY;
  const previousModel = process.env.AGENT_MODEL;
  const originalFetch = globalThis.fetch;
  process.env.AGENT_MODEL_BASE_URL = 'https://provider.invalid/v1';
  process.env.AGENT_MODEL_API_KEY = 'test-key-not-a-secret';
  process.env.AGENT_MODEL = 'test-model';
  let calls = 0;
  globalThis.fetch = ((_input: RequestInfo | URL, _init?: RequestInit) => {
    calls += 1;
    const body = calls === 1
      ? {choices: [{message: {role: 'assistant', tool_calls: [{id: 'call-validate', type: 'function', function: {name: 'validateActiveDataset', arguments: '{}'}}]}, finish_reason: 'tool_calls'}]}
      : {choices: [{message: {role: 'assistant', content: 'The dataset passed validation.'}, finish_reason: 'stop'}]};
    return Promise.resolve(new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}}));
  }) as typeof fetch;

  try {
    const {runAgentChat} = await import('../src/agent-chat');
    const auditEvents: Array<Record<string, unknown>> = [];
    const input: AgentChatInput = {
      message: 'Validate the current dataset.',
      history: [],
      transactions: [{tx_id: 'sensitive-test-transaction-id', sender: 'secret-sender', receiver: 'secret-receiver', amount: 10, timestamp: '2025-01-01T00:00:00Z'}],
      sourceLabel: 'test dataset',
      hasGroundTruthLabels: false,
      activeScreen: 'Overview',
      options: {},
      recordAuditEvent: async (event) => { auditEvents.push(event); },
    };

    const result = await runAgentChat(input);
    assert.match(result.text, /passed validation/);
    assert.deepEqual(auditEvents.map((event) => event.type), ['tool_call_started', 'tool_call_completed']);
    assert.ok(auditEvents.every((event) => event.toolName === 'validateActiveDataset'));
    assert.ok(auditEvents.every((event) => event.capabilityId === 'overview.validate_dataset'));
    assert.ok(auditEvents.every((event) => event.permission === 'read'));
    const auditJson = JSON.stringify(auditEvents);
    assert.equal(auditJson.includes('sensitive-test-transaction-id'), false);
    assert.equal(auditJson.includes('secret-sender'), false);
    assert.equal(auditJson.includes('secret-receiver'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousBaseUrl === undefined) delete process.env.AGENT_MODEL_BASE_URL;
    else process.env.AGENT_MODEL_BASE_URL = previousBaseUrl;
    if (previousApiKey === undefined) delete process.env.AGENT_MODEL_API_KEY;
    else process.env.AGENT_MODEL_API_KEY = previousApiKey;
    if (previousModel === undefined) delete process.env.AGENT_MODEL;
    else process.env.AGENT_MODEL = previousModel;
  }
});
