import { useEffect, useState } from 'react';
// @ts-expect-error External audio utilities without TypeScript definitions
import { WavRecorder, WavStreamPlayer } from './lib/wavtools/index.js';
import { instructions } from './conversation_config';
import './App.css';

export function App() {
  const [status, setStatus] = useState('Connecting');
  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | undefined;
    const recorder = new WavRecorder({ sampleRate: 24000 });
    const player = new WavStreamPlayer({ sampleRate: 24000 });
    let initialized = false;
    let ready = false;
    let endingRecorder = false;
    const send = (event: object) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
    };
    const cleanup = () => {
      ready = false;
      if (socket) {
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
      if (recorder.processor && !endingRecorder) {
        endingRecorder = true;
        void recorder.end().catch(() => {}).finally(() => { endingRecorder = false; });
      }
      if (player.context && player.context.state !== 'closed') void player.context.close().catch(() => {});
    };
    async function start() {
      try {
        const url = new URL(new URLSearchParams(location.search).get('wss') || '');
        if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && url.hostname === 'localhost')) {
          throw new Error('Invalid relay URL');
        }
        await recorder.begin();
        if (disposed) { cleanup(); return; }
        await player.connect();
        if (disposed) { cleanup(); return; }
        socket = new WebSocket(url);
        socket.onmessage = async ({ data }) => {
          if (disposed) return;
          try {
            const event = JSON.parse(data);
            if (event.type === 'session.created' && !initialized) {
              initialized = true;
              send({ type: 'session.update', session: {
                type: 'realtime', instructions, output_modalities: ['audio'],
                audio: {
                  input: { format: { type: 'audio/pcm', rate: 24000 }, turn_detection: {
                    type: 'server_vad', create_response: true, interrupt_response: true,
                  } },
                  output: { format: { type: 'audio/pcm', rate: 24000 }, voice: 'alloy' },
                },
              } });
            } else if (event.type === 'session.updated' && !ready) {
              ready = true;
              setStatus('Connected — Sajida — AI Designer');
              await recorder.record((chunk: { mono: ArrayBuffer }) => {
                if (!ready) return;
                const bytes = new Uint8Array(chunk.mono);
                let binary = '';
                for (const byte of bytes) binary += String.fromCharCode(byte);
                send({ type: 'input_audio_buffer.append', audio: btoa(binary) });
              });
              if (disposed) { cleanup(); return; }
              send({ type: 'response.create' });
            } else if (event.type === 'response.output_audio.delta') {
              const bytes = Uint8Array.from(atob(event.delta), c => c.charCodeAt(0));
              player.add16BitPCM(bytes.buffer, event.item_id);
            } else if (event.type === 'input_audio_buffer.speech_started') {
              const offset = await player.interrupt();
              if (offset?.trackId) send({ type: 'conversation.item.truncate', item_id: offset.trackId,
                content_index: 0, audio_end_ms: Math.floor(offset.offset / 24) });
            } else if (event.type === 'error' || (event.type === 'response.done' && event.response?.status === 'failed')) {
              throw new Error('Realtime error');
            }
          } catch {
            setStatus('Voice session failed');
            cleanup();
          }
        };
        socket.onerror = () => { if (!disposed) setStatus('Relay connection failed'); cleanup(); };
        socket.onclose = () => { if (!disposed) setStatus('Disconnected'); cleanup(); };
      } catch {
        if (!disposed) setStatus('Unable to start voice session');
        cleanup();
      }
    }
    void start();
    return () => { disposed = true; cleanup(); };
  }, []);
  return <div className="app-container"><div role="status">{status}</div></div>;
}
export default App;
