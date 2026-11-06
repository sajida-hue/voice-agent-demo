import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachRelay } from '../relay.js';
class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent = [];
  send(data) { this.sent.push(data); }
  close(code, reason) { this.closed = { code, reason }; this.readyState = 3; this.emit('close'); }
  terminate() { this.readyState = 3; this.emit('close'); }
}
function setup(options = {}) {
  const browser = new Socket();
  const upstream = new Socket();
  upstream.readyState = 0;
  let request;
  attachRelay(browser, { apiKey: 'test-placeholder', ...options,
    connect: (url, config) => { request = { url, config }; return upstream; } });
  return { browser, upstream, request };
}
test('GA endpoint uses server authorization without Beta header', () => {
  const { browser, request } = setup();
  assert.equal(request.url, 'wss://api.openai.com/v1/realtime?model=gpt-realtime');
  assert.deepEqual(request.config.headers, { Authorization: 'Bearer test-placeholder' });
  browser.close();
});
test('queued session update precedes audio and is flushed once', () => {
  const { browser, upstream } = setup();
  const events = [{ type: 'session.update', session: { type: 'realtime' } },
    { type: 'input_audio_buffer.append', audio: 'AAAA' }];
  events.forEach(event => browser.emit('message', Buffer.from(JSON.stringify(event)), false));
  assert.equal(upstream.sent.length, 0);
  upstream.readyState = 1; upstream.emit('open');
  assert.deepEqual(upstream.sent.map(JSON.parse), events);
  upstream.emit('open'); assert.equal(upstream.sent.length, 2);
  browser.close();
});
test('GA audio events pass unchanged', () => {
  const { browser, upstream } = setup();
  const event = JSON.stringify({ type: 'response.output_audio.delta', delta: 'AAAA', item_id: 'item' });
  upstream.emit('message', Buffer.from(event), false);
  assert.deepEqual(browser.sent, [event]); browser.close();
});
for (const value of ['invalid', 'null', '{}']) {
  test(`rejects invalid client event ${value}`, () => {
    const { browser, upstream } = setup();
    browser.emit('message', Buffer.from(value), false);
    assert.equal(browser.closed.code, 1008); assert.equal(upstream.readyState, 3);
  });
}
test('bounds startup queue', () => {
  const { browser } = setup({ maxQueueBytes: 10 });
  browser.emit('message', Buffer.from('{"type":"input_audio_buffer.append"}'), false);
  assert.equal(browser.closed.code, 1009);
});
test('upstream failures close browser with generic reason', () => {
  const { browser, upstream } = setup();
  upstream.emit('error', new Error('secret provider details'));
  assert.deepEqual(browser.closed, { code: 1011, reason: 'Realtime connection failed' });
});
test('startup timeout closes both sides', async () => {
  const { browser, upstream } = setup({ timeoutMs: 5 });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(browser.closed.code, 1011); assert.equal(upstream.readyState, 3);
});
test('backpressure closes stalled connection', () => {
  const { browser, upstream } = setup({ maxQueueBytes: 64 });
  upstream.readyState = 1; upstream.emit('open'); upstream.bufferedAmount = 65;
  browser.emit('message', Buffer.from('{"type":"response.create"}'), false);
  assert.equal(browser.closed.code, 1013);
});
