// @ts-expect-error Existing JavaScript audio utilities
import { WavRecorder, WavStreamPlayer } from './lib/wavtools/index.js';
import { instructions } from './conversation_config';

export type Voice = 'marin' | 'cedar' | 'coral';

export function startVoice(voice: Voice, onStatus: (value: string) => void, onEnd: () => void) {
  const recorder = new WavRecorder({ sampleRate: 24000 });
  const player = new WavStreamPlayer({ sampleRate: 24000 });
  let socket: WebSocket | undefined;
  let stopped = false;
  let ready = false;
  let initialized = false;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  const releaseAudio = () => {
    // Stop devices immediately, even if worklet initialization failed mid-way.
    recorder.stream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
    for (const node of [recorder.processor, recorder.source, recorder.analyser, player.stream]) {
      if (node) { try { node.disconnect(); } catch { /* already disconnected */ } }
    }
    for (const context of [recorder.context, player.context]) {
      if (context && context.state !== 'closed') void context.close().catch(() => {});
    }
  };
  const stop = (message = 'Conversation ended') => {
    if (stopped) return;
    stopped = true;
    ready = false;
    clearTimeout(startupTimer);
    if (socket) {
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
    releaseAudio();
    onStatus(message);
    onEnd();
  };
  const send = (event: object) => {
    if (stopped || socket?.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 256 * 1024) { stop('Connection is too slow. Please try again.'); return; }
    socket.send(JSON.stringify(event));
  };
  async function run() {
    onStatus('Allow microphone access to begin');
    try {
      // Output context is resumed directly from the user's Start click.
      const results = await Promise.allSettled([player.connect(), recorder.begin()]);
      if (stopped) { releaseAudio(); return; }
      if (results.some(result => result.status === 'rejected')) {
        stop('Could not start audio. Check microphone permission and try again.');
        return;
      }
      onStatus('Connecting to voice service…');
      const url = new URL('/voice', location.origin);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(url);
      startupTimer = setTimeout(() => stop('Voice service did not become ready. Please try again.'), 20000);
      socket.onmessage = async ({ data }) => {
        if (stopped) return;
        try {
          const event = JSON.parse(data);
          if (event.type === 'session.created' && !initialized) {
            initialized = true;
            send({ type: 'session.update', session: {
              type: 'realtime', instructions, output_modalities: ['audio'],
              audio: {
                input: { format: { type: 'audio/pcm', rate: 24000 }, turn_detection: {
                  type: 'server_vad', create_response: true, interrupt_response: true,
                  silence_duration_ms: 700,
                } },
                output: { format: { type: 'audio/pcm', rate: 24000 }, voice },
              },
            } });
          } else if (event.type === 'session.updated' && !ready) {
            ready = true;
            clearTimeout(startupTimer);
            await recorder.record((chunk: { mono: ArrayBuffer }) => {
              if (!ready || stopped) return;
              const bytes = new Uint8Array(chunk.mono);
              let binary = '';
              for (const byte of bytes) binary += String.fromCharCode(byte);
              send({ type: 'input_audio_buffer.append', audio: btoa(binary) });
            });
            if (stopped) return;
            onStatus('Ready — speak naturally');
            send({ type: 'response.create' });
          } else if (event.type === 'response.output_audio.delta' && ready) {
            const bytes = Uint8Array.from(atob(event.delta), c => c.charCodeAt(0));
            player.add16BitPCM(bytes.buffer, event.item_id);
          } else if (event.type === 'input_audio_buffer.speech_started') {
            const offset = await player.interrupt();
            if (stopped) return;
            if (offset?.trackId) send({ type: 'conversation.item.truncate', item_id: offset.trackId,
              content_index: 0, audio_end_ms: Math.floor(offset.offset / 24) });
          } else if (event.type === 'error' || (event.type === 'response.done' && event.response?.status === 'failed')) {
            stop('Voice service error. Check server configuration or try again.');
          }
        } catch { stop('Voice session failed. Please try again.'); }
      };
      socket.onerror = () => stop('Could not connect. Your session may have expired, or another conversation is active.');
      socket.onclose = event => stop(event.code === 1008 ? 'Session expired. Please sign in again.' : 'Voice connection ended. You can try again.');
    } catch { stop('Unable to start voice session. Please try again.'); }
  }
  void run();
  return stop;
}
