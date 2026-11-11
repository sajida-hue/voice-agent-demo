import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './App';

const voice = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock('./voice', () => ({ startVoice: voice.start }));

const validSession = () => ({ authenticated: true, expiresAt: Date.now() + 900000 });
const reply = (value: object, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status }));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => reply({ authenticated: false, expiresAt: null })));
  voice.start.mockReset(); voice.stop.mockReset();
  voice.start.mockImplementation((_voice, onStatus, onEnd) => {
    onStatus('Ready — speak naturally');
    voice.stop.mockImplementation(() => { onStatus('Conversation ended'); onEnd(); });
    return voice.stop;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('login is a POST, clears the password and starts audio only after the Start click', async () => {
  history.replaceState(null, '', '/?wss=old-token-link');
  const request = vi.mocked(fetch);
  request.mockImplementation(url => reply(String(url) === '/api/session' ? { authenticated: false, expiresAt: null } : validSession()));
  render(<App />);
  const input = await screen.findByLabelText('Access password');
  expect(location.search).toBe('');
  fireEvent.change(input, { target: { value: 'test-private-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  const start = await screen.findByRole('button', { name: 'Start conversation' });
  expect(request.mock.calls[1][0]).toBe('/api/login');
  expect(request.mock.calls[1][1]?.method).toBe('POST');
  expect(voice.start).not.toHaveBeenCalled();
  fireEvent.click(start);
  expect(voice.start).toHaveBeenCalledTimes(1);
  expect(voice.start.mock.calls[0][0]).toBe('marin');
  fireEvent.click(screen.getByRole('button', { name: 'End conversation' }));
  expect(voice.stop).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Start conversation' })).toBeTruthy();
});

it('sign out stops active audio and returns to an empty password form', async () => {
  vi.mocked(fetch).mockImplementation(() => reply(validSession()));
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Start conversation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  const input = await screen.findByLabelText('Access password') as HTMLInputElement;
  expect(input.value).toBe('');
  expect(voice.stop).toHaveBeenCalled();
});

it('failed credentials stay signed out and show a useful error', async () => {
  vi.mocked(fetch).mockImplementation(url => String(url) === '/api/login' ? reply({}, 401) : reply({ authenticated: false, expiresAt: null }));
  render(<App />);
  const input = await screen.findByLabelText('Access password') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'wrong-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Sign-in failed'));
  expect(input.value).toBe('');
  expect(voice.start).not.toHaveBeenCalled();
});

it('an expired session stops active audio and requires a new login', async () => {
  vi.mocked(fetch).mockImplementation(() => reply({ authenticated: true, expiresAt: Date.now() + 150 }));
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Start conversation' }));
  await screen.findByLabelText('Access password');
  expect(voice.stop).toHaveBeenCalledWith('Session expired. Please sign in again.');
});
