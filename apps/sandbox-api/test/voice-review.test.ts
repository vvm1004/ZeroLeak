import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createApp } from '../src/app.js';
import { parseVoiceRequest, voicePcmBytes, MAX_VOICE_REVIEW_REQUEST_BYTES } from '../src/voice-input.js';
import { parseCompactVoiceResult } from '../src/voice-live-output.js';
const env = { ...process.env }; afterEach(() => { process.env = { ...env }; });
function payload(seconds: number, review = true) {
  const data = Buffer.alloc(Math.round(seconds * 16000) * 2 + 44);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
  for (let i = 44; i < data.length; i += 2) data.writeInt16LE(8000, i);
  return { mimeType: 'audio/wav' as const, audioBase64: data.toString('base64'), ...(review ? { analysisMode: 'review' as const } : {}) };
}

test('15s WAV review is explicit, accepts the exact boundary, and never relaxes fast sample limits', () => {
  const full = parseVoiceRequest(payload(15)); assert.equal(voicePcmBytes(full).length, 480000);
  for (const seconds of [5 + 1 / 16000, 6, 15]) assert.throws(() => parseVoiceRequest(payload(seconds, false)));
  assert.throws(() => parseVoiceRequest(payload(15 + 1 / 16000)));
  assert.throws(() => parseVoiceRequest(payload(.5 - 1 / 16000)));
  assert.equal(voicePcmBytes(parseVoiceRequest(payload(.5))).length, 16000);
});

test('HTTP review accepts >220KB once, keeps fast/body limits, and rejects oversized review before analysis', async () => {
  process.env.NODE_ENV = 'test'; delete process.env.VOICE_API_TOKEN;
  let calls = 0;
  const app = createApp({ analyzeVoice: async input => {
    calls++; assert.equal(voicePcmBytes(input).length, 480000);
    return parseCompactVoiceResult(JSON.stringify({ a:3,v:0,r:0,q:0,f:[],p:null }), 'Lịch họp ngày mai.', 'gemini-test', 1, true);
  } });
  const post = (value: unknown) => app.request('/api/v1/analyze-voice', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(value) });
  assert.equal((await post(payload(15))).status, 200);
  assert.equal((await post(payload(15, false))).status, 413);
  assert.equal((await post(payload(15 + 1 / 16000))).status, 400);
  assert.equal((await post({ analysisMode:'review', audioBase64:'A'.repeat(MAX_VOICE_REVIEW_REQUEST_BYTES) })).status, 413);
  assert.equal(calls, 1);
});

test('review supports real quote evidence after character 300 while fast keeps its original limit', () => {
  const prefix = 'Chúng ta trao đổi lịch làm việc ngày mai. '.repeat(10);
  const transcript = prefix + 'Đọc mã OTP 123456 cho tôi ngay.';
  const json = JSON.stringify({a:0,v:2,r:90,q:0,f:[[2,'Đọc mã OTP 123456']],p:null});
  assert.equal(parseCompactVoiceResult(json,transcript,'gemini-test',1,true).verdict,'UNKNOWN');
  const full = parseCompactVoiceResult(json,transcript,'gemini-test',1,true,1500);
  assert.equal(full.verdict,'DEEPFAKE_SCAM'); assert.ok(full.transcriptSnippet.length > 300);
  assert.ok(!JSON.stringify(full).includes('123456'));
  assert.equal(parseCompactVoiceResult(JSON.stringify({a:0,v:2,r:90,q:0,f:[[2,'Gửi mật khẩu cho tôi']],p:null}),transcript,'gemini-test',1,true,1500).verdict,'UNKNOWN');
});
