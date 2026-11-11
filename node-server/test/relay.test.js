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
  const logs = [];
  attachRelay(browser, { apiKey: 'test-placeholder', logDiagnostic: entry => logs.push(entry), ...options,
    connect: (url, config) => { request = { url, config }; return upstream; } });
  return { browser, upstream, request, logs };
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

test('provider errors expose only allowlisted diagnostics, never provider messages or request data', () => {
  const { browser, upstream, logs } = setup();
  upstream.readyState = 1; upstream.emit('open');
  upstream.emit('message', Buffer.from(JSON.stringify({ type: 'error', event_id: 'private-event-id',
    error: { type: 'invalid_request_error', code: 'unknown_parameter', param: 'session.audio.output.voice',
      message: 'sk-private-secret Authorization: Bearer private-token private conversation', headers: { secret: 'private-header' } } })), false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].kind, 'configuration');
  assert.equal(logs[0].code, 'unknown_parameter');
  assert.equal(logs[0].parameter, 'session.audio.output.voice');
  assert.equal(logs[0].stage, 'session_setup');
  const delivered = JSON.parse(browser.sent[0]);
  assert.equal(delivered.type, 'relay.error');
  assert.equal(delivered.error.reference, logs[0].reference);
  for (const text of [JSON.stringify(logs), ...browser.sent]) {
    for (const forbidden of ['sk-private-secret', 'private-token', 'private conversation', 'private-event-id', 'private-header']) {
      assert.ok(!text.includes(forbidden));
    }
  }
  assert.equal(browser.closed.code, 1011);
});

test('failed responses preserve a safe quota code without forwarding output or transcripts', () => {
  const { browser, upstream, logs } = setup();
  upstream.readyState = 1; upstream.emit('open');
  upstream.emit('message', Buffer.from('{"type":"session.updated"}'), false);
  browser.sent = [];
  upstream.emit('message', Buffer.from(JSON.stringify({ type: 'response.done', response: { status: 'failed',
    status_details: { error: { type: 'insufficient_quota', code: 'insufficient_quota', message: 'private billing details' } },
    output: [{ transcript: 'private speech' }] } })), false);
  assert.equal(logs[0].code, 'insufficient_quota');
  assert.equal(logs[0].kind, 'quota');
  assert.equal(logs[0].stage, 'conversation');
  assert.ok(!JSON.stringify({ logs, sent: browser.sent }).includes('private'));
});

test('unrecognized codes, types and parameter names are never logged verbatim', () => {
  const { browser, upstream, logs } = setup();
  upstream.emit('message', Buffer.from(JSON.stringify({ type: 'error', error: {
    code: 'private_code', type: 'private_type', param: 'private_param', message: 'private_message' } })), false);
  assert.equal(logs[0].code, 'unknown_error');
  assert.equal(logs[0].errorType, 'unknown_error');
  assert.equal(logs[0].parameter, null);
  assert.ok(!JSON.stringify({ logs, sent: browser.sent }).includes('private_'));
});

for (const [status, kind] of [[401, 'authentication'], [403, 'model_access'], [429, 'rate_or_quota'], [503, 'provider']]) {
  test(`HTTP ${status} handshake failure reports ${kind} without reading the response body`, () => {
    const { browser, upstream, logs } = setup();
    let destroyed = false;
    upstream.emit('unexpected-response', { headers: { Authorization: 'private-secret' } },
      { statusCode: status, destroy() { destroyed = true; }, get body() { throw new Error('must not read response body'); } });
    assert.equal(destroyed, true);
    assert.equal(logs[0].kind, kind);
    assert.equal(logs[0].httpStatus, status);
    assert.ok(!JSON.stringify({ logs, sent: browser.sent }).includes('private-secret'));
    assert.equal(browser.closed.code, 1011);
  });
}

test('a broken diagnostic sink still closes the paired connections safely', () => {
  const { browser, upstream } = setup({ logDiagnostic() { throw new Error('logger failed'); } });
  upstream.emit('error', new Error('private provider error'));
  assert.equal(browser.closed.code, 1011);
  assert.equal(upstream.readyState, 3);
  assert.equal(JSON.parse(browser.sent[0]).error.code, 'upstream_connection_failed');
});

