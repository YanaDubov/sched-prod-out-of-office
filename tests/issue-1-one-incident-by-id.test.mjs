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
  }
];

const originalFetch = globalThis.fetch;

await test('GET /incidents/{id} returns the incident when it exists', async () => {
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

await test('GET /incidents/{id} returns 404 when incident does not exist', async () => {
  globalThis.fetch = async () => Response.json({ incidents: fixtureFeed });
  const res = await api.fetch(
    new Request('https://fixture.invalid/incidents/INC-9999'),
    { FEED_URL: 'https://fixture.invalid/feed' }
  );
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.deepEqual(body, { error: 'not found' });
});

await test('GET /incidents/{id} returns the second incident when requested', async () => {
  globalThis.fetch = async () => Response.json({ incidents: fixtureFeed });
  const res = await api.fetch(
    new Request('https://fixture.invalid/incidents/INC-5678'),
    { FEED_URL: 'https://fixture.invalid/feed' }
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, {
    incident: {
      id: 'INC-5678',
      service: 'payment-gateway',
      summary: 'Payment processing delay',
      status: 'resolved',
      openedAt: '2026-11-12T03:15:00.000Z'
    }
  });
});

// Restore original fetch
globalThis.fetch = originalFetch;
