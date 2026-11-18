import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import WebSocket, { WebSocketServer } from 'ws';
import { createApplication } from '../server.js';
import { attachRelay } from '../relay.js';

const origin = 'https://sajida.example';
const password = 'offline-long-test-password';
const group = '11111111-1111-4111-8111-111111111111';
const botId = '22222222-2222-4222-8222-222222222222';
const meetingUrl = 'https://meet.google.com/abc-defg-hij';
async function fixture(t, options = {}) {
  let calls = 0;
  const app = createApplication({ apiKey: 'private-openai', elevenlabsApiKey: 'private-eleven',
    password, publicOrigin: origin, googleLoginGroupId: group,
    relay: ws => { calls++; ws.on('message', data => ws.send(data)); }, ...options });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    app.meet.close();
    for (const ws of app.wss.clients) ws.terminate();
    await new Promise(resolve => app.server.close(resolve));
  });
  const post = (path, body = {}, cookie = '', suppliedOrigin = origin) => fetch(base + path, {
    method: 'POST', headers: { Origin: suppliedOrigin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const login = await post('/api/login', { password });
  const owner = login.headers.get('set-cookie').split(';')[0];
  const prepare = (body = { meetingUrl, voice: 'surabhi' }) => post('/api/meet', body, owner);
  const getTicket = data => data.command.match(/#ticket=([a-f0-9]{64})/)[1];
  const activate = data => post('/api/meet/activate', { ticket: getTicket(data) });
  const connect = (cookie, path = '/meet/voice', suppliedOrigin = origin) => new WebSocket(base.replace('http:', 'ws:') + path,
    { headers: { Cookie: cookie, Origin: suppliedOrigin } });
  const reject = async (...args) => {
    const ws = connect(...args);
    const [error] = await once(ws, 'error');
    assert.match(error.message, /Unexpected server response: (401|409)/);
  };
  return { ...app, base, owner, post, prepare, activate, getTicket, connect, reject, calls: () => calls };
}

test('Meet needs operator authentication and exact origin; only normal Meet URLs are accepted', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('/api/meet', { meetingUrl })).status, 401);
  assert.equal((await f.post('/api/meet', { meetingUrl }, f.owner, 'https://other.example')).status, 403);
  for (const url of ['http://meet.google.com/abc-defg-hij', 'https://meet.google.com.evil/abc-defg-hij',
    'https://user:pass@meet.google.com/abc-defg-hij', meetingUrl + '?x=secret', 'http://127.0.0.1/private']) {
    assert.equal((await f.prepare({ meetingUrl: url })).status, 400);
  }
  assert.equal(f.calls(), 0);
});

test('manual request enables live meeting input with zero media retention and a one-use capability', async t => {
  const f = await fixture(t);
  const response = await f.prepare();
  assert.equal(response.status, 201);
  const data = await response.json();
  execFileSync('bash', ['-n'], { input: data.command });
  const payload = JSON.parse(data.command.match(/--data-raw '([\s\S]+)'\n\)/)[1]);
  assert.equal(payload.meeting_url, meetingUrl);
  assert.deepEqual(payload.google_meet, { google_login_group_id: group });
  // recording_config:null prevents Output Media from receiving meeting audio.
  // retention:null keeps live capture enabled without storing recording media.
  assert.deepEqual(payload.recording_config, { retention: null });
  assert.equal(payload.automatic_leave.in_call_not_recording_timeout, 900);
  assert.equal(payload.output_media.camera.kind, 'webpage');
  const url = new URL(payload.output_media.camera.config.url);
  assert.equal(url.pathname, '/meet/agent'); assert.equal(url.search, ''); assert.ok(url.hash.startsWith('#ticket='));
  for (const secret of ['private-openai', 'private-eleven']) assert.ok(!JSON.stringify(data).includes(secret));
  assert.equal(f.calls(), 0);
  assert.equal((await f.prepare()).status, 409);
});

test('only the bot capability can open meeting voice; its cookie cannot impersonate the operator', async t => {
  const f = await fixture(t);
  const data = await (await f.prepare()).json();
  assert.equal((await f.post('/api/meet/activate', { ticket: f.getTicket(data) }, '', 'https://other.example')).status, 403);
  assert.equal((await f.post('/api/meet/activate', { ticket: '0'.repeat(64) })).status, 401);
  const claimed = await f.activate(data);
  assert.equal(claimed.status, 200);
  const cookie = claimed.headers.get('set-cookie');
  assert.match(cookie, /^__Host-sajida_meet=[a-f0-9]{64};/);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict']) assert.ok(cookie.includes(flag));
  const bot = cookie.split(';')[0];
  assert.equal((await f.activate(data)).status, 401); // Different browser cannot replay the URL.
  assert.equal((await f.post('/api/meet', { meetingUrl }, bot)).status, 401);
  assert.equal((await fetch(f.base + '/api/session', { headers: { Cookie: bot } }).then(r => r.json())).authenticated, false);
  await f.reject(f.owner);
  await f.reject(bot, '/voice');
  await f.reject(bot, '/meet/voice?ticket=' + f.getTicket(data));
  await f.reject(bot, '/meet/voice', 'https://other.example');
  const socket = f.connect(bot);
  await once(socket, 'open');
  assert.equal(f.calls(), 1);
  assert.equal((await f.post('/api/meet/ready', {}, bot)).status, 204);
  assert.equal(f.meet.state().status, 'ready');
  await f.reject(bot);
  const closed = once(socket, 'close');
  await f.post('/api/meet/end', {}, f.owner);
  await closed;
  await f.reject(bot);
});

test('operator logout does not disconnect a cloud bot, but its own short lease still expires', async t => {
  const f = await fixture(t, { meetOptions: { voiceTtlMs: 350 } });
  const data = await (await f.prepare()).json();
  const claim = await f.activate(data);
  const bot = claim.headers.get('set-cookie').split(';')[0];
  const socket = f.connect(bot);
  await once(socket, 'open');
  const closed = once(socket, 'close');
  await f.post('/api/logout', {}, f.owner);
  assert.equal(socket.readyState, WebSocket.OPEN);
  assert.equal((await f.post('/api/meet/ready', {}, bot)).status, 204);
  await closed;
  assert.equal(f.meet.state().status, 'idle');
  await f.reject(bot);
});

test('expired unused tickets never open a provider connection', async t => {
  let clock = 0;
  const f = await fixture(t, { now: () => clock });
  const data = await (await f.prepare()).json();
  clock = 6 * 60 * 1000;
  assert.equal((await f.activate(data)).status, 401);
  assert.equal(f.calls(), 0);
});

test('optional server key launches and removes a bot with documented requests; secrets never reach responses', async t => {
  const requests = [];
  const f = await fixture(t, { recallApiKey: 'private-recall', meetOptions: { fetchImpl: async (url, options) => {
    requests.push({ url, options }); return new Response(JSON.stringify({ id: botId }), { status: 200 });
  } } });
  const result = await (await f.prepare()).json();
  assert.equal(result.status, 'joining'); assert.equal(result.command, undefined);
  assert.ok(!JSON.stringify(result).includes('private-'));
  assert.equal(requests[0].url, 'https://us-east-1.recall.ai/api/v1/bot/');
  assert.equal(requests[0].options.headers.Authorization, 'Token private-recall');
  assert.deepEqual(JSON.parse(requests[0].options.body).recording_config, { retention: null });
  const stopped = await (await f.post('/api/meet/end', {}, f.owner)).json();
  assert.equal(stopped.leftCall, true);
  assert.equal(requests[1].url, `https://us-east-1.recall.ai/api/v1/bot/${botId}/leave_call/`);
});

test('Recall failures are redacted, never auto-retried and invalidate the pending capability', async t => {
  let requests = 0;
  const f = await fixture(t, { recallApiKey: 'private-recall', meetOptions: { fetchImpl: async () => {
    requests++; return new Response('private-key private provider details', { status: 401 });
  } } });
  const result = await f.prepare();
  assert.equal(result.status, 502);
  assert.ok(!(await result.text()).includes('private'));
  assert.equal(requests, 1);
  assert.equal(f.meet.state().status, 'idle');
});

test('meeting voice answers a spoken turn after its greeting through both local provider sockets', { timeout: 6000 }, async t => {
  const openai = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const eleven = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await Promise.all([once(openai, 'listening'), once(eleven, 'listening')]);
  t.after(async () => {
    for (const server of [openai, eleven]) for (const ws of server.clients) ws.terminate();
    await Promise.all([new Promise(r => openai.close(r)), new Promise(r => eleven.close(r))]);
  });
  const received = [];
  let replies = 0;
  openai.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'session.created' }));
    ws.on('message', data => {
      const event = JSON.parse(data); received.push(event);
      if (event.type === 'session.update') ws.send(JSON.stringify({ type: 'session.updated' }));
      if (event.type === 'input_audio_buffer.append') for (const turn of [
        { type: 'input_audio_buffer.speech_started', item_id: 'question' },
        { type: 'input_audio_buffer.speech_stopped', item_id: 'question' },
        { type: 'input_audio_buffer.committed', item_id: 'question' },
      ]) ws.send(JSON.stringify(turn));
      const itemId = 'reply-' + (replies + 1);
      if (event.type === 'response.create') replies++;
      if (event.type === 'response.create') for (const event of [
        { type: 'response.created' },
        { type: 'conversation.item.added', item: { id: itemId, role: 'assistant' } },
        { type: 'response.output_text.delta', item_id: itemId,
          delta: replies === 1 ? 'Hi, I am Sajida, an AI designer. ' : 'The portfolio includes Amazon listing and A+ design. ' },
        { type: 'response.output_text.done', item_id: itemId },
        { type: 'response.done', response: { status: 'completed' } },
      ]) ws.send(JSON.stringify(event));
    });
  });
  eleven.on('connection', ws => ws.on('message', data => {
    if (JSON.parse(data).text === '') {
      ws.send(JSON.stringify({ audio: Buffer.alloc(480).toString('base64') }));
      ws.send(JSON.stringify({ isFinal: true }));
    }
  }));
  const f = await fixture(t, { relay: (ws, options) => attachRelay(ws, { ...options,
    connect: (url, config) => new WebSocket(`ws://127.0.0.1:${(url.includes('api.openai.com') ? openai : eleven).address().port}`, config) }) });
  const data = await (await f.prepare()).json();
  const bot = (await f.activate(data)).headers.get('set-cookie').split(';')[0];
  const socket = f.connect(bot);
  const spoken = [];
  const done = new Promise((resolve, reject) => {
    socket.on('error', reject);
    socket.on('message', data => {
      const event = JSON.parse(data);
      if (event.type === 'session.created') socket.send(JSON.stringify({ type: 'session.update',
        session: { type: 'realtime', audio: { output: { voice: 'surabhi' } } } }));
      if (event.type === 'session.updated') {
        socket.send(JSON.stringify({ type: 'response.create' }));
      }
      if (event.type === 'relay.error') reject(Error('Unexpected relay error'));
      if (event.type === 'relay.audio.done') {
        spoken.push(event.item_id);
        socket.send(JSON.stringify({ type: 'relay.playback.completed', item_id: event.item_id }));
        if (spoken.length === 1) socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: 'AQI=' }));
        else resolve(event);
      }
    });
  });
  assert.equal((await done).samples, 240);
  assert.deepEqual(spoken, ['reply-1', 'reply-2']);
  assert.equal(received.filter(event => event.type === 'response.create').length, 2);
  assert.ok(received.some(event => event.type === 'input_audio_buffer.append' && event.audio === 'AQI='));
  assert.deepEqual(received.find(event => event.type === 'session.update').session.output_modalities, ['text']);
  socket.close();
});
