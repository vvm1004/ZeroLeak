import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trimVoicePcm } from '../src/voice-input.js';

test('trimming keeps quiet nonzero endpoints, internal silence, and the original bytes', () => {
  const pcm = Buffer.alloc(160000);
  pcm.writeInt16LE(1, 40000); pcm.writeInt16LE(-1, 80000);
  const copy = Buffer.from(pcm), result = trimVoicePcm(pcm);
  assert.deepEqual(result, copy.subarray(33600, 86402));
  assert.equal(result.readInt16LE(6400), 1);
  assert.equal(result.readInt16LE(46400), -1);
  assert.deepEqual(pcm, copy);
});

test('trimming preserves the minimum duration at either edge and does not shorten silence-only data', () => {
  for (const index of [0, 40000, 159998]) {
    const pcm = Buffer.alloc(160000); pcm.writeInt16LE(1, index);
    const result = trimVoicePcm(pcm);
    assert.ok(result.length >= 16000 && result.length <= pcm.length && result.length % 2 === 0);
    assert.ok(result.includes(Buffer.from([1, 0])));
  }
  const short = Buffer.alloc(16000); short.writeInt16LE(1, 8000);
  assert.deepEqual(trimVoicePcm(short), short);
  const silent = Buffer.alloc(160000); assert.equal(trimVoicePcm(silent), silent);
  const noSilence = Buffer.alloc(160000, 1); assert.deepEqual(trimVoicePcm(noSilence), noSilence);
});
