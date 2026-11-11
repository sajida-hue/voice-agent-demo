import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const audio = vi.hoisted(() => ({ recorder: {} as Record<string, unknown>, player: {} as Record<string, unknown> }));
vi.mock('./lib/wavtools/index.js', () => ({
  WavRecorder: class { constructor() { return audio.recorder; } },
  WavStreamPlayer: class { constructor() { return audio.player; } },
}));
import { startVoice } from './voice';

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 1;
  bufferedAmount = 0;
  onmessage: ((event: { data: string }) => Promise<void>) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = 3; });
  constructor(public url: URL) { FakeSocket.instances.push(this); }
  async emit(event: object) { await this.onmessage?.({ data: JSON.stringify(event) }); }
}
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
let stop: ReturnType<typeof startVoice> | undefined;

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  const context = () => ({ state: 'running', close: vi.fn(function(this: { state: string }) { this.state = 'closed'; return Promise.resolve(); }) });
  audio.recorder = { begin: vi.fn().mockResolvedValue(true), record: vi.fn().mockResolvedValue(true),
    stream: { getTracks: () => [{ stop: vi.fn() }] }, context: context() };
  audio.player = { connect: vi.fn().mockResolvedValue(true), context: context(),
    add16BitPCM: vi.fn(), finish: vi.fn(), interrupt: vi.fn().mockResolvedValue({ trackId: 'item-1', offset: 2400 }) };
});
afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); });

describe('voice lifecycle with offline audio and transport doubles', () => {
  it('plays Surabhi PCM, seals the final buffer and acknowledges drained playback', async () => {
    stop = startVoice('surabhi', vi.fn(), vi.fn()); await flush();
    const socket = FakeSocket.instances[0];
    await socket.emit({ type: 'session.created' });
    await socket.emit({ type: 'session.updated' });
    audio.player.stream = {};
    await socket.emit({ type: 'relay.audio.delta', item_id: 'item-1', delta: 'AAAA' });
    expect(audio.player.add16BitPCM).toHaveBeenCalledTimes(1);
    await socket.emit({ type: 'relay.audio.done', item_id: 'item-1', samples: 2400 });
    expect(audio.player.finish).toHaveBeenCalledWith('item-1');
    audio.player.stream = null;
    await vi.waitFor(() => expect(socket.send.mock.calls.map(call => JSON.parse(call[0])))
      .toContainEqual({ type: 'relay.playback.completed', item_id: 'item-1' }));
  });

  it('Surabhi interruption reports actual playback time and discards late chunks', async () => {
    stop = startVoice('surabhi', vi.fn(), vi.fn()); await flush();
    const socket = FakeSocket.instances[0];
    await socket.emit({ type: 'session.created' });
    await socket.emit({ type: 'session.updated' });
    await socket.emit({ type: 'relay.audio.delta', item_id: 'item-1', delta: 'AAAA' });
    await socket.emit({ type: 'input_audio_buffer.speech_started', relay_item_id: 'item-1' });
    expect(JSON.parse(socket.send.mock.lastCall![0])).toEqual({
      type: 'relay.playback.interrupted', item_id: 'item-1', played_ms: 100,
    });
    await socket.emit({ type: 'relay.audio.delta', item_id: 'item-1', delta: 'AAAA' });
    expect(audio.player.add16BitPCM).toHaveBeenCalledTimes(1);
    expect(socket.send.mock.calls.map(call => JSON.parse(call[0]).type)).not.toContain('conversation.item.truncate');
  });
  it('waits for GA configuration acknowledgement before recording and requesting a reply', async () => {
    const status = vi.fn();
    stop = startVoice('marin', status, vi.fn());
    await flush();
    const socket = FakeSocket.instances[0];
    expect(socket.url.href).toBe('ws://localhost:3000/voice');
    expect(audio.recorder.record).not.toHaveBeenCalled();
    await socket.emit({ type: 'session.created' });
    const update = JSON.parse(socket.send.mock.calls[0][0]);
    expect(update.session.audio.output.voice).toBe('marin');
    expect(update.session.instructions).toContain('Speak English by default');
    expect(update.session.instructions).toContain('soft, warm, calm');
    expect(audio.recorder.record).not.toHaveBeenCalled();
    await socket.emit({ type: 'session.updated' });
    expect(audio.recorder.record).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith('Ready — speak naturally');
    expect(JSON.parse(socket.send.mock.lastCall![0]).type).toBe('response.create');
    await socket.emit({ type: 'session.updated' });
    expect(audio.recorder.record).toHaveBeenCalledTimes(1);
  });

  it('sends PCM bytes, plays GA audio and truncates playback when interrupted', async () => {
    stop = startVoice('cedar', vi.fn(), vi.fn()); await flush();
    const socket = FakeSocket.instances[0];
    await socket.emit({ type: 'session.created' });
    await socket.emit({ type: 'session.updated' });
    const record = audio.recorder.record as ReturnType<typeof vi.fn>;
    record.mock.calls[0][0]({ mono: Uint8Array.from([1, 2]).buffer });
    expect(JSON.parse(socket.send.mock.lastCall![0])).toEqual({ type: 'input_audio_buffer.append', audio: 'AQI=' });
    await socket.emit({ type: 'response.output_audio.delta', delta: 'AAA=', item_id: 'item-1' });
    expect(audio.player.add16BitPCM).toHaveBeenCalled();
    await socket.emit({ type: 'input_audio_buffer.speech_started' });
    expect(JSON.parse(socket.send.mock.lastCall![0])).toEqual({ type: 'conversation.item.truncate', item_id: 'item-1', content_index: 0, audio_end_ms: 100 });
  });

  it('provider errors and explicit stop close audio and transport exactly once', async () => {
    const ended = vi.fn();
    stop = startVoice('coral', vi.fn(), ended); await flush();
    const socket = FakeSocket.instances[0];
    await socket.emit({ type: 'error' });
    stop();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect((audio.recorder.context as { state: string }).state).toBe('closed');
    expect((audio.player.context as { state: string }).state).toBe('closed');
  });

  it('stopping while microphone permission is pending never opens a voice connection', async () => {
    let permit!: (value: boolean) => void;
    audio.recorder.begin = vi.fn(() => new Promise<boolean>(resolve => { permit = resolve; }));
    stop = startVoice('marin', vi.fn(), vi.fn());
    stop(); permit(true); await flush();
    expect(FakeSocket.instances).toHaveLength(0);
    expect((audio.recorder.context as { state: string }).state).toBe('closed');
  });

  it('an audio initialization failure releases devices without connecting to OpenAI', async () => {
    const status = vi.fn();
    audio.player.connect = vi.fn().mockRejectedValue(new Error('Worklet unavailable'));
    stop = startVoice('marin', status, vi.fn()); await flush();
    expect(FakeSocket.instances).toHaveLength(0);
    expect((audio.recorder.context as { state: string }).state).toBe('closed');
    expect(status.mock.lastCall![0]).toContain('Could not start audio');
  });

  it('shows safe quota guidance and a reference, then releases audio', async () => {
    const status = vi.fn();
    stop = startVoice('marin', status, vi.fn()); await flush();
    const socket = FakeSocket.instances[0];
    const reference = '12345678-1234-4234-8234-123456789abc';
    await socket.emit({ type: 'relay.error', error: { source: 'elevenlabs', kind: 'quota', code: 'insufficient_quota', reference,
      message: 'private upstream details sk-secret', audio: 'private audio' } });
    expect(status.mock.lastCall![0]).toContain('API quota or billing limit');
    expect(status.mock.lastCall![0]).toContain('ElevenLabs');
    expect(status.mock.lastCall![0]).toContain(reference);
    expect(status.mock.lastCall![0]).not.toContain('private');
    expect(status.mock.lastCall![0]).not.toContain('sk-secret');
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect((audio.recorder.context as { state: string }).state).toBe('closed');
  });

  it('ignores unknown diagnostic strings and still redacts errors from an old relay', async () => {
    const status = vi.fn();
    stop = startVoice('marin', status, vi.fn()); await flush();
    await FakeSocket.instances[0].emit({ type: 'relay.error', error: { kind: 'sk-private', reference: 'private-reference', message: 'private message' } });
    expect(status.mock.lastCall![0]).not.toContain('private');
    expect(status.mock.lastCall![0]).toContain('OpenAI reported a voice error');
    stop = startVoice('marin', status, vi.fn()); await flush();
    await FakeSocket.instances[1].emit({ type: 'error', error: { message: 'private legacy error' } });
    expect(status.mock.lastCall![0]).not.toContain('private');
  });
});
