import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachRelay } from '../relay.js';
import { createElevenSpeech } from '../eleven-speech.js';

class Socket extends EventEmitter {
  readyState = 0;
  bufferedAmount = 0;
  sent = [];
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
  open() { this.readyState = 1; this.emit('open'); }
  message(event) { this.emit('message', Buffer.from(JSON.stringify(event)), false); }
}
function fixture(t, extra = {}) {
  const browser = new Socket(), upstream = new Socket(), synth = [], logs = [];
  browser.readyState = 1;
  attachRelay(browser, { apiKey: 'openai-private-placeholder', elevenlabsApiKey: 'eleven-private-placeholder',
    connect: () => upstream, connectSpeech: (url, options) => {
      const socket = new Socket(); synth.push({ socket, url, options }); return socket;
    }, logDiagnostic: entry => logs.push(entry), ...extra });
  upstream.open();
  t.after(() => browser.close());
  const configure = () => browser.message({ type: 'session.update', session: { type: 'realtime',
    output_modalities: ['audio'], audio: { input: { format: { type: 'audio/pcm', rate: 24000 },
      turn_detection: { type: 'server_vad', create_response: true, interrupt_response: true } },
    output: { voice: 'surabhi', format: { type: 'audio/pcm', rate: 24000 } } } } });
  const text = (delta, item = 'assistant-1') => upstream.message({ type: 'response.output_text.delta', item_id: item, delta });
  return { browser, upstream, synth, logs, configure, text };
}

test('Surabhi selects text output, manual VAD responses and server-side ElevenLabs credentials', t => {
  const f = fixture(t);
  f.configure();
  const update = f.upstream.sent[0];
  assert.deepEqual(update.session.output_modalities, ['text']);
  assert.equal(update.session.audio.output, undefined);
  assert.equal(update.session.audio.input.turn_detection.create_response, false);
  assert.equal(f.synth.length, 0);
  f.text('Hel'); f.text('lo ');
  assert.equal(f.synth.length, 1);
  const { socket, url, options } = f.synth[0];
  assert.equal(new URL(url).pathname, '/v1/text-to-speech/ch9J8IB6HKlEHQaWQFdk/stream-input');
  assert.equal(new URL(url).searchParams.get('output_format'), 'pcm_24000');
  assert.ok(!url.includes('private'));
  assert.equal(options.headers['xi-api-key'], 'eleven-private-placeholder');
  socket.open();
  assert.equal(socket.sent[0].text, ' ');
  assert.equal(socket.sent[1].text, 'Hello ');
  f.upstream.message({ type: 'response.output_text.done', item_id: 'assistant-1' });
  assert.deepEqual(socket.sent.at(-1), { text: '' });
  socket.message({ audio: Buffer.alloc(480).toString('base64') });
  socket.message({ isFinal: true });
  assert.equal(f.browser.sent.find(e => e.type === 'relay.audio.delta').item_id, 'assistant-1');
  assert.equal(f.browser.sent.find(e => e.type === 'relay.audio.done').samples, 240);
  assert.equal(f.logs.length, 0);
  assert.ok(!JSON.stringify(f.browser.sent).includes('private-placeholder'));
});

test('barge-in drops late speech and retains only the aligned, heard prefix before the next reply', t => {
  const f = fixture(t);
  f.configure();
  f.upstream.message({ type: 'conversation.item.added', previous_item_id: 'user-1',
    item: { id: 'assistant-1', role: 'assistant' } });
  f.upstream.message({ type: 'response.created' });
  f.text('Hello friend ');
  const socket = f.synth[0].socket; socket.open();
  socket.message({ audio: Buffer.alloc(48000).toString('base64'),
    alignment: { chars: [...'Hello friend '], charStartTimesMs: [...'Hello friend '].map((_, i) => i * 70),
      charDurationsMs: [...'Hello friend '].map(() => 70) } });
  f.upstream.message({ type: 'response.done', response: { status: 'completed' } });
  f.upstream.message({ type: 'input_audio_buffer.speech_started' });
  assert.equal(f.browser.sent.at(-1).relay_item_id, 'assistant-1');
  const sent = f.browser.sent.length;
  socket.message({ audio: 'AAAA' });
  assert.equal(f.browser.sent.length, sent);
  f.upstream.message({ type: 'input_audio_buffer.speech_stopped' });
  f.upstream.message({ type: 'input_audio_buffer.committed', item_id: 'user-2' });
  assert.equal(f.upstream.sent.filter(e => e.type === 'response.create').length, 0);
  f.browser.message({ type: 'relay.playback.interrupted', item_id: 'assistant-1', played_ms: 450 });
  const tail = f.upstream.sent.slice(-3);
  assert.deepEqual(tail[0], { type: 'conversation.item.delete', item_id: 'assistant-1' });
  assert.equal(tail[1].type, 'conversation.item.create');
  assert.equal(tail[1].previous_item_id, 'user-1');
  assert.equal(tail[1].item.content[0].text, 'Hello');
  assert.equal(tail[2].type, 'response.create');
  assert.ok(!f.upstream.sent.some(e => e.type === 'conversation.item.truncate'));
});

test('history repair waits for response cancellation and ignores forged playback item IDs', t => {
  const f = fixture(t);
  f.configure(); f.upstream.message({ type: 'response.created' }); f.text('A private reply ');
  f.synth[0].socket.open();
  f.upstream.message({ type: 'input_audio_buffer.speech_started' });
  f.browser.message({ type: 'relay.playback.interrupted', item_id: 'unrelated-user-item', played_ms: 0 });
  f.browser.message({ type: 'relay.playback.interrupted', item_id: 'assistant-1', played_ms: 0 });
  assert.ok(!f.upstream.sent.some(e => e.type === 'conversation.item.delete'));
  f.upstream.message({ type: 'response.done', response: { status: 'cancelled' } });
  assert.deepEqual(f.upstream.sent.at(-1), { type: 'conversation.item.delete', item_id: 'assistant-1' });
});

test('fully played replies stay in history when the user speaks again', t => {
  const f = fixture(t);
  f.configure(); f.text('Hello ');
  const socket = f.synth[0].socket; socket.open();
  f.upstream.message({ type: 'response.output_text.done', item_id: 'assistant-1' });
  socket.message({ audio: 'AAAA' }); socket.message({ isFinal: true });
  f.browser.message({ type: 'relay.playback.completed', item_id: 'assistant-1' });
  f.upstream.message({ type: 'input_audio_buffer.speech_started' });
  assert.equal(f.browser.sent.at(-1).relay_item_id, undefined);
  assert.ok(!f.upstream.sent.some(e => e.type === 'conversation.item.delete'));
});

test('native voices do not open a synthesis connection even when an ElevenLabs key exists', t => {
  const f = fixture(t);
  f.browser.message({ type: 'session.update', session: { audio: { output: { voice: 'marin' } } } });
  f.text('Hello ');
  assert.equal(f.synth.length, 0);
});

test('missing ElevenLabs configuration fails safely without forwarding Surabhi to OpenAI', t => {
  const f = fixture(t, { elevenlabsApiKey: undefined });
  f.configure();
  assert.equal(f.logs[0].source, 'elevenlabs');
  assert.equal(f.logs[0].kind, 'not_configured');
  assert.equal(f.upstream.sent.length, 0);
  assert.equal(f.browser.readyState, 3);
});

for (const [status, kind] of [[401, 'authentication'], [403, 'permission'], [404, 'voice_access'], [429, 'rate_or_quota'], [503, 'provider']]) {
  test('ElevenLabs HTTP ' + status + ' is classified without reading a secret-bearing body', t => {
    const f = fixture(t); f.configure(); f.text('Hello ');
    let destroyed = false;
    f.synth[0].socket.emit('unexpected-response', { headers: { secret: 'private-header' } },
      { statusCode: status, destroy() { destroyed = true; }, get body() { throw Error('private body read'); } });
    assert.equal(destroyed, true);
    assert.equal(f.logs.length, 1);
    assert.equal(f.logs[0].kind, kind);
    assert.equal(f.logs[0].source, 'elevenlabs');
    assert.equal(f.browser.readyState, 3);
    assert.equal(f.upstream.readyState, 3);
    assert.ok(!JSON.stringify({ logs: f.logs, sent: f.browser.sent }).includes('private-'));
  });
}

test('provider error messages are redacted and logout closes pending synthesis', t => {
  const f = fixture(t); f.configure(); f.text('Hello ');
  const socket = f.synth[0].socket; socket.open();
  socket.message({ error: { message: 'private transcript and API key' } });
  assert.equal(f.logs[0].code, 'speech_provider_error');
  assert.ok(!JSON.stringify(f.logs).includes('private transcript'));
  assert.equal(socket.readyState, 3);
  const second = fixture(t); second.configure(); second.text('Hello ');
  second.browser.close();
  assert.equal(second.synth[0].socket.readyState, 3);
});

test('documented ElevenLabs errors retain only allowlisted codes, never their messages', t => {
  for (const [status, kind] of [['invalid_api_key', 'authentication'], ['voice_not_found', 'voice_access'], ['quota_exceeded', 'quota']]) {
    const f = fixture(t); f.configure(); f.text('Hello ');
    f.synth[0].socket.open();
    f.synth[0].socket.message({ detail: { status, message: 'private spoken text and credentials' } });
    assert.equal(f.logs[0].kind, kind);
    assert.equal(f.logs[0].code, status);
    assert.ok(!JSON.stringify({ logs: f.logs, sent: f.browser.sent }).includes('private spoken'));
  }
});

test('synthesis text limits, startup timeout and thrown connections fail closed', async t => {
  const errors = [], sockets = [];
  const speech = createElevenSpeech({ apiKey: 'offline', voiceId: 'test', timeoutMs: 5, maxText: 8,
    connect: () => { const socket = new Socket(); sockets.push(socket); return socket; },
    onAudio() {}, onDone() {}, onError: error => errors.push(error) });
  t.after(() => speech.close());
  speech.write('one', 'too much text');
  assert.equal(errors[0].code, 'speech_text_limit');
  speech.write('two', 'Hello ');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(errors[1].code, 'speech_timeout');
  assert.ok(sockets.every(s => s.readyState === 3));
  const broken = createElevenSpeech({ apiKey: 'offline', voiceId: 'test',
    connect() { throw Error('private provider details'); }, onAudio() {}, onDone() {},
    onError: error => errors.push(error) });
  broken.write('three', 'Hello ');
  broken.close();
  assert.equal(errors.at(-1).code, 'speech_connection_failed');
});
