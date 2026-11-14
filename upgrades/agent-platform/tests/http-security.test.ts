import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getInternalToken,
  isCrossOriginMutation,
  isValidInternalToken,
} from '../../../shared/httpSecurity.ts';

test('production refuses to start without a strong internal token', () => {
  assert.throws(() => getInternalToken({NODE_ENV: 'production'}), /TRACELAYER_INTERNAL_TOKEN/);
  assert.throws(
    () => getInternalToken({NODE_ENV: 'production', TRACELAYER_INTERNAL_TOKEN: 'short'}),
    /at least 32 characters/,
  );
  assert.equal(getInternalToken({NODE_ENV: 'production', TRACELAYER_INTERNAL_TOKEN: 'a'.repeat(32)}), 'a'.repeat(32));
});

test('internal token comparison accepts only the exact configured token', () => {
  assert.equal(isValidInternalToken('a'.repeat(32), 'a'.repeat(32)), true);
  assert.equal(isValidInternalToken('b'.repeat(32), 'a'.repeat(32)), false);
  assert.equal(isValidInternalToken(undefined, 'a'.repeat(32)), false);
  assert.equal(isValidInternalToken('anything', undefined), true);
});

test('browser mutations must come from the configured origin', () => {
  assert.equal(isCrossOriginMutation('POST', 'https://evil.invalid', 'cross-site', 'http://127.0.0.1:3000'), true);
  assert.equal(isCrossOriginMutation('POST', 'http://127.0.0.1:3000', 'same-origin', 'http://127.0.0.1:3000'), false);
  assert.equal(isCrossOriginMutation('GET', 'https://evil.invalid', 'cross-site', 'http://127.0.0.1:3000'), false);
  assert.equal(isCrossOriginMutation('POST', undefined, undefined, 'http://127.0.0.1:3000'), false);
});
