import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { providerDiagnostic, handshakeDiagnostic } from './diagnostics.js';

// GA wire protocol, no Beta SDK or OpenAI-Beta header. Credentials stay here.
export function attachRelay(browser, {
  apiKey,
  model = 'gpt-realtime',
  connect = (url, options) => new WebSocket(url, options),
  timeoutMs = 10000,
  maxQueueBytes = 256 * 1024,
  logDiagnostic = entry => console.warn(JSON.stringify(entry)),
} = {}) {
  const upstream = connect(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    handshakeTimeout: timeoutMs,
    maxPayload: 1024 * 1024,
  });
  let queue = [];
  let queuedBytes = 0;
  let stopped = false;
  let stage = 'connecting';
  const reference = randomUUID();
  const report = diagnostic => {
    if (stopped) return;
    try { logDiagnostic({ event: 'realtime_error', ...diagnostic }); } catch { /* logging must not keep a failed session alive */ }
    const text = JSON.stringify({ type: 'relay.error', error: diagnostic });
    if (browser.readyState === WebSocket.OPEN && browser.bufferedAmount + Buffer.byteLength(text) <= maxQueueBytes) browser.send(text);
  };
  const transportFailure = code => {
    report({ source: 'relay', kind: 'connection', code, stage, reference });
    stop();
  };
  const stop = (code = 1011, reason = 'Realtime connection failed') => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    queue = [];
    if (browser.readyState === WebSocket.OPEN) browser.close(code, reason);
    if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
    else if (upstream.readyState === WebSocket.OPEN) upstream.close();
  };
  const timer = setTimeout(() => transportFailure('upstream_timeout'), timeoutMs);
  upstream.on('open', () => {
    clearTimeout(timer);
    if (stopped) return;
    stage = 'session_setup';
    for (const data of queue) upstream.send(data);
    queue = [];
    queuedBytes = 0;
  });
  browser.on('message', (data, binary) => {
    if (stopped) return;
    let event;
    try { event = JSON.parse(data.toString()); } catch { stop(1008, 'Invalid event'); return; }
    if (binary || !event || typeof event.type !== 'string') {
      stop(1008, 'Invalid event'); return;
    }
    const text = JSON.stringify(event);
    if (upstream.readyState === WebSocket.OPEN) {
      if (upstream.bufferedAmount + Buffer.byteLength(text) > maxQueueBytes) stop(1013, 'Audio backpressure');
      else upstream.send(text);
    } else {
      queuedBytes += Buffer.byteLength(text);
      if (queuedBytes > maxQueueBytes) stop(1009, 'Startup queue exceeded');
      else queue.push(text);
    }
  });
  upstream.on('message', (data, binary) => {
    if (stopped) return;
    if (binary) { transportFailure('upstream_protocol_error'); return; }
    let event;
    try { event = JSON.parse(data.toString()); } catch { transportFailure('upstream_protocol_error'); return; }
    if (event?.type === 'session.updated') stage = 'conversation';
    if (event?.type === 'error' || (event?.type === 'response.done' && event.response?.status === 'failed')) {
      const error = event.type === 'error' ? event.error : event.response?.status_details?.error;
      report(providerDiagnostic(error, stage, reference));
      stop();
      return;
    }
    if (browser.readyState === WebSocket.OPEN) {
      if (browser.bufferedAmount + data.length > maxQueueBytes) stop(1013, 'Audio backpressure');
      else browser.send(data.toString());
    }
  });
  upstream.on('unexpected-response', (_request, response) => {
    report(handshakeDiagnostic(response.statusCode, reference));
    response.destroy(); // Never collect or log provider response bodies.
    stop();
  });
  upstream.on('error', () => transportFailure('upstream_connection_failed'));
  upstream.on('close', () => {
    report({ source: 'relay', kind: 'connection', code: 'upstream_closed', stage, reference });
    stop(1000, 'Realtime disconnected');
  });
  browser.on('error', () => stop());
  browser.on('close', () => stop());
  return upstream;
}

