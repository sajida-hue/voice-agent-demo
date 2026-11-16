import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Voice } from './voice';

type MeetState = { configured: boolean; directLaunch: boolean; status: string; expiresAt: number | null; command?: string };
const labels: Record<string, string> = {
  idle: 'Send Sajida to a Google Meet call.',
  prepared: 'Connection prepared. Run the command below in Terminal within five minutes.',
  joining: 'Bot requested. Admit Sajida into the meeting if Google asks.',
  connecting: 'Sajida joined. Connecting her voice…',
  ready: 'Voice connected — speak to Sajida in Meet.',
};

export function MeetingPanel({ voice, disabled, onReserved }: {
  voice: Voice; disabled: boolean; onReserved: (reserved: boolean) => void;
}) {
  const [meetingUrl, setMeetingUrl] = useState('');
  const [state, setState] = useState<MeetState | null>(null);
  const [command, setCommand] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const mutation = useRef(0);
  const lastStatus = useRef('idle');
  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    async function refresh() {
      const version = mutation.current;
      try {
        const response = await fetch('/api/meet', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) return;
        const value: MeetState = await response.json();
        if (!mounted || version !== mutation.current) return;
        if (value.status !== lastStatus.current) setMessage('');
        lastStatus.current = value.status;
        setState(value);
        onReserved(value.status !== 'idle');
        if (value.status !== 'prepared') setCommand('');
      } catch { /* A transient status check must not start or end a bot. */ }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => { mounted = false; controller.abort(); clearInterval(timer); };
  }, [onReserved]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (busy || disabled) return;
    mutation.current++;
    setBusy(true);
    setMessage('Preparing the Meet connection…');
    try {
      const response = await fetch('/api/meet', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingUrl: meetingUrl.trim(), voice }) });
      const value = await response.json();
      if (!response.ok) { setMessage(value.error || 'Could not prepare the meeting.'); return; }
      setState(value);
      lastStatus.current = value.status;
      onReserved(value.status !== 'idle');
      setCommand(value.command || '');
      setMessage('');
    } catch { setMessage('The request was not confirmed. Check Recall before sending another bot.'); }
    finally { setBusy(false); }
  }
  async function end() {
    mutation.current++;
    setBusy(true);
    try {
      const response = await fetch('/api/meet/end', { method: 'POST' });
      const value = await response.json();
      if (!response.ok) { setMessage(value.error || 'Could not confirm the bot left. Remove it from Meet.'); return; }
      setState(value); lastStatus.current = value.status; setCommand(''); onReserved(false);
      setMessage(value.leftCall ? 'Sajida was asked to leave the call.' : 'Voice stopped. Remove Sajida from Meet if she is still in the call.');
    } catch { setMessage('Could not confirm the request. Remove Sajida from Meet to end the call.'); }
    finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(command); setMessage('Command copied. Paste it in Terminal, then enter your current Recall API key when asked.'); }
    catch { setMessage('Select the command below and copy it into Terminal.'); }
  }
  const reserved = !!state && state.status !== 'idle';
  return <section className="meeting-panel" aria-labelledby="meeting-title">
    <h2 id="meeting-title">Talk in Google Meet</h2>
    <p className="hint">Sajida joins from the cloud as an AI assistant, using the selected voice. Your laptop microphone is not used for her connection.</p>
    <p role="status">{message || labels[state?.status || 'idle'] || 'Checking the connection…'}</p>
    {!reserved ? <form onSubmit={event => void connect(event)}>
      <label htmlFor="meeting-url">Meeting link</label>
      <input id="meeting-url" type="url" placeholder="https://meet.google.com/abc-defg-hij" required
        value={meetingUrl} onChange={event => setMeetingUrl(event.target.value)} disabled={busy || disabled} />
      <button disabled={busy || disabled || !state?.configured}>{busy ? 'Preparing…' : 'Connect Sajida to Meet'}</button>
    </form> : <button className="secondary" disabled={busy} onClick={() => void end()}>Stop Meet voice</button>}
    {command && <>
      <button className="copy-command secondary" onClick={() => void copy()}>Copy Terminal command</button>
      <textarea className="meet-command" aria-label="Meet launch command" value={command} readOnly rows={7} spellCheck={false} />
      <p className="hint">Paste the command in Terminal. When prompted, paste your Recall API key and press Enter. The key is hidden and is not saved by this app.</p>
    </>}
    <p className="hint">Connecting uses paid Recall, OpenAI{voice === 'surabhi' ? ' and ElevenLabs' : ''} APIs. Meeting audio is sent to OpenAI; Surabhi reply text is sent to ElevenLabs. Recording is disabled. This pilot runs for up to 15 minutes after the voice page opens. Let participants know Sajida is AI before starting.</p>
  </section>;
}
