import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { startVoice } from './voice';
import type { Voice } from './voice';
import './App.css';

type Session = { authenticated: boolean; expiresAt: number | null; surabhiAvailable?: boolean };

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('Checking session…');
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(false);
  const [voice, setVoice] = useState<Voice>('marin');
  const stopRef = useRef<ReturnType<typeof startVoice> | null>(null);
  const activeRef = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    // Retire old token-bearing links without displaying or using their values.
    if (location.search || location.hash) history.replaceState(null, '', location.pathname);
    fetch('/api/session', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Session unavailable');
        const value: Session = await response.json();
        if (mounted.current) {
          setSession(value);
          setVoice(value.surabhiAvailable ? 'surabhi' : 'marin');
          setStatus(value.authenticated ? 'Ready to start' : 'Sign in to talk with Sajida');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && mounted.current) {
          setSession({ authenticated: false, expiresAt: null });
          setStatus('Server unavailable. Refresh this page to retry.');
        }
      });
    return () => { mounted.current = false; controller.abort(); stopRef.current?.(); };
  }, []);

  useEffect(() => {
    if (!session?.authenticated || !session.expiresAt) return;
    const timer = setTimeout(() => {
      stopRef.current?.('Session expired. Please sign in again.');
      setSession({ authenticated: false, expiresAt: null });
      setStatus('Session expired. Please sign in again.');
    }, Math.max(0, session.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      setPassword('');
      if (!response.ok) {
        setStatus(response.status === 429 ? 'Too many sign-in attempts. Wait five minutes.' : 'Sign-in failed. Check your password and try again.');
        return;
      }
      const value: Session = await response.json();
      setSession(value);
      setVoice(value.surabhiAvailable ? 'surabhi' : 'marin');
      setStatus('Ready to start');
    } catch { setPassword(''); setStatus('Could not reach the server. Please try again.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    stopRef.current?.();
    setBusy(true);
    try {
      const response = await fetch('/api/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Logout failed');
      setSession({ authenticated: false, expiresAt: null });
      setStatus('Signed out');
    } catch { setStatus('Could not sign out. Please try again; your voice conversation has stopped.'); }
    finally { setBusy(false); }
  }

  function start() {
    if (activeRef.current || !session?.authenticated) return;
    activeRef.current = true;
    setActive(true);
    stopRef.current = startVoice(voice, message => { if (mounted.current) setStatus(message); }, () => {
      activeRef.current = false;
      if (mounted.current) setActive(false);
    });
  }

  return <main className="app-container"><section className="voice-card" aria-labelledby="title">
    <p className="eyebrow">AMZLUEA · AI DESIGN ASSISTANT</p>
    <h1 id="title">Meet Sajida</h1>
    <p>A warm, calm voice to help you think through your next design project.</p>
    <p className="status" role="status" aria-live="polite">{status}</p>
    {session && (session.authenticated ? <>
      <label htmlFor="voice">Voice</label>
      <select id="voice" value={voice} disabled={active || busy} onChange={event => setVoice(event.target.value as Voice)}>
        {session.surabhiAvailable && <option value="surabhi">Surabhi — warm Indian English</option>}
        <option value="marin">Marin</option><option value="cedar">Cedar</option><option value="coral">Coral</option>
      </select>
      <p className="hint">Change voices between conversations. Each new conversation starts fresh.</p>
      <div className="actions">
        {active ? <button onClick={() => stopRef.current?.()}>End conversation</button>
          : <button disabled={busy} onClick={start}>Start conversation</button>}
        <button className="secondary" disabled={busy} onClick={() => void logout()}>Sign out</button>
      </div>
      <p className="hint">Starting uses your microphone and the paid {voice === 'surabhi' ? 'OpenAI and ElevenLabs APIs' : 'OpenAI API'}. Access expires after 15 minutes.</p>
    </> : <form onSubmit={event => void login(event)}>
      <label htmlFor="password">Access password</label>
      <input id="password" type="password" autoComplete="current-password" maxLength={1024}
        value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} />
      <button type="submit" disabled={busy || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>)}
    <p className="privacy">Sajida is an AI assistant. Audio is sent to OpenAI during the conversation.
      {session?.surabhiAvailable && ' When Surabhi is selected, reply text is sent to ElevenLabs for speech.'}
      {' '}This app does not save recordings.</p>
  </section></main>;
}
export default App;

