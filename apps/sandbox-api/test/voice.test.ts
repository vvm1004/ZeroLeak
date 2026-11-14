import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { createApp } from '../src/app.js';
import { analyzeAudioScam, parseVoiceResult, VoiceAnalysisError, voiceModelRoute } from '../src/voice-analyzer.js';
import { parseVoiceRequest } from '../src/voice-input.js';
import { analyzeVoiceWithAcoustic } from '../src/voice-acoustic.js';

const original = { ...process.env };
afterEach(() => { process.env = { ...original }; });

function wav(silent = false) {
  const out = Buffer.alloc(32044);
  out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVE', 8); out.write('fmt ', 12);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(16000, 24); out.writeUInt32LE(32000, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(32000, 40);
  for (let i = 0; i < 16000; i++) out.writeInt16LE(silent ? 0 : Math.round(Math.sin(i * 0.1) * 8000), 44 + i * 2);
  return out;
}
const payload = () => ({ audioBase64: wav().toString('base64'), mimeType: 'audio/wav' as const });
const answer = () => ({
  riskScore: 85, verdict: 'SUSPICIOUS', syntheticVoiceProbability: null,
  detectedTactics: ['OTP_OR_CREDENTIAL_ASK'], tacticEvidence: [{ tactic: 'OTP_OR_CREDENTIAL_ASK', quote: 'Hãy đọc mã OTP 123456' }], transcriptSnippet: 'Hãy đọc mã OTP 123456.',
  warningMessageVi: 'Không chia sẻ mã OTP. Hãy kiểm tra lại qua kênh chính thức.', audioQuality: 'CLEAR',
});

test('accepts PCM WAV from actual sample count and rejects forged headers, silence, and base64', () => {
  assert.equal(parseVoiceRequest(payload()).mimeType, 'audio/wav');
  const bad = wav(); bad.writeUInt32LE(48000, 24);
  for (const input of [null, [], { ...payload(), mimeType: 'audio/webm' },
    { ...payload(), audioBase64: 'not base64' }, { ...payload(), audioBase64: bad.toString('base64') },
    { ...payload(), audioBase64: wav(true).toString('base64') },
    { ...payload(), audioBase64: wav().subarray(0, 45).toString('base64') }]) {
    assert.throws(() => parseVoiceRequest(input));
  }
});

test('validates provider output, redacts evidence, and does not fabricate voice probability', () => {
  const result = parseVoiceResult(JSON.stringify(answer()), 'test-model', 10);
  assert.equal(result.syntheticVoiceProbability, null);
  assert.ok(!result.transcriptSnippet.includes('123456'));
  for (const value of [{ ...answer(), riskScore: 101 }, { ...answer(), syntheticVoiceProbability: 4 },
    { ...answer(), detectedTactics: ['MADE_UP'] }, { ...answer(), verdict: 'trusted' }]) {
    assert.throws(() => parseVoiceResult(JSON.stringify(value), 'test', 1), VoiceAnalysisError);
  }
  assert.throws(() => parseVoiceResult('not json', 'test', 1), VoiceAnalysisError);
});

test('unusable audio and contradictory SAFE both abstain', () => {
  const unknown = parseVoiceResult(JSON.stringify({ ...answer(), audioQuality: 'UNUSABLE' }), 'test', 1);
  assert.equal(unknown.verdict, 'UNKNOWN'); assert.equal(unknown.riskScore, null);
  assert.deepEqual(unknown.detectedTactics, []);
  const inconsistent = parseVoiceResult(JSON.stringify({ ...answer(), verdict: 'SAFE' }), 'test', 1);
  assert.equal(inconsistent.verdict, 'UNKNOWN');
});

test('uncertain conversation content does not erase independent acoustic evidence', () => {
  const result = parseVoiceResult(JSON.stringify({ ...answer(), riskScore: null, verdict: 'UNKNOWN',
    syntheticVoiceProbability: 0.85, audioQuality: 'CLEAR' }), 'test', 1);
  assert.equal(result.verdict, 'UNKNOWN');
  assert.equal(result.riskScore, null);
  assert.equal(result.syntheticVoiceProbability, 0.85);
  assert.deepEqual(result.detectedTactics, []);
});

test('falls back within a single budget and sends audio as data with a structured response schema', async () => {
  process.env.GEMINI_MODEL_VOICE = 'gemini-test-primary';
  process.env.GEMINI_MODEL_VOICE_FALLBACK = 'gemini-test-fallback';
  const calls: string[] = [];
  const result = await analyzeAudioScam(payload(), { generate: async params => {
    calls.push(params.model);
    assert.equal(params.config?.responseMimeType, 'application/json');
    assert.ok(params.config?.abortSignal);
    if (calls.length === 1) throw new Error('provider unavailable');
    return { text: JSON.stringify(answer()) };
  } });
  assert.deepEqual(calls, ['gemini-test-primary', 'gemini-test-fallback']);
  assert.equal(result.analysisModel, 'gemini-test-fallback');
});

test('a hung provider is cancelled instead of producing a SAFE result', async () => {
  process.env.GEMINI_MODEL_VOICE = 'gemini-test'; process.env.GEMINI_MODEL_VOICE_FALLBACK = 'gemini-test';
  const started = performance.now();
  await assert.rejects(analyzeAudioScam(payload(), { budgetMs: 120, generate: () => new Promise(() => {}) }),
    (error: unknown) => error instanceof VoiceAnalysisError && error.code === 'TIMEOUT');
  assert.ok(performance.now() - started < 1000);
});

test('primary can finish at 2.5 seconds without being cut off to reserve fallback time', async t => {
  process.env.GEMINI_MODEL_VOICE = 'gemini-test-primary';
  process.env.GEMINI_MODEL_VOICE_FALLBACK = 'gemini-test-fallback';
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls: string[] = [];
  let finishPrimary!: () => void;
  const primary = new Promise<void>(resolve => { finishPrimary = resolve; });
  const pending = analyzeAudioScam(payload(), { generate: async params => {
    calls.push(params.model);
    if (calls.length === 1) await primary;
    return { text: JSON.stringify(answer()) };
  } });
  t.mock.timers.tick(2500);
  finishPrimary();
  const result = await pending;
  assert.deepEqual(calls, ['gemini-test-primary']);
  assert.equal(result.analysisModel, 'gemini-test-primary');
});

test('caller cancellation is respected without making a provider call', async () => {
  let called = false;
  await assert.rejects(analyzeAudioScam(payload(), { signal: AbortSignal.abort(), generate: async () => {
    called = true; return { text: JSON.stringify(answer()) };
  } }));
  assert.equal(called, false);
});

test('HTTP route validates payload, caps body size, and never echoes upstream secrets', async () => {
  delete process.env.VOICE_API_TOKEN; process.env.NODE_ENV = 'test';
  const app = createApp({ analyzeVoice: async () => parseVoiceResult(JSON.stringify(answer()), 'test', 1) });
  const post = (body: string) => app.request('/api/v1/analyze-voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const good = await post(JSON.stringify(payload()));
  assert.equal(good.status, 200); assert.equal(good.headers.get('Cache-Control'), 'no-store');
  assert.equal((await good.json()).syntheticVoiceProbability, null);
  assert.equal((await post('{')).status, 400);
  const denied = await app.request('/api/v1/analyze-voice', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: JSON.stringify(payload()) });
  assert.equal(denied.status, 403);
  assert.equal((await post(JSON.stringify({ audioBase64: 'A'.repeat(230000), mimeType: 'audio/wav' }))).status, 413);
  const failing = createApp({ analyzeVoice: async () => { throw new Error('SECRET_PROVIDER_KEY'); } });
  const failure = await failing.request('/api/v1/analyze-voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) });
  assert.equal(failure.status, 502); assert.ok(!(await failure.text()).includes('SECRET_PROVIDER_KEY'));
});

test('production requires access token; configured token is checked before provider calls', async () => {
  process.env.NODE_ENV = 'production'; delete process.env.VOICE_API_TOKEN;
  const app = createApp({ analyzeVoice: async () => parseVoiceResult(JSON.stringify(answer()), 'test', 1) });
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) };
  assert.equal((await app.request('/api/v1/analyze-voice', init)).status, 503);
  process.env.VOICE_API_TOKEN = 'test-only-token';
  assert.equal((await app.request('/api/v1/analyze-voice', init)).status, 401);
  assert.equal((await app.request('/api/v1/analyze-voice', { ...init, headers: { ...init.headers, Authorization: 'Bearer test-only-token' } })).status, 200);
});


test('a tactic needs a unique supporting quote from the returned transcript', () => {
  for (const tacticEvidence of [undefined, [], [{ tactic: 'OTP_OR_CREDENTIAL_ASK', quote: 'Chuyển tiền ngay cho tôi' }],
    [{ tactic: 'OTP_OR_CREDENTIAL_ASK', quote: 'OTP' }],
    [{ tactic: 'CEO_FRAUD', quote: 'Hãy đọc mã OTP 123456' }],
    [{ tactic: 'OTP_OR_CREDENTIAL_ASK', quote: 'Hãy đọc mã OTP 123456' }, { tactic: 'OTP_OR_CREDENTIAL_ASK', quote: 'Hãy đọc mã OTP 123456' }]]) {
    const result = parseVoiceResult(JSON.stringify({ ...answer(), tacticEvidence }), 'test', 1);
    assert.equal(result.verdict, 'UNKNOWN'); assert.equal(result.riskScore, null);
    assert.deepEqual(result.detectedTactics, []); assert.deepEqual(result.tacticEvidence, []);
  }
  const result = parseVoiceResult(JSON.stringify(answer()), 'test', 1);
  assert.equal(result.tacticEvidence?.[0].quote, 'Hãy đọc mã OTP [ĐÃ ẨN]');
});

test('unsupported high-risk content does not become a confident warning or SAFE', () => {
  for (const verdict of ['SAFE', 'SUSPICIOUS', 'DEEPFAKE_SCAM']) {
    const result = parseVoiceResult(JSON.stringify({ ...answer(), verdict, detectedTactics: [], tacticEvidence: [] }), 'test', 1);
    assert.equal(result.verdict, 'UNKNOWN'); assert.equal(result.riskScore, null);
  }
  const benign = parseVoiceResult(JSON.stringify({ ...answer(), riskScore: 0, verdict: 'SAFE', detectedTactics: [], tacticEvidence: [] }), 'test', 1);
  assert.equal(benign.verdict, 'SAFE');
});

test('malformed evidence is rejected and normalization tolerates case and punctuation only', () => {
  for (const tacticEvidence of [null, 'quote', [{ tactic: 'MADE_UP', quote: 'Hãy đọc mã OTP' }],
    [{ tactic: 'OTP_OR_CREDENTIAL_ASK', quote: 'x'.repeat(161) }]]) {
    assert.throws(() => parseVoiceResult(JSON.stringify({ ...answer(), tacticEvidence }), 'test', 1), VoiceAnalysisError);
  }
  const result = parseVoiceResult(JSON.stringify({ ...answer(), tacticEvidence: [{ tactic: 'OTP_OR_CREDENTIAL_ASK', quote: 'HÃY ĐỌC, mã OTP 123456' }] }), 'test', 1);
  assert.equal(result.verdict, 'SUSPICIOUS');
});

test('compact provider findings become checked evidence and server-authored advice', () => {
  const result = parseVoiceResult(JSON.stringify({ speechAct: 'DIRECT_REQUEST', transcriptSnippet: 'Đọc mã OTP 123456 ngay.',
    riskScore: 90, verdict: 'DEEPFAKE_SCAM', audioQuality: 'CLEAR',
    findings: [{ tactic: 'OTP_OR_CREDENTIAL_ASK', quote: 'Đọc mã OTP 123456 ngay' }] }), 'test', 1);
  assert.equal(result.verdict, 'DEEPFAKE_SCAM');
  assert.deepEqual(result.detectedTactics, ['OTP_OR_CREDENTIAL_ASK']);
  assert.equal(result.syntheticVoiceProbability, null);
  assert.ok(result.warningMessageVi.includes('Không chia sẻ OTP'));
  assert.ok(!JSON.stringify(result).includes('123456'));
});

test('a quoted example or safety advice cannot also assert a direct scam request', () => {
  for (const speechAct of ['QUOTED_EXAMPLE', 'SAFETY_ADVICE', 'ORDINARY', 'UNCLEAR']) {
    const result = parseVoiceResult(JSON.stringify({ speechAct, transcriptSnippet: 'Đừng đọc mã OTP cho người lạ.',
      riskScore: 95, verdict: 'DEEPFAKE_SCAM', audioQuality: 'CLEAR',
      findings: [{ tactic: 'OTP_OR_CREDENTIAL_ASK', quote: 'đọc mã OTP cho người lạ' }] }), 'test', 1);
    assert.equal(result.verdict, 'UNKNOWN'); assert.equal(result.riskScore, null);
    assert.deepEqual(result.detectedTactics, []);
  }
  const benign = parseVoiceResult(JSON.stringify({ speechAct: 'SAFETY_ADVICE', transcriptSnippet: 'Đừng đọc mã OTP cho người lạ.',
    riskScore: 0, verdict: 'SAFE', audioQuality: 'CLEAR', findings: [] }), 'test', 1);
  assert.equal(benign.verdict, 'SAFE');
});


test('review is explicit, bounded and validated before provider calls', () => {
  assert.equal(parseVoiceRequest({ ...payload(), analysisMode: 'review' }).analysisMode, 'review');
  assert.equal(parseVoiceRequest(payload()).analysisMode, undefined);
  for (const analysisMode of ['slow', 15000, null]) assert.throws(() => parseVoiceRequest({ ...payload(), analysisMode }));
});

test('review allows a response beyond the live deadline and uses one configured model', async t => {
  process.env.GEMINI_MODEL_VOICE_REVIEW = 'gemini-test-review';
  process.env.GEMINI_MODEL_VOICE_FALLBACK = 'gemini-test-review';
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls: string[] = [];
  const pending = analyzeAudioScam({ ...payload(), analysisMode: 'review' }, { generate: async params => {
    calls.push(params.model); assert.equal(params.config?.httpOptions?.timeout, 15000);
    await new Promise(resolve => setTimeout(resolve, 4500));
    return { text: JSON.stringify(answer()) };
  } });
  t.mock.timers.tick(4500);
  const result = await pending;
  assert.equal(result.verdict, 'SUSPICIOUS'); assert.deepEqual(calls, ['gemini-test-review']);
});

test('review budget cannot exceed fifteen seconds and never retries after deadline', async t => {
  process.env.GEMINI_MODEL_VOICE_REVIEW = 'gemini-test-review-timeout';
  process.env.GEMINI_MODEL_VOICE_FALLBACK = 'gemini-test-review-timeout';
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const pending = analyzeAudioScam({ ...payload(), analysisMode: 'review' }, { budgetMs: 60000,
    generate: async () => { calls++; return new Promise(() => {}); } });
  const rejection = assert.rejects(pending, (error: unknown) => error instanceof VoiceAnalysisError && error.code === 'TIMEOUT');
  t.mock.timers.tick(15000);
  await rejection; assert.equal(calls, 1);
});

test('quota errors are typed without exposing the provider message', async () => {
  process.env.GEMINI_MODEL_VOICE = 'gemini-test'; process.env.GEMINI_MODEL_VOICE_FALLBACK = 'gemini-test';
  await assert.rejects(analyzeAudioScam(payload(), { generate: async () => { throw Object.assign(new Error('SECRET_PROVIDER_DETAIL'), { status: 429 }); } }),
    (error: unknown) => error instanceof VoiceAnalysisError && error.code === 'RATE_LIMITED' && !error.message.includes('SECRET'));
});

test('an explicitly unclear speech act cannot return SAFE even with no findings', () => {
  const result = parseVoiceResult(JSON.stringify({ speechAct: 'UNCLEAR', transcriptSnippet: 'Không rõ ngữ cảnh.',
    riskScore: 0, verdict: 'SAFE', audioQuality: 'CLEAR', findings: [] }), 'test', 1);
  assert.equal(result.verdict, 'UNKNOWN'); assert.equal(result.riskScore, null);
});


test('live and review share one default model, while explicit routes remain configurable', () => {
  delete process.env.GEMINI_MODEL_VOICE; delete process.env.GEMINI_MODEL_VOICE_REVIEW; delete process.env.GEMINI_MODEL_VOICE_FALLBACK; delete process.env.GEMINI_MODEL_VOICE_LIVE_FALLBACK;
  process.env.NODE_ENV = 'production';
  assert.deepEqual(voiceModelRoute({}), ['gemini-3.8-live-extended-thinking', 'gemini-3.8-live', 'gemini-3.5-flash-lite']);
  assert.deepEqual(voiceModelRoute({ analysisMode: 'review' }), ['gemini-3.8-live-extended-thinking', 'gemini-3.8-live', 'gemini-3.5-flash-lite']);
  process.env.GEMINI_MODEL_VOICE = 'gemini-explicit'; process.env.GEMINI_MODEL_VOICE_FALLBACK = 'gemini-explicit';
  assert.deepEqual(voiceModelRoute({}), ['gemini-explicit']);
  process.env.GEMINI_MODEL_VOICE_REVIEW = 'gemini-review';
  assert.deepEqual(voiceModelRoute({ analysisMode: 'review' }), ['gemini-review', 'gemini-explicit']);
});


test('urgency without a sensitive action cannot warn about an ordinary deadline', () => {
  for (const transcriptSnippet of ['Nhớ tham gia cuộc họp gấp chiều nay nhé.', 'Mau hoàn thành báo cáo ngay nhé.', 'Khẩn trương tới sân bóng ngay nhé.']) {
    const result = parseVoiceResult(JSON.stringify({ speechAct: 'DIRECT_REQUEST', transcriptSnippet, riskScore: 30,
      verdict: 'SUSPICIOUS', audioQuality: 'CLEAR', findings: [{ tactic: 'URGENCY_PRESSURE', quote: transcriptSnippet }] }), 'test', 1);
    assert.equal(result.verdict, 'UNKNOWN'); assert.equal(result.riskScore, null);
    assert.deepEqual(result.detectedTactics, []);
  }
  for (const transcriptSnippet of ['Chuyển tiền ngay, đừng gọi lại.', 'Nộp phí ngay nếu không bị bắt.', 'Đọc mã xác nhận ngay cho tôi.']) {
    const result = parseVoiceResult(JSON.stringify({ speechAct: 'DIRECT_REQUEST', transcriptSnippet, riskScore: 90,
      verdict: 'SUSPICIOUS', audioQuality: 'CLEAR', findings: [{ tactic: 'URGENCY_PRESSURE', quote: transcriptSnippet }] }), 'test', 1);
    assert.equal(result.verdict, 'SUSPICIOUS');
  }
});


test('three transient provider errors skip calls during cooldown and recover with one probe', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  process.env.GEMINI_MODEL_VOICE = 'gemini-circuit-recovery';
  process.env.GEMINI_MODEL_VOICE_FALLBACK = 'gemini-circuit-recovery';
  let calls = 0;
  let failing = true;
  const generate = async () => {
    calls++;
    if (failing) throw Object.assign(new Error('private upstream detail'), { status: 503 });
    return { text: JSON.stringify(answer()) };
  };
  for (let i = 0; i < 3; i++) await assert.rejects(analyzeAudioScam(payload(), { generate }), VoiceAnalysisError);
  await assert.rejects(analyzeAudioScam(payload(), { generate }), (e: unknown) => e instanceof VoiceAnalysisError && e.code === 'PROVIDER_ERROR');
  assert.equal(calls, 3);
  t.mock.timers.tick(29999);
  await assert.rejects(analyzeAudioScam(payload(), { generate })); assert.equal(calls, 3);
  t.mock.timers.tick(1); failing = false;
  assert.equal((await analyzeAudioScam(payload(), { generate })).verdict, 'SUSPICIOUS');
  assert.equal((await analyzeAudioScam(payload(), { generate })).verdict, 'SUSPICIOUS');
  assert.equal(calls, 5);
});

test('only one recovery probe runs and a failed probe reopens the cooldown', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 200000 });
  process.env.GEMINI_MODEL_VOICE = 'gemini-circuit-probe';
  process.env.GEMINI_MODEL_VOICE_FALLBACK = 'gemini-circuit-probe';
  let calls = 0;
  const failure = () => Object.assign(new Error('private quota detail'), { status: 429 });
  const fail = async () => { calls++; throw failure(); };
  for (let i = 0; i < 3; i++) await assert.rejects(analyzeAudioScam(payload(), { generate: fail }));
  t.mock.timers.tick(30000);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const probe = analyzeAudioScam(payload(), { generate: async () => { calls++; await waiting; throw failure(); } });
  await assert.rejects(analyzeAudioScam(payload(), { generate: fail }), (e: unknown) => e instanceof VoiceAnalysisError && e.code === 'RATE_LIMITED');
  assert.equal(calls, 4);
  release(); await assert.rejects(probe);
  await assert.rejects(analyzeAudioScam(payload(), { generate: fail })); assert.equal(calls, 4);
});

test('a cooling primary does not block a healthy fallback or leak state to another model', async () => {
  process.env.GEMINI_MODEL_VOICE = 'gemini-circuit-primary';
  process.env.GEMINI_MODEL_VOICE_FALLBACK = 'gemini-circuit-fallback';
  const calls: string[] = [];
  const generate = async (params: { model: string }) => {
    calls.push(params.model);
    if (params.model === 'gemini-circuit-primary') throw Object.assign(new Error('overloaded'), { status: 503 });
    return { text: JSON.stringify(answer()) };
  };
  for (let i = 0; i < 4; i++) assert.equal((await analyzeAudioScam(payload(), { generate })).analysisModel, 'gemini-circuit-fallback');
  assert.equal(calls.filter(m => m === 'gemini-circuit-primary').length, 3);
  assert.equal(calls.filter(m => m === 'gemini-circuit-fallback').length, 4);
  process.env.GEMINI_MODEL_VOICE = 'gemini-circuit-unrelated';
  assert.equal((await analyzeAudioScam(payload(), { generate })).analysisModel, 'gemini-circuit-unrelated');
});

test('caller cancellation and invalid JSON do not open the provider outage cooldown', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  process.env.GEMINI_MODEL_VOICE = 'gemini-circuit-cancelled';
  process.env.GEMINI_MODEL_VOICE_FALLBACK = 'gemini-circuit-cancelled';
  let calls = 0;
  for (let i = 0; i < 3; i++) {
    const caller = new AbortController();
    const pending = analyzeAudioScam(payload(), { signal: caller.signal, generate: async () => { calls++; return new Promise(() => {}); } });
    caller.abort(); await assert.rejects(pending);
  }
  for (let i = 0; i < 3; i++) await assert.rejects(analyzeAudioScam(payload(), { generate: async () => { calls++; return { text: 'invalid JSON' }; } }),
    (e: unknown) => e instanceof VoiceAnalysisError && e.code === 'INVALID_RESULT');
  assert.equal((await analyzeAudioScam(payload(), { generate: async () => { calls++; return { text: JSON.stringify(answer()) }; } })).verdict, 'SUSPICIOUS');
  assert.equal(calls, 7);
});


test('provider cooldown preserves local evidence through the full coordinator', async () => {
  process.env.GEMINI_MODEL_VOICE = 'gemini-circuit-hybrid';
  process.env.GEMINI_MODEL_VOICE_FALLBACK = 'gemini-circuit-hybrid';
  let calls = 0;
  for (let i = 0; i < 5; i++) {
    const result = await analyzeVoiceWithAcoustic(payload(), new AbortController().signal, {
      content: (input, signal) => analyzeAudioScam(input, { signal, generate: async () => {
        calls++; throw Object.assign(new Error('private overload detail'), { status: 503 });
      } }),
      acoustic: async () => ({ status: 'AVAILABLE', source: 'LOCAL_XLSR_AASIST', score: .9,
        scoreCalibrated: false, verdict: 'SYNTHETIC_SUSPECTED', modelVersion: 'b'.repeat(64), executionTimeMs: 300 }),
    });
    assert.equal(result.verdict, 'UNKNOWN'); assert.equal(result.riskScore, null);
    assert.equal(result.assessmentSource, 'LOCAL_ACOUSTIC');
    assert.deepEqual(result.contentAnalysis, { status: 'UNAVAILABLE', reason: 'PROVIDER_ERROR' });
    assert.equal(result.acousticAnalysis?.verdict, 'SYNTHETIC_SUSPECTED');
    assert.ok(!JSON.stringify(result).includes('private'));
  }
  assert.equal(calls, 3);
});

test('owned deadlines open cooldown while user cancellation releases a recovery probe', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 400000 });
  process.env.GEMINI_MODEL_VOICE = 'gemini-circuit-timeout';
  process.env.GEMINI_MODEL_VOICE_FALLBACK = 'gemini-circuit-timeout';
  let calls = 0;
  const hung = async () => { calls++; return new Promise<never>(() => {}); };
  for (let i = 0; i < 3; i++) {
    const pending = analyzeAudioScam(payload(), { budgetMs: 120, generate: hung });
    const failed = assert.rejects(pending, (e: unknown) => e instanceof VoiceAnalysisError && e.code === 'TIMEOUT');
    t.mock.timers.tick(120); await failed;
  }
  await assert.rejects(analyzeAudioScam(payload(), { generate: hung })); assert.equal(calls, 3);
  t.mock.timers.tick(30000);
  const caller = new AbortController();
  const probe = analyzeAudioScam(payload(), { signal: caller.signal, generate: hung });
  caller.abort(); await assert.rejects(probe); assert.equal(calls, 4);
  assert.equal((await analyzeAudioScam(payload(), { generate: async () => { calls++; return { text: JSON.stringify(answer()) }; } })).verdict, 'SUSPICIOUS');
  assert.equal(calls, 5);
});


test('default HTTP strategy returns Gemini synthesis and never contacts a configured local worker', async () => {
  const oldSocket=globalThis.WebSocket,oldFetch=globalThis.fetch;
  let localCalls=0;
  class TaskSocket extends EventTarget {
    static fail=false;readyState=0;binaryType: BinaryType='arraybuffer';task=false;
    constructor(_url:string|URL){super();queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}
    close(){this.readyState=3;}
    receive(value:unknown){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}
    send(data:string){const m=JSON.parse(data);
      if(m.setup){this.task=m.setup.systemInstruction.parts[0].text.includes('p is your uncalibrated');queueMicrotask(()=>this.receive(TaskSocket.fail?{error:{code:503}}:{setupComplete:{}}));}
      if(m.realtimeInput?.activityEnd)queueMicrotask(()=>this.receive({serverContent:{inputTranscription:{text:'Hãy đọc mã OTP 123456.',finished:true}}}));
      if(m.clientContent)queueMicrotask(()=>this.receive({serverContent:{outputTranscription:{text:JSON.stringify({a:0,v:1,r:90,q:0,f:[[2,'Hãy đọc mã OTP']],...(this.task?{p:.05}:{})})},interactionStatus:'IDLE'}}));
    }
  }
  globalThis.WebSocket=TaskSocket as unknown as typeof WebSocket;
  globalThis.fetch=async()=>{localCalls++;return new Response(JSON.stringify({status:'AVAILABLE',source:'LOCAL_XLSR_AASIST',score:.95,scoreCalibrated:false,verdict:'SYNTHETIC_SUSPECTED',modelVersion:'a'.repeat(64),executionTimeMs:1}));};
  process.env.GEMINI_API_KEY='fixture-only';process.env.GEMINI_MODEL_VOICE='gemini-task-http-live-extended-thinking';
  delete process.env.VOICE_ANALYSIS_STRATEGY;delete process.env.VOICE_API_TOKEN;process.env.NODE_ENV='test';
  process.env.VOICE_ACOUSTIC_URL='http://127.0.0.1:8081';
  const post=()=>createApp().request('/api/v1/analyze-voice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload())});
  try{
    const response=await post();assert.equal(response.status,200);const body=await response.json();
    assert.equal(body.syntheticVoiceProbability,.05);assert.equal(body.verdict,'SUSPICIOUS');assert.equal(body.assessmentSource,'GEMINI_AUDIO');
    assert.equal(body.acousticAnalysis,undefined);assert.equal(localCalls,0);assert.equal(body.fallbackUsed,false);
    process.env.VOICE_ANALYSIS_STRATEGY='hybrid';
    const hybrid=await post();assert.equal(hybrid.status,200);const both=await hybrid.json();
    assert.equal(both.syntheticVoiceProbability,null);assert.equal(both.acousticAnalysis.score,.95);assert.equal(both.assessmentSource,'HYBRID_AUDIO');assert.equal(localCalls,1);
    process.env.VOICE_ANALYSIS_STRATEGY='gemini';process.env.GEMINI_MODEL_VOICE_LIVE_FALLBACK=process.env.GEMINI_MODEL_VOICE;process.env.GEMINI_MODEL_VOICE_FALLBACK=process.env.GEMINI_MODEL_VOICE;TaskSocket.fail=true;
    const failed=await post();assert.equal(failed.status,502);const failure=await failed.json();assert.equal(failure.error.code,'PROVIDER_ERROR');assert.equal(failure.verdict,undefined);assert.equal(localCalls,1);
  }finally{globalThis.WebSocket=oldSocket;globalThis.fetch=oldFetch;}
});
