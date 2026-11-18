import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import { MeetingAgent } from './MeetingAgent';

const voice = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock('./voice', () => ({ startVoice: voice.start }));
const reply = (value: object, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status }));

beforeEach(() => {
  voice.start.mockReset(); voice.stop.mockReset();
  voice.start.mockReturnValue(voice.stop);
  history.replaceState(null, '', '/');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); history.replaceState(null, '', '/'); });

it('operator explicitly prepares a cloud connection, copies the command and stops it without opening local audio', async () => {
  let status = 'idle';
  vi.stubGlobal('fetch', vi.fn((url, options) => {
    if (url === '/api/session') return reply({ authenticated: true, expiresAt: Date.now() + 900000,
      surabhiAvailable: true, meetAvailable: true });
    if (url === '/api/meet/end') { status = 'idle'; return reply({ configured: true, directLaunch: false, status, leftCall: false }); }
    if (options?.method === 'POST') {
      status = 'prepared';
      return reply({ configured: true, directLaunch: false, status, command: 'offline-test-launch-command' }, 201);
    }
    return reply({ configured: true, directLaunch: false, status, expiresAt: null });
  }));
  render(<App />);
  const button = await screen.findByRole('button', { name: 'Connect Sajida to Meet' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  expect(voice.start).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Meeting link'), { target: { value: 'https://meet.google.com/abc-defg-hij' } });
  fireEvent.click(button);
  expect(await screen.findByLabelText('Meet launch command')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Start conversation' }) as HTMLButtonElement).disabled).toBe(true);
  const post = vi.mocked(fetch).mock.calls.find(([url, options]) => url === '/api/meet' && options?.method === 'POST');
  expect(JSON.parse(post![1]!.body as string)).toEqual({ meetingUrl: 'https://meet.google.com/abc-defg-hij', voice: 'surabhi' });
  expect(voice.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Stop Meet voice' }));
  await waitFor(() => expect(screen.queryByLabelText('Meet launch command')).toBeNull());
  expect((screen.getByRole('button', { name: 'Start conversation' }) as HTMLButtonElement).disabled).toBe(false);
});

it('cloud page consumes its fragment and starts meeting audio automatically only after authorization', async () => {
  history.replaceState(null, '', '/meet/agent#ticket=' + 'a'.repeat(64));
  vi.stubGlobal('fetch', vi.fn(() => reply({ voice: 'surabhi', expiresAt: Date.now() + 900000 })));
  const page = render(<MeetingAgent />);
  await waitFor(() => expect(voice.start).toHaveBeenCalledTimes(1));
  expect(location.hash).toBe('');
  expect(fetch).toHaveBeenCalledWith('/api/meet/activate', expect.objectContaining({ method: 'POST',
    body: JSON.stringify({ ticket: 'a'.repeat(64) }) }));
  expect(voice.start.mock.calls[0][0]).toBe('surabhi');
  expect(voice.start.mock.calls[0][3].meeting).toBe(true);
  voice.start.mock.calls[0][3].onReady();
  expect(fetch).toHaveBeenCalledWith('/api/meet/ready', expect.objectContaining({ method: 'POST' }));
  page.unmount();
  expect(voice.stop).toHaveBeenCalledTimes(1);
});

it('an invalid or replayed ticket never starts audio and never displays provider response data', async () => {
  vi.stubGlobal('fetch', vi.fn(() => reply({ error: 'private-server-response' }, 401)));
  render(<MeetingAgent />);
  await screen.findByText(/Meeting voice is unavailable/);
  expect(voice.start).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('private-server-response');
});
