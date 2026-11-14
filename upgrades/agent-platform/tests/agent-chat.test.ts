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
