import { VOICE_ANALYSIS_TIMEOUTS } from '@zeroleak/shared-types';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AcousticVoiceAnalysis, AnalyzeVoiceRequest, VoiceScamAnalysisResult } from '@zeroleak/shared-types';
import { VoiceAnalysisError } from '../src/voice-analyzer.js';
import { analyzeVoiceWithAcoustic, analyzeLocalAcoustic, localAcousticEndpoint, validateAcousticResult, voiceAcousticWindows } from '../src/voice-acoustic.js';

function audio(seconds=1,review=false):AnalyzeVoiceRequest{
 const wav=Buffer.alloc(44+Math.round(seconds*16000)*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
 wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
 for(let i=44;i<wav.length;i+=2)wav.writeInt16LE(4000,i);
 return {mimeType:'audio/wav',audioBase64:wav.toString('base64'),...(review?{analysisMode:'review' as const}:{})};
}
const input=audio();
const acoustic = (score: number | null = .95): AcousticVoiceAnalysis => ({ status: 'AVAILABLE', score,
  verdict: score === null ? 'UNKNOWN' : score >= .8 ? 'SYNTHETIC_SUSPECTED' : score <= .2 ? 'NO_SYNTHETIC_EVIDENCE' : 'UNKNOWN',
  scoreCalibrated: false, source: 'LOCAL_XLSR_AASIST', modelVersion: 'a'.repeat(64), executionTimeMs: 450 });
const content = (): VoiceScamAnalysisResult => ({ riskScore: 0, verdict: 'SAFE', syntheticVoiceProbability: null,
  detectedTactics: [], transcriptSnippet: 'Lịch họp ngày mai.', warningMessageVi: 'Chưa thấy dấu hiệu trong lời thoại.',
  executionTimeMs: 1000, audioQuality: 'CLEAR', assessmentSource: 'GEMINI_AUDIO', analysisModel: 'fixture' });

test('local model input can only be sent to numeric loopback with no redirects or credentials', () => {
  assert.equal(localAcousticEndpoint('http://127.0.0.1:8081'), 'http://127.0.0.1:8081/analyze');
  for (const url of ['https://example.com', 'http://example.com', 'http://localhost:8081',
    'http://user:pass@127.0.0.1:8081', 'http://127.0.0.1:8081/?x=1', 'http://127.0.0.1:8081/path']) {
    assert.throws(() => localAcousticEndpoint(url));
  }
});

test('acoustic schema checks score, version, calibration claim and contradictory verdicts', () => {
  for (const score of [null, .1, .5, .95]) assert.deepEqual(validateAcousticResult(acoustic(score)), acoustic(score));
  for (const patch of [{ score: NaN }, { score: 1.1 }, { scoreCalibrated: true }, { modelVersion: 'unknown' },
    { score: null, verdict: 'NO_SYNTHETIC_EVIDENCE' }, { score: .95, verdict: 'NO_SYNTHETIC_EVIDENCE' }]) {
    assert.throws(() => validateAcousticResult({ ...acoustic(), ...patch }));
  }
});

test('AI voice with benign content does not become a scam verdict', async () => {
  const result = await analyzeVoiceWithAcoustic(input, new AbortController().signal,
    { content: async () => content(), acoustic: async () => acoustic() });
  assert.equal(result.verdict, 'SAFE'); assert.equal(result.riskScore, 0);
  assert.equal(result.assessmentSource, 'HYBRID_AUDIO');
  assert.equal(result.acousticAnalysis?.status, 'AVAILABLE');
  assert.equal(result.syntheticVoiceProbability, null);
});

test('a scam spoken by a low-scoring voice still gets a content warning', async () => {
  const result = await analyzeVoiceWithAcoustic(input, new AbortController().signal, {
    content: async () => ({ ...content(), riskScore: 90, verdict: 'SUSPICIOUS', detectedTactics: ['OTP_OR_CREDENTIAL_ASK'] }),
    acoustic: async () => acoustic(.05),
  });
  assert.equal(result.verdict, 'SUSPICIOUS'); assert.equal(result.riskScore, 90);
  assert.deepEqual(result.detectedTactics, ['OTP_OR_CREDENTIAL_ASK']);
});

test('quota failure preserves only the independently available acoustic result', async () => {
  const result = await analyzeVoiceWithAcoustic(input, new AbortController().signal, {
    content: async () => { throw new Error('provider quota'); }, acoustic: async () => acoustic(),
  });
  assert.equal(result.assessmentSource, 'LOCAL_ACOUSTIC'); assert.equal(result.verdict, 'UNKNOWN');
  assert.equal(result.riskScore, null); assert.equal(result.syntheticVoiceProbability, null);
  assert.equal(result.transcriptSnippet, ''); assert.deepEqual(result.detectedTactics, []);
  assert.equal(result.acousticAnalysis?.status, 'AVAILABLE');
});

test('local detector failure leaves a content result with an explicit unavailable state', async () => {
  const result = await analyzeVoiceWithAcoustic(input, new AbortController().signal, {
    content: async () => content(), acoustic: async () => { throw new Error('offline'); },
  });
  assert.equal(result.assessmentSource, 'GEMINI_AUDIO');
  assert.deepEqual(result.acousticAnalysis, { status: 'UNAVAILABLE' });
  await assert.rejects(analyzeVoiceWithAcoustic(input, new AbortController().signal, {
    content: async () => { throw new Error('offline'); }, acoustic: async () => { throw new Error('offline'); },
  }));
});

test('both analyzers begin before either finishes and caller cancellation never returns a result', async () => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const started: string[] = [];
  const controller = new AbortController();
  const pending = analyzeVoiceWithAcoustic(input, controller.signal, {
    content: async () => { started.push('content'); await waiting; return content(); },
    acoustic: async () => { started.push('acoustic'); await waiting; return acoustic(); },
  });
  assert.deepEqual(started, ['content', 'acoustic']);
  controller.abort(); release(); await assert.rejects(pending);
});

test('provider unavailability is distinct from semantic uncertainty and preserves acoustic evidence', async () => {
  const result = await analyzeVoiceWithAcoustic(input, new AbortController().signal, {
    content: async () => { throw new VoiceAnalysisError('RATE_LIMITED'); },
    acoustic: async () => acoustic(.9),
  });
  assert.deepEqual(result.contentAnalysis, { status: 'UNAVAILABLE', reason: 'RATE_LIMITED' });
  assert.equal(result.verdict, 'UNKNOWN'); assert.equal(result.riskScore, null);
  assert.equal(result.acousticAnalysis?.status, 'AVAILABLE');
});


test('review allows a cold local response but live capture keeps its 2.8s deadline', async t => {
  const originalFetch = globalThis.fetch;
  const originalEndpoint = process.env.VOICE_ACOUSTIC_URL;
  process.env.VOICE_ACOUSTIC_URL = 'http://127.0.0.1:8081';
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.fetch = async (_url, init) => new Promise((resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    setTimeout(() => resolve(new Response(JSON.stringify(acoustic(.95)))), 3500);
  });
  try {
    const review = analyzeLocalAcoustic({ ...input, analysisMode: 'review' }, new AbortController().signal);
    t.mock.timers.tick(3500); assert.equal((await review).status, 'AVAILABLE');
    const live = analyzeLocalAcoustic(input, new AbortController().signal);
    const rejection = assert.rejects(live);
    t.mock.timers.tick(2800); await rejection;
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEndpoint === undefined) delete process.env.VOICE_ACOUSTIC_URL; else process.env.VOICE_ACOUSTIC_URL = originalEndpoint;
  }
});

test('a hanging content branch cannot discard completed acoustic evidence at the collection deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let child: AbortSignal | undefined;
  const pending = analyzeVoiceWithAcoustic(input, new AbortController().signal, {
    content: async (_input, signal) => { child = signal; return new Promise(() => {}); },
    acoustic: async () => acoustic(.95),
  });
  await Promise.resolve(); t.mock.timers.tick(VOICE_ANALYSIS_TIMEOUTS.realtime.model);
  await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(20);
  const result = await pending;
  assert.equal(result.assessmentSource, 'LOCAL_ACOUSTIC');
  assert.equal(result.acousticAnalysis?.status, 'AVAILABLE');
  assert.deepEqual(result.contentAnalysis, { status: 'UNAVAILABLE', reason: 'TIMEOUT' });
  assert.equal(child?.aborted, true);
});

test('a hanging acoustic branch cannot discard completed content at the collection deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = analyzeVoiceWithAcoustic(input, new AbortController().signal, {
    content: async () => content(), acoustic: async () => new Promise(() => {}),
  });
  await Promise.resolve(); t.mock.timers.tick(VOICE_ANALYSIS_TIMEOUTS.realtime.model);
  const result = await pending;
  assert.equal(result.assessmentSource, 'GEMINI_AUDIO'); assert.equal(result.verdict, 'SAFE');
  assert.deepEqual(result.acousticAnalysis, { status: 'UNAVAILABLE' });
});

test('caller cancellation is immediate even when analyzers ignore abort', async () => {
  const controller = new AbortController();
  const pending = analyzeVoiceWithAcoustic(input, controller.signal, {
    content: async () => new Promise(() => {}), acoustic: async () => new Promise(() => {}),
  });
  controller.abort(); await assert.rejects(pending);
  let invoked = false;
  await assert.rejects(analyzeVoiceWithAcoustic(input, controller.signal, {
    content: async () => { invoked = true; return content(); }, acoustic: async () => acoustic(),
  }));
  assert.equal(invoked, false);
});

test('a busy local worker is retried once within the existing budget, not indefinitely', async t => {
  const originalFetch = globalThis.fetch; const originalEndpoint = process.env.VOICE_ACOUSTIC_URL;
  process.env.VOICE_ACOUSTIC_URL = 'http://127.0.0.1:8081';
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  try {
    globalThis.fetch = async () => ++calls === 1 ? new Response('{}', { status: 429 }) : new Response(JSON.stringify(acoustic(.9)));
    const pending = analyzeLocalAcoustic(input, new AbortController().signal);
    await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(200);
    assert.equal((await pending).status, 'AVAILABLE'); assert.equal(calls, 2);
    calls = 0; globalThis.fetch = async () => { calls++; return new Response('{}', { status: 429 }); };
    const unavailable = analyzeLocalAcoustic(input, new AbortController().signal);
    const rejected = assert.rejects(unavailable);
    await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(200);
    await rejected; assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEndpoint === undefined) delete process.env.VOICE_ACOUSTIC_URL; else process.env.VOICE_ACOUSTIC_URL = originalEndpoint;
  }
});


test('hybrid retains a Gemini result that arrives after the obsolete3.1s cutoff',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let settled=false;
 const pending=analyzeVoiceWithAcoustic(input,new AbortController().signal,{
  content:async()=>{await new Promise(resolve=>setTimeout(resolve,4500));return content();},
  acoustic:async()=>acoustic(.95),
 });
 void pending.then(()=>{settled=true;});
 await Promise.resolve();t.mock.timers.tick(3100);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(settled,false);t.mock.timers.tick(1400);
 const result=await pending;assert.equal(result.assessmentSource,'HYBRID_AUDIO');
 assert.equal(result.contentAnalysis?.status,'AVAILABLE');assert.equal(result.verdict,'SAFE');
 assert.equal(result.acousticAnalysis?.status,'AVAILABLE');
});


test('review acoustic windows cover the whole15s file and retain a short last tail',()=>{
 for(const seconds of [5.1,7,10.1,10.6,15]){
  const source=audio(seconds,true),windows=voiceAcousticWindows(source),data=Buffer.from(source.audioBase64,'base64').subarray(44);
  assert.equal(windows.length,Math.ceil(seconds/5));
  const last=Buffer.from(windows.at(-1)!.audioBase64,'base64').subarray(44);
  assert.ok(last.length>=16000&&last.length<=160000);
  assert.deepEqual(last,data.subarray(data.length-last.length));
 }
});

test('a synthetic segment at the end is retained and missing speech cannot create a low score',async()=>{
 const previous=globalThis.fetch,endpoint=process.env.VOICE_ACOUSTIC_URL;process.env.VOICE_ACOUSTIC_URL='http://127.0.0.1:8081';
 try{
  let calls=0;const scores=[.05,.1,.95];globalThis.fetch=async(_url,init)=>{assert.ok(JSON.parse(String(init?.body)).audioBase64.length<=213392);return new Response(JSON.stringify(acoustic(scores[calls++])));};
  const detected=await analyzeLocalAcoustic(audio(15,true),new AbortController().signal);
  assert.equal(calls,3);assert.equal(detected.status,'AVAILABLE');if(detected.status==='AVAILABLE'){assert.equal(detected.score,.95);assert.equal(detected.windowCount,3);assert.equal(detected.audioDurationSeconds,15);}
  calls=0;globalThis.fetch=async()=>new Response(JSON.stringify(acoustic(calls++===0?.05:null)));
  const uncertain=await analyzeLocalAcoustic(audio(10,true),new AbortController().signal);
  assert.equal(uncertain.status,'AVAILABLE');if(uncertain.status==='AVAILABLE'){assert.equal(uncertain.verdict,'UNKNOWN');assert.equal(uncertain.score,null);}
 }finally{globalThis.fetch=previous;if(endpoint===undefined)delete process.env.VOICE_ACOUSTIC_URL;else process.env.VOICE_ACOUSTIC_URL=endpoint;}
});
