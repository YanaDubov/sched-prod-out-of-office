import { test } from 'node:test';
import assert from 'node:assert/strict';
import api from '../src/index.js';

// Mock fetch to return a fixture feed
const fixtureFeed = [
  {
    id: 'INC-1234',
    service: 'booking-api',
    summary: 'Calendar sync outage',
    status: 'open',
    openedAt: '2026-11-11T02:43:00.000Z'
  },
  {
    id: 'INC-5678',
    service: 'payment-gateway',
    summary: 'Payment processing delay',
    status: 'resolved',
    openedAt: '2026-11-12T03:15:00.000Z'
  },
  {
    id: 'INC-9012',
    service: 'database',
    summary: 'Connection pool exhaustion',
    status: 'open',
    openedAt: '2026-11-13T04:20:00.000Z'
  }
];

const originalFetch = globalThis.fetch;

await test('GET /incidents returns all incidents when no since parameter', async () => {
  globalThis.fetch = async () => Response.json({ incidents: fixtureFeed });
  const res = await api.fetch(
    new Request('https://fixture.invalid/incidents'),
    { FEED_URL: 'https://fixture.invalid/feed' }
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.incidents.length, 3);
  assert.deepEqual(body.incidents[0], fixtureFeed[0]);
});

await test('GET /incidents?since=2026-11-12T00:00:00.000Z returns only incidents after that time', async () => {
  globalThis.fetch = async () => Response.json({ incidents: fixtureFeed });
  const res = await api.fetch(
    new Request('https://fixture.invalid/incidents?since=2026-11-12T00:00:00.000Z'),
    { FEED_URL: 'https://fixture.invalid/feed' }
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.incidents.length, 2);
  assert.equal(body.incidents[0].id, 'INC-5678');
  assert.equal(body.incidents[1].id, 'INC-9012');
});

await test('GET /incidents?since=2026-11-14T00:00:00.000Z returns no incidents', async () => {
  globalThis.fetch = async () => Response.json({ incidents: fixtureFeed });
  const res = await api.fetch(
    new Request('https://fixture.invalid/incidents?since=2026-11-14T00:00:00.000Z'),
    { FEED_URL: 'https://fixture.invalid/feed' }
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.incidents.length, 0);
});

await test('GET /incidents?since=invalid returns 400', async () => {
  globalThis.fetch = async () => Response.json({ incidents: fixtureFeed });
  const res = await api.fetch(
    new Request('https://fixture.invalid/incidents?since=not-a-time'),
    { FEED_URL: 'https://fixture.invalid/feed' }
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.deepEqual(body, { error: 'invalid since parameter' });
});

await test('GET /incidents/{id} is unaffected by since parameter', async () => {
  globalThis.fetch = async () => Response.json({ incidents: fixtureFeed });
  const res = await api.fetch(
    new Request('https://fixture.invalid/incidents/INC-1234'),
    { FEED_URL: 'https://fixture.invalid/feed' }
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, {
    incident: {
      id: 'INC-1234',
      service: 'booking-api',
      summary: 'Calendar sync outage',
      status: 'open',
      openedAt: '2026-11-11T02:43:00.000Z'
    }
  });
});

// Restore original fetch
globalThis.fetch = originalFetch;
