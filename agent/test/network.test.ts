import assert from 'node:assert/strict';
import test from 'node:test';
import { UnexpectedError } from '../../src/errors';
import { mapWikidotError } from '../src/errors';
import { hasProxyEnv } from '../src/net';

test('hasProxyEnv recognises every proxy variable', () => {
  assert.equal(hasProxyEnv({}), false);
  assert.equal(hasProxyEnv({ HTTPS_PROXY: 'http://127.0.0.1:7890' }), true);
  assert.equal(hasProxyEnv({ https_proxy: 'http://127.0.0.1:7890' }), true);
  assert.equal(hasProxyEnv({ HTTP_PROXY: 'http://127.0.0.1:7890' }), true);
  assert.equal(hasProxyEnv({ ALL_PROXY: 'socks5://127.0.0.1:7890' }), true);
});

test('a bare fetch failure gets the proxy hint', () => {
  const error = new Error('fetch failed');
  (error as Error & { cause?: unknown }).cause = Object.assign(new Error('connect timeout'), {
    code: 'UND_ERR_CONNECT_TIMEOUT',
  });
  const mapped = mapWikidotError(error, 'Fetching site "scp-wiki"');
  assert.match(mapped.message, /UND_ERR_CONNECT_TIMEOUT/);
  assert.match(mapped.toDisplay(), /HTTPS_PROXY/);
});

test('a library-wrapped fetch failure still gets the hint', () => {
  const mapped = mapWikidotError(
    new UnexpectedError('Failed to get site: TypeError: fetch failed'),
    'Fetching site "scp-wiki"'
  );
  assert.match(mapped.toDisplay(), /HTTPS_PROXY/);
});

test('unrelated errors do not get the proxy hint', () => {
  const mapped = mapWikidotError(new Error('something else broke'), 'x');
  assert.equal(mapped.hint, null);
});
