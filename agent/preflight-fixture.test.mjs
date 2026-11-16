// Trusted rehearsal check, run only against a throwaway workspace, never production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import api from '../src/index.js';

test('the throwaway rehearsal endpoint is actually implemented without accessing production', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = () => assert.fail('The rehearsal endpoint must not fetch production.');
  try {
    const response = await api.fetch(new Request('https://fixture.invalid/__s03e03_preflight_only__'), { FEED_URL: 'https://fixture.invalid/incidents' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ready: true });
  } finally { globalThis.fetch = old; }
});
