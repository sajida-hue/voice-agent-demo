import { randomUUID } from 'node:crypto';
import { createElevenSpeech } from './eleven-speech.js';

// Realtime understands microphone audio and produces text; ElevenLabs speaks it.
// VAD response creation is gated while interrupted playback is reconciled.
export function createSurabhiSession({ apiKey, voiceId, model, connectSpeech,
  sendUpstream, sendBrowser, onError, repairTimeoutMs = 1200,
  speechFactory = createElevenSpeech,
}) {
  let active = false, speaking = false, pendingUser = false, repair = null, closed = false;
  let lastUserId = 'root';
  const predecessors = new Map();
  const cancelled = new Set();
  const speech = speechFactory({ apiKey, voiceId, model, connect: connectSpeech,
    onAudio: sendBrowser, onDone: sendBrowser, onError });
  const request = () => ({ type: 'response.create',
    response: { output_modalities: ['text'], max_output_tokens: 400 } });
  const maybeRespond = () => {
    if (closed || !pendingUser || active || repair || speaking) return;
    pendingUser = false;
    active = true;
    sendUpstream(request());
  };
  const finishRepair = () => {
    if (!repair || active || repair.milliseconds === undefined || closed) return;
    const { record, milliseconds, timer } = repair;
    clearTimeout(timer);
    repair = null;
    const heard = speech.heard(record, milliseconds);
    if (heard !== null) {
      sendUpstream({ type: 'conversation.item.delete', item_id: record.itemId });
      if (heard) sendUpstream({ type: 'conversation.item.create',
        previous_item_id: record.previousItemId || 'root',
        item: { id: 'heard_' + randomUUID().replaceAll('-', '').slice(0, 24),
          type: 'message', role: 'assistant', content: [{ type: 'output_text', text: heard }] } });
    }
    maybeRespond();
  };
  return {
    client(event) {
      if (event.type === 'relay.playback.completed') { speech.completed(event.item_id); return null; }
      if (event.type === 'relay.playback.interrupted') {
        if (repair?.record.itemId === event.item_id && Number.isFinite(event.played_ms) && event.played_ms >= 0) {
          repair.milliseconds = event.played_ms;
          finishRepair();
        }
        return null;
      }
      if (event.type === 'session.update') {
        const input = event.session?.audio?.input || {};
        return { ...event, session: { ...event.session, output_modalities: ['text'], max_output_tokens: 400,
          audio: { input: { ...input, turn_detection: {
            ...(input.turn_detection || { type: 'server_vad', silence_duration_ms: 700 }),
            create_response: false, interrupt_response: true,
          } } } } };
      }
      if (event.type === 'response.create') {
        if (active || repair || speaking) return null;
        active = true;
        return request();
      }
      // Text-only assistant items cannot be truncated with audio_end_ms.
      if (event.type === 'conversation.item.truncate' || event.type.startsWith('relay.')) return null;
      return event;
    },
    server(event) {
      if (event.type === 'conversation.item.added' && event.item?.role === 'assistant') {
        if (predecessors.size >= 16) predecessors.delete(predecessors.keys().next().value);
        predecessors.set(event.item.id, event.previous_item_id || 'root');
      }
      if (event.type === 'response.created') active = true;
      if (event.type === 'response.output_text.delta' && !cancelled.has(event.item_id)) {
        speech.write(event.item_id, event.delta, predecessors.get(event.item_id) || lastUserId);
      }
      if (event.type === 'response.output_text.done') speech.end(event.item_id);
      if (event.type === 'input_audio_buffer.speech_started') {
        speaking = true;
        const record = speech.cancel();
        if (record) {
          cancelled.add(record.itemId);
          if (cancelled.size > 32) cancelled.delete(cancelled.values().next().value);
          if (!repair) {
            repair = { record, milliseconds: undefined, timer: null };
            repair.timer = setTimeout(() => {
              if (!repair) return;
              // If playback acknowledgement is lost, omit the unverified reply.
              repair.milliseconds = 0;
              finishRepair();
            }, repairTimeoutMs);
          }
          event = { ...event, relay_item_id: record.itemId };
        }
      }
      if (event.type === 'input_audio_buffer.speech_stopped') { speaking = false; maybeRespond(); }
      if (event.type === 'input_audio_buffer.committed') {
        lastUserId = event.item_id;
        pendingUser = true;
        maybeRespond();
      }
      if (event.type === 'response.done') {
        active = false;
        finishRepair();
        maybeRespond();
      }
      return event;
    },
    close() {
      closed = true;
      clearTimeout(repair?.timer);
      speech.close();
      predecessors.clear();
      cancelled.clear();
      repair = null;
    },
  };
}
