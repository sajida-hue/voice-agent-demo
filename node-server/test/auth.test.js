import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';
import { createApplication } from '../server.js';

const origin = 'https://sajida.example';
const password = 'test-only-long-password';
test('ElevenLabs availability is public configuration but credentials remain server-side', async t => {
  let received;
  const f = await fixture(t, { elevenlabsApiKey: 'private-eleven-key',
    relay: (_socket, options) => { received = options; } });
  const state = await fetch(f.base + '/api/session').then(r => r.json());
  assert.equal(state.surabhiAvailable, true);
  assert.ok(!JSON.stringify(state).includes('private-eleven-key'));
  const response = await f.login();
  const value = await response.json();
  assert.equal(value.surabhiAvailable, true);
  assert.ok(!JSON.stringify(value).includes('private-eleven-key'));
  const socket = f.connect(response.headers.get('set-cookie').split(';')[0]);
  await once(socket, 'open');
  assert.equal(received.elevenlabsApiKey, 'private-eleven-key');
  assert.equal(received.elevenlabsVoiceId, 'ch9J8IB6HKlEHQaWQFdk');
  socket.close();
});
async function fixture(t, options = {}) {
  let relayCalls = 0;
  const application = createApplication({ apiKey: 'offline-placeholder', password, publicOrigin: origin,
    relay: ws => { relayCalls++; ws.on('message', data => ws.send(data)); }, ...options });
  application.server.listen(0, '127.0.0.1');
  await once(application.server, 'listening');
  const base = `http://127.0.0.1:${application.server.address().port}`;
  t.after(async () => {
    for (const ws of application.wss.clients) ws.terminate();
    await new Promise(resolve => application.server.close(resolve));
  });
  const login = (supplied = password, extra = {}) => fetch(`${base}/api/login`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify({ password: supplied }),
  });
  const connect = (cookie, path = '/voice', suppliedOrigin = origin) => new WebSocket(base.replace('http:', 'ws:') + path,
    { headers: { Cookie: cookie, Origin: suppliedOrigin } });
  const reject = async (...args) => {
    const ws = connect(...args);
    const [error] = await once(ws, 'error');
    assert.match(error.message, /Unexpected server response: (401|409)/);
  };
  const signIn = async () => {
    const response = await login();
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  return { ...application, base, login, connect, reject, signIn, relayCalls: () => relayCalls };
}

test('requires explicit credentials and a canonical HTTPS origin', () => {
  for (const publicOrigin of ['https://sajida.example/', 'https://sajida.example/path', 'http://public.example']) {
    assert.throws(() => createApplication({ apiKey: 'test', password, publicOrigin }));
  }
  assert.throws(() => createApplication({ apiKey: 'test', password: 'short', publicOrigin: origin }));
});

test('login issues an HttpOnly, Secure, host-only cookie and returns no bearer token', async t => {
  const f = await fixture(t);
  const response = await f.login();
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^__Host-sajida_session=[a-f0-9]{64};/);
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/', 'Max-Age=900']) assert.ok(cookie.includes(flag));
  assert.ok(!cookie.includes('Domain='));
  assert.deepEqual(Object.keys(await response.json()).sort(), ['authenticated', 'expiresAt']);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('wrong passwords and cross-origin login/logout fail closed', async t => {
  const f = await fixture(t);
  assert.equal((await f.login('wrong')).status, 401);
  assert.equal((await f.login(password, { Origin: 'https://other.example' })).status, 403);
  const response = await fetch(`${f.base}/api/logout`, { method: 'POST' });
  assert.equal(response.status, 403);
  assert.equal(f.relayCalls(), 0);
});

test('WebSocket rejects missing/tampered cookies, foreign origins and legacy URL tokens', async t => {
  const f = await fixture(t);
  const cookie = await f.signIn();
  await f.reject('');
  await f.reject('__Host-sajida_session=' + '0'.repeat(64));
  await f.reject(cookie, '/voice', 'https://other.example');
  await f.reject(cookie, '/voice?token=old-secret');
  await f.reject(cookie, '/?token=old-secret');
  assert.equal(f.relayCalls(), 0);
});

test('valid cookie opens voice transport without URL credentials; a second voice is rejected', async t => {
  const f = await fixture(t);
  const cookie = await f.signIn();
  const ws = f.connect(cookie);
  await once(ws, 'open');
  assert.equal(f.relayCalls(), 1);
  ws.send('audio-test');
  const [data] = await once(ws, 'message');
  assert.equal(data.toString(), 'audio-test');
  await f.reject(cookie);
  ws.close();
  await once(ws, 'close');
});

test('logout closes active voice and invalidates the cookie on HTTP and WebSocket', async t => {
  const f = await fixture(t);
  const cookie = await f.signIn();
  const ws = f.connect(cookie);
  await once(ws, 'open');
  const closed = once(ws, 'close');
  const response = await fetch(`${f.base}/api/logout`, { method: 'POST', headers: { Origin: origin, Cookie: cookie } });
  assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await closed)[0], 1008);
  const state = await fetch(`${f.base}/api/session`, { headers: { Cookie: cookie } }).then(r => r.json());
  assert.equal(state.authenticated, false);
  await f.reject(cookie);
});

test('expiry closes an active connection and forbids reconnecting', async t => {
  const f = await fixture(t, { sessionTtlMs: 150 });
  const cookie = await f.signIn();
  const ws = f.connect(cookie);
  await once(ws, 'open');
  const [code, reason] = await once(ws, 'close');
  assert.equal(code, 1008);
  assert.equal(reason.toString(), 'Session expired');
  await f.reject(cookie);
});

test('a new login rotates and revokes the previous session', async t => {
  const f = await fixture(t);
  const cookie = await f.signIn();
  const response = await f.login(password, { Cookie: cookie });
  assert.notEqual(response.headers.get('set-cookie').split(';')[0], cookie);
  await f.reject(cookie);
});

test('login attempts are bounded without trusting forwarded IP addresses', async t => {
  const f = await fixture(t);
  for (let n = 0; n < 20; n++) assert.equal((await f.login('wrong', { 'X-Forwarded-For': `192.0.2.${n}` })).status, 401);
  const limited = await f.login();
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});

test('health check is public, malformed login payloads do not expose details', async t => {
  const f = await fixture(t);
  assert.deepEqual(await fetch(`${f.base}/healthz`).then(r => r.json()), { ok: true });
  const response = await fetch(`${f.base}/api/login`, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid request' });
});

test('client assets share the API origin without exposing source or environment files', async t => {
  const dir = await mkdtemp(resolve('.static-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(`${dir}/index.html`, '<title>Sajida — AI Design Assistant</title>');
  const f = await fixture(t, { distPath: dir });
  const page = await fetch(f.base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Sajida — AI Design Assistant/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(`${f.base}/server.js`)).status, 404);
  assert.equal((await fetch(`${f.base}/.env`)).status, 404);
});
