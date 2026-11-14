import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeVoiceWav, VoiceWindowBuffer, VOICE_WINDOW_SAMPLES } from './utils/voice-audio';
import { parseVoiceRequest } from '../sandbox-api/src/voice-input';
import { analyzeVoice, voiceEndpoint } from './utils/voice-client';

test('browser WAV is accepted by backend and preserves PCM amplitude and duration', () => {
  const samples = Float32Array.from({ length: VOICE_WINDOW_SAMPLES }, (_, i) => Math.sin(i * .1) * .3);
  const encoded = encodeVoiceWav(samples);
  const request = parseVoiceRequest({ mimeType: 'audio/wav', audioBase64: Buffer.from(encoded).toString('base64') });
  assert.equal(request.mimeType, 'audio/wav');
  assert.equal(encoded.length, 160044);
  assert.equal(new DataView(encoded.buffer).getInt16(46, true), Math.round(samples[1] * 32767));
});

test('audio worklet packets produce continuous independent 5-second windows without lost samples', () => {
  const buffer = new VoiceWindowBuffer();
  const received: Float32Array[] = [];
  const count = VOICE_WINDOW_SAMPLES * 2;
  for (let i = 0; i < count; i += 2048) received.push(...buffer.push(Float32Array.from({ length: Math.min(2048, count - i) }, (_, j) => i + j)));
  assert.equal(received.length, 2);
  assert.equal(received[0][VOICE_WINDOW_SAMPLES - 1], VOICE_WINDOW_SAMPLES - 1);
  assert.equal(received[1][0], VOICE_WINDOW_SAMPLES);
  assert.equal(received[1][VOICE_WINDOW_SAMPLES - 1], count - 1);
});

test('server URL uses HTTPS except for local development and cannot hide credentials or a query', () => {
  assert.equal(voiceEndpoint('http://localhost:8080/'), 'http://localhost:8080/api/v1/analyze-voice');
  assert.equal(voiceEndpoint('https://example.com/voice'), 'https://example.com/voice/api/v1/analyze-voice');
  for (const url of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com', 'https://example.com/?key=secret']) assert.throws(() => voiceEndpoint(url));
});


test('client keeps content availability consistent and sends review only when selected', async () => {
  const originalFetch = globalThis.fetch;
  const samples = Float32Array.from({ length: 16000 }, (_, i) => Math.sin(i * .1) * .2);
  const answer = { riskScore: 0, verdict: 'SAFE', detectedTactics: [], tacticEvidence: [], syntheticVoiceProbability: null,
    transcriptSnippet: 'Lịch họp ngày mai.', warningMessageVi: 'Chưa thấy dấu hiệu.', executionTimeMs: 1,
    audioQuality: 'CLEAR', assessmentSource: 'GEMINI_AUDIO', analysisModel: 'fixture', contentAnalysis: { status: 'AVAILABLE' } };
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).analysisMode, 'review');
      return new Response(JSON.stringify(answer));
    };
    assert.equal((await analyzeVoice(samples, { apiBase: 'http://localhost:8080', token: '' }, undefined, 'review')).verdict, 'SAFE');
    for (const contentAnalysis of [{ status: 'UNAVAILABLE', reason: 'RATE_LIMITED' }, { status: 'AVAILABLE_BUT_FALSE' }, { status: 'UNAVAILABLE', reason: 'RAW_SECRET' }]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ ...answer, contentAnalysis }));
      await assert.rejects(analyzeVoice(samples, { apiBase: 'http://localhost:8080', token: '' }), /không hợp lệ/);
    }
  } finally { globalThis.fetch = originalFetch; }
});
