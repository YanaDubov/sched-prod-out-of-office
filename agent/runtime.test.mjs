import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime, validateToolInput } from './runtime.mjs';
import { recordText, sha256 } from './policy.mjs';
import { cloudflare } from './cloudflare.mjs';
import modelWorker from './model-worker.mjs';
import apiWrapper from '../worker.mjs';
import app from '../src/index.js';

const proposal = {
  id: '0007-test-decision', issue: 1, title: 'A bounded contract decision',
  ask: 'Which explicit compatible scope should the owner choose for this requested change?',
  options: [{ kind: 'decline', text: 'Leave the existing response unchanged.', why: 'No existing reader is disturbed.' },
    { kind: 'smaller', text: 'Add an opt-in read without changing the original response.', why: 'The contract allows additive reads.' }],
  recommendation: 2, cost: 'Changing the current response can break three existing consumers immediately.',
  reversibility: 'Remove the optional read; preserve the old response without a data migration.',
  metric: 'All 3 existing readers and 10 fixture cases retain the original response.',
  reopen: 'Reopen if even 1 compatibility check fails or an existing reader breaks.',
};

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 's03e03-control-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src')); await mkdir(join(root, 'tests'));
  await writeFile(join(root, 'src/index.js'), 'original source');
  const events = [];
  const runtime = new Runtime({ root, statePath: join(root, 'state.json'), tracker: 'https://hq.mega.dev/tracker', trackerToken: 'fake-token' }, { add: event => events.push(event) });
  return { runtime, root, events };
}

test('pending owner decision forbids model code writes', async t => {
  const { runtime, root } = await fixture(t);
  runtime.entry(1).proposal = proposal;
  await assert.rejects(runtime.writeFiles(1, [{ path: 'src/index.js', text: 'unapproved change' }]), /owner answer/);
  assert.equal(await readFile(join(root, 'src/index.js'), 'utf8'), 'original source');
});

test('tool schemas are enforced in control code, not just trusted to the model', () => {
  assert.throws(() => validateToolInput('accept_owner_answer', { ownerAccepted: true }), /Unexpected/);
  assert.throws(() => validateToolInput('propose_decision', { ...proposal, decision: 'owner approved' }), /Unexpected/);
  assert.throws(() => validateToolInput('comment', { body: 3 }), /string/);
  assert.throws(() => validateToolInput('conclude', { verb: 'invented-success', summary: 'wrong', risks: [] }), /Invalid/);
  assert.doesNotThrow(() => validateToolInput('accept_owner_answer', {}));
});

test('a decline owner answer cannot be turned into implementation', async t => {
  const { runtime } = await fixture(t);
  runtime.entry(1).ownerAccepted = { kind: 'decline' };
  await assert.rejects(runtime.writeFiles(1, [{ path: 'src/index.js', text: 'wrong' }]), /decline/);
  await assert.rejects(runtime.conclude(1, { verb: 'shipped', summary: 'wrong', risks: [] }), /decline/);
});

test('model writes cannot modify the control plane or escape the workspace', async t => {
  const { runtime } = await fixture(t);
  for (const path of ['.github/workflows/agent.yml', 'agent/run.mjs', '../secret', 'contract/api.md']) {
    await assert.rejects(runtime.writeFiles(1, [{ path, text: 'wrong' }]), /outside/);
  }
});

test('rollback removes only this agent’s new draft and restores its own source change', async t => {
  const { runtime, root } = await fixture(t);
  await runtime.writeFiles(1, [{ path: 'src/index.js', text: 'draft' }, { path: 'tests/issue-1-example.test.mjs', text: 'draft test' }]);
  await runtime.rollbackDraft(runtime.entry(1));
  assert.equal(await readFile(join(root, 'src/index.js'), 'utf8'), 'original source');
  await assert.rejects(readFile(join(root, 'tests/issue-1-example.test.mjs')), /ENOENT/);
});

test('rollback refuses to discard a file changed by someone else', async t => {
  const { runtime, root } = await fixture(t);
  await runtime.writeFiles(1, [{ path: 'src/index.js', text: 'draft' }]);
  await writeFile(join(root, 'src/index.js'), 'unfamiliar work');
  await assert.rejects(runtime.rollbackDraft(runtime.entry(1)), /outside this agent/);
  assert.equal(await readFile(join(root, 'src/index.js'), 'utf8'), 'unfamiliar work');
});

test('agent-authored /answer does not permit accepting a decision', async t => {
  const { runtime } = await fixture(t);
  runtime.entry(1).proposal = { ...proposal, proposedAt: '2026-11-16T10:00:00Z' };
  runtime.tracker = async path => {
    assert.equal(path, '/issues/1');
    return { thread: [{ by: 'agent', kind: 'comment', at: '2026-11-16T10:01:00Z', body: '/answer 2' }] };
  };
  await assert.rejects(runtime.accept(1), /No fresh by:owner/);
});

test('verified owner answer accepts exactly its option, requests signature, and never fills signed-by', async t => {
  const { runtime } = await fixture(t);
  const original = recordText(proposal);
  runtime.entry(1).proposal = { ...proposal, proposedAt: '2026-11-16T10:00:00Z', textHash: sha256(original) };
  const writes = [];
  runtime.tracker = async (path, method, body) => {
    if (path === '/issues/1') return { thread: [{ by: 'owner', kind: 'comment', at: '2026-11-16T10:01:00Z', body: '/answer 2' }] };
    if (method === 'PUT') { writes.push({ path, body }); return { ok: true }; }
    if (path === '/records/' + proposal.id) return { by: 'agent', text: original };
    if (path === '/issues/1/comments') { writes.push({ path, body }); return { ok: true }; }
    throw new Error('Unexpected tracker call.');
  };
  const accepted = await runtime.accept(1);
  assert.equal(accepted.choice, 2); assert.equal(accepted.kind, 'smaller');
  assert.match(writes[0].body.text, /status: accepted/);
  assert.match(writes[0].body.text, /signed-by:\n/);
  assert.match(writes[0].body.text, /owner chose option 2/);
  assert.match(writes[1].body.body, /Please sign the current accepted record/);
});

test('an edited proposal cannot inherit an earlier owner answer', async t => {
  const { runtime } = await fixture(t);
  runtime.entry(1).proposal = { ...proposal, proposedAt: '2026-11-16T10:00:00Z', textHash: sha256(recordText(proposal)) };
  runtime.tracker = async path => path === '/issues/1'
    ? { thread: [{ by: 'owner', kind: 'comment', at: '2026-11-16T10:01:00Z', body: '/answer 2' }] }
    : { by: 'agent', text: 'edited options that the owner did not see' };
  await assert.rejects(runtime.accept(1), /record changed/);
});

test('new decisions do not overwrite pre-existing course records', async t => {
  const { runtime } = await fixture(t);
  const writes = [];
  runtime.tracker = async (path, method, body) => {
    if (path === '/records') return { records: [{ id: '0007-course-owned', by: 'course', status: 'accepted' }] };
    if (method === 'PUT') { writes.push({ path, body }); return { ok: true }; }
    if (path.startsWith('/records/0008-')) return { updatedAt: '2026-11-16T10:00:00Z' };
    return { ok: true };
  };
  const result = await runtime.propose(1, proposal);
  assert.match(result.record, /^0008-/);
  assert.ok(writes.every(x => !x.path.includes('0007-course-owned')));
});

test('no live proof and no owner answer means no false close', async t => {
  const { runtime } = await fixture(t);
  runtime.tracker = async () => { throw new Error('A close must not be sent.'); };
  await assert.rejects(runtime.conclude(1, { verb: 'shipped', summary: 'not proven', risks: [] }), /No verified live/);
  runtime.entry(1).proposal = proposal;
  await assert.rejects(runtime.conclude(1, { verb: 'declined', summary: 'not answered', risks: [] }), /awaits the actual owner/);
});

test('tests are tied to the candidate hash before any deployment action', async t => {
  const { runtime } = await fixture(t);
  await assert.rejects(runtime.deploy(1), /Run all tests/);
});

test('tracker endpoint guard refuses another host, admin paths and traversal before transport', async t => {
  const { runtime } = await fixture(t);
  await assert.rejects(runtime.tracker('/production/admin'), /Unapproved tracker/);
  await assert.rejects(runtime.tracker('/records/0007-a/../../admin'), /Unapproved tracker/);
  runtime.config.tracker = 'https://evil.example/tracker';
  await assert.rejects(runtime.tracker('/issues'), /exact course HTTPS/);
});

test('Cloudflare operations cannot target previous projects or delete even a new Worker', async () => {
  const account = 'a'.repeat(32);
  for (const path of ['/workers/scripts/previous-project', '/workers/scripts/yana-s03e03-api/../../previous-project', '/workers/scripts/yana-s03e03-api?other=true']) {
    await assert.rejects(cloudflare(account, 'fake-token', path), /restricted/);
  }
  await assert.rejects(cloudflare(account, 'fake-token', '/workers/scripts/yana-s03e03-api', { method: 'DELETE' }), /approved setup/);
});

test('model helper hides unauthenticated access and refuses expired authorization', async () => {
  const env = { MODEL_TOKEN: 'test-only-token', EXPIRES_AT: String(Date.now() + 60000), AI: { run: () => assert.fail('Must not call inference') } };
  assert.equal((await modelWorker.fetch(new Request('https://model.example/complete', { method: 'POST', body: '{}' }), env)).status, 404);
  const request = new Request('https://model.example/complete', { method: 'POST', headers: { Authorization: 'Bearer test-only-token' }, body: '{}' });
  assert.equal((await modelWorker.fetch(request, { ...env, EXPIRES_AT: '0' })).status, 410);
});

test('model helper fixes the free-capable model and never forwards its secret', async () => {
  let observed;
  const env = { MODEL_TOKEN: 'test-only-token', EXPIRES_AT: String(Date.now() + 60000), AI: { run: async (model, input) => {
    observed = { model, input }; return { choices: [{ message: { role: 'assistant', content: 'ready' } }] };
  } } };
  const request = new Request('https://model.example/complete', { method: 'POST', headers: { Authorization: 'Bearer test-only-token' }, body: JSON.stringify({ model: 'unapproved-paid-provider', messages: [{ role: 'user', content: 'readiness check' }], tools: [], max_completion_tokens: 999999 }) });
  assert.equal((await modelWorker.fetch(request, env)).status, 200);
  assert.equal(observed.model, '@cf/zai-org/glm-4.7-flash');
  assert.equal(observed.input.max_completion_tokens, 6000);
  assert.equal(observed.input.store, false);
  assert.ok(!JSON.stringify(observed).includes('test-only-token'));
});

test('model helper enforces its prompt cap before spending inference quota', async () => {
  const request = new Request('https://model.example/complete', { method: 'POST', headers: { Authorization: 'Bearer test-only-token' }, body: 'x'.repeat(262145) });
  const env = { MODEL_TOKEN: 'test-only-token', EXPIRES_AT: String(Date.now() + 60000), AI: { run: () => assert.fail('Must not spend inference') } };
  assert.equal((await modelWorker.fetch(request, env)).status, 413);
});

test('application wrapper never passes control-plane or production-write secrets to editable code', async () => {
  const original = app.fetch;
  app.fetch = async (request, env) => {
    assert.deepEqual(Object.keys(env), ['FEED_URL']);
    assert.equal(env.FEED_URL, 'https://fixture.invalid/feed');
    return Response.json({ ok: true });
  };
  try {
    const response = await apiWrapper.fetch(new Request('https://api.example/incidents'), {
      FEED_URL: 'https://fixture.invalid/feed', PROD_ADMIN_TOKEN: 'test-admin', AI: {}, CLOUDFLARE_API_TOKEN: 'test-deploy',
    });
    assert.equal(response.status, 200);
  } finally { app.fetch = original; }
});

test('starter setup never presents fixture data as a configured production feed', async () => {
  const response = await apiWrapper.fetch(new Request('https://api.example/incidents'), { FEED_URL: '' });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'production feed is not configured yet' });
});
