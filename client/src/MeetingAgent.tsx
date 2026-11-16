import { useEffect, useState } from 'react';
import { startVoice } from './voice';
import type { Voice } from './voice';
import './App.css';

// This page runs inside Recall's cloud browser, not the operator's laptop.
export function MeetingAgent() {
  const [status, setStatus] = useState('Connecting to the meeting…');
  const [voice, setVoice] = useState<Voice | null>(null);
  useEffect(() => {
    let stopped = false;
    let stopVoice: ReturnType<typeof startVoice> | undefined;
    const controller = new AbortController();
    const ticket = new URLSearchParams(location.hash.slice(1)).get('ticket');
    // Fragments are never sent in HTTP requests; retire it before loading audio.
    history.replaceState(null, '', location.pathname);
    const fail = () => {
      if (stopped) return;
      stopVoice?.();
      setStatus('Meeting voice is unavailable. Ask the organizer to prepare a new connection.');
    };
    async function connect() {
      try {
        const response = await fetch('/api/meet/activate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticket }), signal: controller.signal, cache: 'no-store',
        });
        if (!response.ok) { fail(); return; }
        const config: { voice: Voice } = await response.json();
        if (stopped) return;
        setVoice(config.voice);
        stopVoice = startVoice(config.voice, message => { if (!stopped) setStatus(message); }, () => {}, {
          meeting: true,
          onReady: () => {
            void fetch('/api/meet/ready', { method: 'POST', signal: controller.signal })
              .then(r => { if (!r.ok) fail(); }).catch(fail);
          },
        });
      } catch { fail(); }
    }
    void connect();
    return () => { stopped = true; controller.abort(); stopVoice?.(); };
  }, []);
  return <main className="meeting-stage">
    <p className="eyebrow">AMZLUEA · AI DESIGN ASSISTANT</p>
    <div className="meeting-avatar" aria-hidden="true">S</div>
    <h1>Sajida</h1>
    <p className="meeting-subtitle">Ideas, with a human touch.</p>
    <p role="status" className="meeting-status">{status}</p>
    <p className="meeting-disclosure">AI voice · Audio processed by OpenAI{voice === 'surabhi' ? ' · Speech by ElevenLabs' : ''}</p>
  </main>;
}
