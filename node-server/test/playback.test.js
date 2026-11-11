import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { StreamProcessorWorklet } from '../../client/src/lib/wavtools/lib/worklets/stream_processor.js';

function processor() {
  let Processor;
  class Base { port = { sent: [], postMessage(value) { this.sent.push(value); } }; }
  vm.runInNewContext(StreamProcessorWorklet, {
    AudioWorkletProcessor: Base, registerProcessor(_name, value) { Processor = value; },
  });
  const instance = new Processor();
  const dispatch = value => instance.port.onmessage({ data: value });
  const process = () => instance.process([], [[new Float32Array(128)]]);
  return { instance, dispatch, process };
}

test('playback survives a network gap and drains the final partial PCM buffer', () => {
  const p = processor();
  p.dispatch({ event: 'write', trackId: 'reply', buffer: new Int16Array(320) });
  assert.equal(p.process(), true); assert.equal(p.process(), true);
  assert.equal(p.process(), true); // No network chunk yet: keep listening.
  p.dispatch({ event: 'finish', trackId: 'reply' });
  assert.equal(p.process(), true);
  p.dispatch({ event: 'offset', requestId: 'check' });
  assert.equal(p.instance.port.sent.at(-1).offset, 320);
  assert.equal(p.process(), false);
});

test('interrupt offset describes the playing track, not the last queued track', () => {
  const p = processor();
  p.dispatch({ event: 'write', trackId: 'first', buffer: new Int16Array(128) });
  p.dispatch({ event: 'write', trackId: 'second', buffer: new Int16Array(128) });
  p.process();
  p.dispatch({ event: 'interrupt', requestId: 'stop' });
  assert.equal(p.instance.port.sent.at(-1).trackId, 'first');
  assert.equal(p.instance.port.sent.at(-1).offset, 128);
  assert.equal(p.process(), false);
});
