import WebSocket from 'ws';

const errorKinds = new Map([
  ['invalid_api_key', 'authentication'], ['quota_exceeded', 'quota'],
  ['voice_not_found', 'voice_access'], ['max_character_limit_exceeded', 'configuration'],
]);

// One streaming connection per reply. Cancelling a reply also cancels synthesis.
// Speech and alignment remain in memory, bounded to the most recent two replies.
export function createElevenSpeech({ apiKey, voiceId, model = 'eleven_flash_v2_5',
  connect = (url, options) => new WebSocket(url, options), onAudio, onDone, onError,
  timeoutMs = 10000, maxText = 16000, maxQueueBytes = 256 * 1024,
}) {
  const records = new Map();
  let current;
  let closed = false;
  const finishSocket = record => {
    clearTimeout(record.timer);
    clearTimeout(record.deadline);
    record.cancelled = true;
    if (record.socket?.readyState === WebSocket.CONNECTING) record.socket.terminate();
    else if (record.socket?.readyState === WebSocket.OPEN) record.socket.close();
    record.pending = '';
  };
  const fail = (record, kind, code, httpStatus) => {
    if (closed || record.cancelled) return;
    finishSocket(record);
    // Only local constants and a numeric status leave this module.
    onError({ source: 'elevenlabs', kind, code, stage: 'speech',
      ...(httpStatus ? { httpStatus } : {}) });
  };
  const arm = record => {
    clearTimeout(record.timer);
    record.timer = setTimeout(() => fail(record, 'connection', 'speech_timeout'), timeoutMs);
  };
  const send = (record, value) => {
    if (record.cancelled || record.socket.readyState !== WebSocket.OPEN) return false;
    const text = JSON.stringify(value);
    if (record.socket.bufferedAmount + Buffer.byteLength(text) > maxQueueBytes) {
      fail(record, 'connection', 'speech_backpressure');
      return false;
    }
    record.socket.send(text);
    return true;
  };
  const drain = record => {
    if (record.socket.readyState !== WebSocket.OPEN || record.cancelled) return;
    // Never insert a space inside an LLM token. The API expects word boundaries.
    const boundary = record.inputDone ? record.pending.length : record.pending.lastIndexOf(' ') + 1;
    if (boundary > 0) {
      const text = record.pending.slice(0, boundary).replace(/\s+$/u, '') + ' ';
      record.pending = record.pending.slice(boundary);
      if (!send(record, { text })) return;
    }
    if (record.inputDone && !record.endSent) {
      record.endSent = true;
      send(record, { text: '' });
    }
  };
  function begin(itemId, previousItemId) {
    if (current && !current.done && !current.cancelled) finishSocket(current);
    while (records.size >= 2) {
      const [id, record] = records.entries().next().value;
      finishSocket(record);
      records.delete(id);
    }
    const record = { itemId, previousItemId, text: '', pending: '', samples: 0,
      alignment: [], cancelled: false, done: false, played: false, inputDone: false };
    records.set(itemId, record);
    current = record;
    const url = new URL('wss://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voiceId) + '/stream-input');
    url.searchParams.set('model_id', model);
    url.searchParams.set('output_format', 'pcm_24000');
    url.searchParams.set('sync_alignment', 'true');
    try {
      record.socket = connect(url.href, {
        headers: { 'xi-api-key': apiKey }, handshakeTimeout: timeoutMs, maxPayload: 1024 * 1024,
      });
    } catch {
      fail(record, 'connection', 'speech_connection_failed');
      return record;
    }
    arm(record);
    record.deadline = setTimeout(() => fail(record, 'connection', 'speech_duration_limit'), 90000);
    record.socket.on('open', () => {
      if (record.cancelled || closed) return;
      send(record, { text: ' ', voice_settings: {
        stability: 0.40, similarity_boost: 0.75, use_speaker_boost: false, speed: 0.98,
      }, generation_config: { chunk_length_schedule: [80, 120, 180, 240] } });
      drain(record);
    });
    record.socket.on('message', (data, binary) => {
      if (closed || record.cancelled) return;
      let event;
      try { event = JSON.parse(data.toString()); } catch { fail(record, 'provider', 'speech_invalid_event'); return; }
      if (binary || !event || typeof event !== 'object') {
        fail(record, 'provider', 'speech_invalid_event'); return;
      }
      if (event.error || event.detail || event.message) {
        const candidate = [event.error, event.code, event.error?.code, event.detail?.status]
          .find(value => errorKinds.has(value));
        fail(record, errorKinds.get(candidate) || 'provider', candidate || 'speech_provider_error'); return;
      }
      arm(record);
      if (event.audio) {
        if (typeof event.audio !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/u.test(event.audio)) {
          fail(record, 'provider', 'speech_invalid_audio'); return;
        }
        const bytes = Buffer.from(event.audio, 'base64');
        if (!bytes.length || bytes.length % 2) { fail(record, 'provider', 'speech_invalid_audio'); return; }
        const alignment = event.alignment || event.normalizedAlignment;
        const baseMs = record.samples / 24;
        if (alignment && Array.isArray(alignment.chars) &&
          alignment.chars.length === alignment.charStartTimesMs?.length &&
          alignment.chars.length === alignment.charDurationsMs?.length) {
          for (let i = 0; i < alignment.chars.length && record.alignment.length < maxText; i++) {
            const char = alignment.chars[i];
            const start = alignment.charStartTimesMs[i], duration = alignment.charDurationsMs[i];
            if (typeof char !== 'string' || char.length > 8 || !Number.isFinite(start) || start < 0 ||
              !Number.isFinite(duration) || duration < 0 || record.alignment.length >= maxText) continue;
            record.alignment.push({ char, endMs: baseMs + start + duration });
          }
        }
        record.samples += bytes.length / 2;
        onAudio({ type: 'relay.audio.delta', item_id: itemId, delta: event.audio });
      }
      if (event.isFinal === true) {
        record.done = true;
        finishSocket(record);
        onDone({ type: 'relay.audio.done', item_id: itemId, samples: record.samples });
      }
    });
    record.socket.on('unexpected-response', (_request, response) => {
      const status = response.statusCode;
      const kind = status === 401 ? 'authentication' : status === 403 ? 'permission'
        : status === 404 ? 'voice_access' : status === 429 ? 'rate_or_quota' : 'provider';
      fail(record, kind, 'speech_http_error', Number.isInteger(status) && status >= 400 && status <= 599 ? status : null);
      response.destroy();
    });
    record.socket.on('error', () => fail(record, 'connection', 'speech_connection_failed'));
    record.socket.on('close', () => {
      if (!record.done) fail(record, 'connection', 'speech_connection_closed');
    });
    return record;
  }
  return {
    write(itemId, delta, previousItemId) {
      if (closed || typeof delta !== 'string') return;
      const record = records.get(itemId) || begin(itemId, previousItemId);
      if (record.cancelled || record.inputDone) return;
      if (record.text.length + delta.length > maxText) { fail(record, 'configuration', 'speech_text_limit'); return; }
      record.text += delta;
      record.pending += delta;
      arm(record);
      drain(record);
    },
    end(itemId) {
      const record = records.get(itemId);
      if (!record || record.cancelled || record.inputDone) return;
      record.inputDone = true;
      drain(record);
    },
    cancel() {
      if (current && !current.cancelled) finishSocket(current);
      return current && !current.played ? current : null;
    },
    completed(itemId) {
      const record = records.get(itemId);
      if (record?.done) record.played = true;
    },
    heard(record, milliseconds) {
      const limit = Math.max(0, Math.min(milliseconds, record.samples / 24));
      if (record.played || (record.done && limit >= record.samples / 24 && record.samples > 0)) return null;
      let text = '';
      let next = '';
      for (const entry of record.alignment) {
        if (entry.endMs > limit) { next = entry.char; break; }
        text += entry.char;
      }
      if (/\S/u.test(next) && /\S$/u.test(text)) text = text.replace(/\S+$/u, '');
      return text.trim();
    },
    close() {
      closed = true;
      for (const record of records.values()) finishSocket(record);
      records.clear();
      current = undefined;
    },
  };
}
