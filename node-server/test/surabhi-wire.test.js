import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { createApplication } from '../server.js';
import { attachRelay } from '../relay.js';

test('real local HTTP and WebSocket flow carries text to TTS and PCM back without external API calls', { timeout: 5000 }, async t => {
  const openai = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  const eleven = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await Promise.all([once(openai, 'listening'), once(eleven, 'listening')]);
  const providerUrl = server => 'ws://127.0.0.1:' + server.address().port;
  const updates = [], texts = [];
  openai.on('connection', (ws, req) => {
    assert.equal(req.headers.authorization, 'Bearer offline-openai');
    ws.send(JSON.stringify({ type: 'session.created' }));
    ws.on('message', data => {
      const event = JSON.parse(data);
      if (event.type === 'session.update') {
        updates.push(event);
        ws.send(JSON.stringify({ type: 'session.updated' }));
      }
      if (event.type === 'response.create') {
        for (const value of [
          { type: 'response.created' },
          { type: 'conversation.item.added', item: { id: 'reply', role: 'assistant' }, previous_item_id: null },
          { type: 'response.output_text.delta', item_id: 'reply', delta: 'Hello Natasha. ' },
          { type: 'response.output_text.done', item_id: 'reply' },
          { type: 'response.done', response: { status: 'completed' } },
        ]) ws.send(JSON.stringify(value));
      }
    });
  });
  eleven.on('connection', (ws, req) => {
    assert.equal(req.headers['xi-api-key'], 'offline-eleven');
    ws.on('message', data => {
      const event = JSON.parse(data);
      texts.push(event.text);
      if (event.text === '') {
        ws.send(JSON.stringify({ audio: Buffer.alloc(480).toString('base64') }));
        ws.send(JSON.stringify({ isFinal: true }));
      }
    });
  });
  const origin = 'http://localhost:3000';
  const app = createApplication({ apiKey: 'offline-openai', elevenlabsApiKey: 'offline-eleven',
    password: 'offline-long-password', publicOrigin: origin,
    relay: (browser, options) => attachRelay(browser, { ...options,
      connect: (url, config) => new WebSocket(providerUrl(url.includes('api.openai.com') ? openai : eleven), config) }),
  });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(async () => {
    for (const server of [app.wss, openai, eleven]) for (const ws of server.clients) ws.terminate();
    await Promise.all([new Promise(r => app.server.close(r)), new Promise(r => openai.close(r)), new Promise(r => eleven.close(r))]);
  });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const login = await fetch(base + '/api/login', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'offline-long-password' }) });
  const browser = new WebSocket(base.replace('http:', 'ws:') + '/voice',
    { headers: { Origin: origin, Cookie: login.headers.get('set-cookie').split(';')[0] } });
  const events = [];
  const finished = new Promise((resolve, reject) => {
    browser.on('error', reject);
    browser.on('message', data => {
      const event = JSON.parse(data);
      events.push(event);
      if (event.type === 'session.created') browser.send(JSON.stringify({ type: 'session.update',
        session: { type: 'realtime', audio: { output: { voice: 'surabhi' } } } }));
      if (event.type === 'session.updated') browser.send(JSON.stringify({ type: 'response.create' }));
      if (event.type === 'relay.error') reject(Error('Unexpected relay error'));
      if (event.type === 'relay.audio.done') resolve(event);
    });
  });
  const done = await finished;
  assert.equal(done.samples, 240);
  assert.ok(events.some(e => e.type === 'relay.audio.delta'));
  assert.deepEqual(updates[0].session.output_modalities, ['text']);
  assert.deepEqual(texts, [' ', 'Hello Natasha. ', '']);
  browser.close();
});
