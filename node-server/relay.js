import WebSocket from 'ws';

// GA wire protocol, no Beta SDK or OpenAI-Beta header. Credentials stay here.
export function attachRelay(browser, {
  apiKey,
  model = 'gpt-realtime',
  connect = (url, options) => new WebSocket(url, options),
  timeoutMs = 10000,
  maxQueueBytes = 256 * 1024,
} = {}) {
  const upstream = connect(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    handshakeTimeout: timeoutMs,
    maxPayload: 1024 * 1024,
  });
  let queue = [];
  let queuedBytes = 0;
  let stopped = false;
  const stop = (code = 1011, reason = 'Realtime connection failed') => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    queue = [];
    if (browser.readyState === WebSocket.OPEN) browser.close(code, reason);
    if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
    else if (upstream.readyState === WebSocket.OPEN) upstream.close();
  };
  const timer = setTimeout(() => stop(), timeoutMs);
  upstream.on('open', () => {
    clearTimeout(timer);
    if (stopped) return;
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
    if (binary) { stop(); return; }
    if (browser.readyState === WebSocket.OPEN) {
      if (browser.bufferedAmount + data.length > maxQueueBytes) stop(1013, 'Audio backpressure');
      else browser.send(data.toString());
    }
  });
  upstream.on('error', () => stop());
  upstream.on('close', () => stop(1000, 'Realtime disconnected'));
  browser.on('error', () => stop());
  browser.on('close', () => stop());
  return upstream;
}
