import { VOICE_ANALYSIS_TIMEOUTS } from '@zeroleak/shared-types';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { AnalyzeVoiceRequest } from '@zeroleak/shared-types';
import { analyzeLiveVoice, createVoiceLiveSetup, type VoiceSocketFactory } from '../src/voice-live.js';
import { analyzeAudioScam, VoiceAnalysisError } from '../src/voice-analyzer.js';
import { analyzeVoiceWithAcoustic } from '../src/voice-acoustic.js';

const original = { ...process.env };
afterEach(() => { process.env = { ...original }; });
const EXTENDED = 'gemini-3.8-live-extended-thinking';

function input(metadata = false): AnalyzeVoiceRequest {
  const wav = Buffer.alloc(32044);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(32000, 40);
  for (let i = 0; i < 16000; i++) wav.writeInt16LE(Math.round(Math.sin(i * .1) * 8000), 44 + i * 2);
  if (!metadata) return { mimeType: 'audio/wav', audioBase64: wav.toString('base64') };
  const junk = Buffer.alloc(12); junk.write('JUNK'); junk.writeUInt32LE(4, 4);
  const extended = Buffer.concat([wav.subarray(0, 36), junk, wav.subarray(36)]);
  extended.writeUInt32LE(extended.length - 8, 4);
  return { mimeType: 'audio/wav', audioBase64: extended.toString('base64') };
}
function answer() {
  return { speechAct: 'DIRECT_REQUEST', transcriptSnippet: 'Đọc mã OTP ngay cho tôi.', riskScore: 90,
    verdict: 'SUSPICIOUS', audioQuality: 'CLEAR', findings: [{ tactic: 'OTP_OR_CREDENTIAL_ASK', quote: 'Đọc mã OTP ngay cho tôi' }] };
}
function compactAnswer() { return { a: 0, v: 1, r: 90, q: 0, f: [[2, 'Đọc mã OTP ngay']] }; }
function report(args: unknown = answer()) {
  return { toolCall: { functionCalls: [{ id: 'report-1', name: 'report_voice_assessment', args }] } };
}
class Socket extends EventTarget {
  readyState = 0;
  binaryType: BinaryType = 'blob';
  sent: any[] = [];
  closes = 0;
  onSend?: (message: any) => void;
  send(data: string) { const message = JSON.parse(data); this.sent.push(message); this.onSend?.(message); }
  close() { this.closes++; this.readyState = 3; }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  receive(message: unknown, binary = false) {
    const text = JSON.stringify(message);
    const bytes = new TextEncoder().encode(text);
    this.dispatchEvent(new MessageEvent('message', { data: binary ? bytes.buffer : text }));
  }
}

test('Live setup uses asynchronous reporting, manual VAD and thinking only for Extended', () => {
  const extended = createVoiceLiveSetup(EXTENDED).setup;
  assert.deepEqual(extended.generationConfig.thinkingConfig, { thinkingLevel: 'LOW' });
  assert.equal(createVoiceLiveSetup('gemini-3.8-live').setup.generationConfig.thinkingConfig, undefined);
  assert.equal(extended.tools, undefined);
  const standard = createVoiceLiveSetup('gemini-3.8-live').setup;
  assert.equal(standard.tools![0].functionDeclarations[0].behavior, 'NON_BLOCKING');
  assert.equal(standard.tools![0].functionDeclarations[0].parameters.properties.findings.type, 'ARRAY');
  assert.equal(extended.realtimeInputConfig.automaticActivityDetection.disabled, true);
  assert.ok(!('responseSchema' in extended.generationConfig));
});

test('audio waits for setup and sends exact PCM, including WAV with a metadata chunk', async () => {
  const socket = new Socket();
  const pending = analyzeLiveVoice(input(true), 'gemini-3.8-live', { socketFactory: () => socket });
  assert.equal(socket.sent.length, 0);
  socket.open(); assert.equal(socket.sent.length, 1); assert.ok(socket.sent[0].setup);
  socket.receive({ setupComplete: {} }, true);
  const frames = socket.sent.flatMap(message => message.realtimeInput?.audio ? [message.realtimeInput.audio] : []);
  assert.equal(frames.length, 10);
  assert.ok(frames.every(frame => frame.mimeType === 'audio/pcm;rate=16000' && Buffer.from(frame.data, 'base64').length <= 3200));
  assert.deepEqual(Buffer.concat(frames.map(frame => Buffer.from(frame.data, 'base64'))), Buffer.from(input().audioBase64, 'base64').subarray(44));
  assert.ok(socket.sent.some(message => message.realtimeInput?.activityStart));
  assert.ok(socket.sent.some(message => message.realtimeInput?.activityEnd));
  socket.receive(report(), true);
  const result = await pending;
  assert.equal(result.analysisModel, 'gemini-3.8-live'); assert.equal(result.analysisTransport, 'LIVE_API');
  assert.equal(result.verdict, 'SUSPICIOUS'); assert.equal(result.syntheticVoiceProbability, null);
  assert.equal(socket.closes, 1);
  assert.equal(socket.sent.at(-1).toolResponse.functionResponses[0].id, 'report-1');
});

test('Thinking turnComplete while IN_PROGRESS cannot complete the assessment', async () => {
  const socket = new Socket(); let settled = false;
  const pending = analyzeLiveVoice(input(), EXTENDED, { socketFactory: () => socket });
  void pending.then(() => { settled = true; }, () => { settled = true; });
  socket.open(); socket.receive({ setupComplete: {} });
  socket.receive({ serverContent: { inputTranscription: { text: 'Đọc mã OTP ngay cho tôi.' } } });
  socket.receive({ voiceActivity: { type: 'ACTIVITY_END' } });
  socket.receive({ serverContent: { turnComplete: true, interactionStatus: 'IN_PROGRESS' } });
  await Promise.resolve(); assert.equal(settled, false); assert.equal(socket.closes, 0);
  socket.receive({ serverContent: { outputTranscription: { text: JSON.stringify(compactAnswer()) }, turnComplete: true, interactionStatus: 'IDLE' } }); assert.equal((await pending).verdict, 'SUSPICIOUS');
});

test('abort closes a connecting socket and late setup cannot upload audio', async () => {
  const socket = new Socket(); const caller = new AbortController();
  const pending = analyzeLiveVoice(input(), EXTENDED, { signal: caller.signal, socketFactory: () => socket });
  caller.abort(); await assert.rejects(pending, (error: unknown) => error instanceof VoiceAnalysisError && error.code === 'TIMEOUT');
  socket.open(); socket.receive({ setupComplete: {} });
  assert.equal(socket.closes, 1); assert.equal(socket.sent.length, 0);
  let calls = 0;
  await assert.rejects(analyzeLiveVoice(input(), EXTENDED, { signal: AbortSignal.abort(), socketFactory: () => { calls++; return socket; } }));
  assert.equal(calls, 0);
});

test('deadline closes a socket before setup and rejects instead of fabricating SAFE', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const socket = new Socket();
  const pending = analyzeLiveVoice(input(), EXTENDED, { budgetMs: 120, socketFactory: () => socket });
  const failed = assert.rejects(pending, (error: unknown) => error instanceof VoiceAnalysisError && error.code === 'TIMEOUT');
  t.mock.timers.tick(120); await failed; assert.equal(socket.closes, 1);
});

test('invalid audio is rejected before opening a provider connection', async () => {
  let calls = 0;
  await assert.rejects(analyzeLiveVoice({ mimeType: 'audio/wav', audioBase64: 'invalid' }, EXTENDED, { socketFactory: () => { calls++; return new Socket(); } }));
  assert.equal(calls, 0);
});

test('malformed, cancelled or unexpected tools cannot yield a content assessment', async () => {
  for (const message of [report({ ...answer(), riskScore: 200 }),
    { toolCall: { functionCalls: [{ id: 'other', name: 'read_secret', args: {} }] } },
    { ...report(), toolCallCancellation: { ids: ['report-1'] } },
    { serverContent: { turnComplete: true, interactionStatus: 'IDLE' } }]) {
    const socket = new Socket();
    const pending = analyzeLiveVoice(input(), EXTENDED, { socketFactory: () => socket });
    socket.open(); socket.receive({ setupComplete: {} }); socket.receive({ serverContent: { inputTranscription: { text: 'Đọc mã OTP ngay cho tôi.', finished: true } } }); socket.receive(message);
    await assert.rejects(pending, (error: unknown) => error instanceof VoiceAnalysisError && error.code === 'INVALID_RESULT');
    assert.equal(socket.closes, 1);
  }
});

test('provider errors are typed and never expose the key-bearing URL or raw reason', async () => {
  const socket = new Socket();
  const pending = analyzeLiveVoice(input(), EXTENDED, { socketFactory: () => socket });
  socket.dispatchEvent(Object.assign(new Event('close'), { reason: 'quota exceeded SECRET_PROVIDER_DETAIL', code: 1008 }));
  await assert.rejects(pending, (error: unknown) => error instanceof VoiceAnalysisError && error.code === 'RATE_LIMITED' && !error.message.includes('SECRET'));
});

function routedFactory(fail: (model: string) => boolean, calls: string[]): VoiceSocketFactory {
  return (_url, model) => {
    calls.push(model); const socket = new Socket();
    socket.onSend = message => {
      if (message.setup) queueMicrotask(() => socket.receive(fail(model) ? { error: { code: 503 } } : { setupComplete: {} }));
      if (message.realtimeInput?.activityEnd) queueMicrotask(() => socket.receive({ serverContent: { inputTranscription: { text: 'Đọc mã OTP ngay cho tôi.', finished: true } } }));
      if (message.clientContent?.turnComplete) queueMicrotask(() => socket.receive(model.endsWith('-extended-thinking') ? { serverContent: { outputTranscription: { text: JSON.stringify(compactAnswer()) }, turnComplete: true, interactionStatus: 'IDLE' } } : report()));
    };
    queueMicrotask(() => socket.open());
    return socket;
  };
}
function route(tag: string) {
  process.env.GEMINI_MODEL_VOICE = `gemini-${tag}-live-extended-thinking`;
  process.env.GEMINI_MODEL_VOICE_LIVE_FALLBACK = `gemini-${tag}-live`;
  process.env.GEMINI_MODEL_VOICE_FALLBACK = `gemini-${tag}-flash`;
}

test('a fast Extended error falls back to Live and reports the actual successful model', async () => {
  route('fallback-live'); const calls: string[] = [];
  const result = await analyzeAudioScam(input(), { socketFactory: routedFactory(model => model.endsWith('-extended-thinking'), calls), generate: async () => { throw new Error('Unexpected Flash call'); } });
  assert.deepEqual(calls, ['gemini-fallback-live-live-extended-thinking', 'gemini-fallback-live-live']);
  assert.equal(result.analysisModel, 'gemini-fallback-live-live'); assert.equal(result.analysisTransport, 'LIVE_API');
  assert.equal(result.fallbackUsed, true);
  assert.deepEqual(result.providerAttempts?.map(attempt => attempt.status), ['FAILED', 'SUCCEEDED']);
});

test('Flash fallback is explicit and all three attempts keep their correct transports', async () => {
  route('fallback-flash'); const calls: string[] = [];
  const result = await analyzeAudioScam(input(), { socketFactory: routedFactory(() => true, calls), generate: async params => {
    calls.push(params.model); return { text: JSON.stringify(answer()) };
  } });
  assert.equal(result.analysisModel, 'gemini-fallback-flash-flash'); assert.equal(result.analysisTransport, 'GENERATE_CONTENT');
  assert.equal(result.fallbackUsed, true);
  assert.deepEqual(result.providerAttempts?.map(attempt => attempt.transport), ['LIVE_API', 'LIVE_API', 'GENERATE_CONTENT']);
  assert.deepEqual(result.providerAttempts?.map(attempt => attempt.status), ['FAILED', 'FAILED', 'SUCCEEDED']);
});

test('primary timeout cannot start fallback beyond the shared deadline', async () => {
  route('deadline'); let calls = 0;
  const started = performance.now();
  await assert.rejects(analyzeAudioScam(input(), { budgetMs: 120, socketFactory: () => { calls++; return new Socket(); }, generate: async () => { calls++; throw new Error('unexpected'); } }),
    (error: unknown) => error instanceof VoiceAnalysisError && error.code === 'TIMEOUT');
  assert.equal(calls, 1); assert.ok(performance.now() - started < 800);
});

test('failed Live attempts remain visible when only local acoustic evidence is available', async () => {
  const attempts = [{ model: EXTENDED, transport: 'LIVE_API' as const, status: 'FAILED' as const, reason: 'TIMEOUT' as const }];
  const result = await analyzeVoiceWithAcoustic(input(), new AbortController().signal, {
    content: async () => { throw new VoiceAnalysisError('TIMEOUT', attempts); },
    acoustic: async () => ({ status: 'AVAILABLE', source: 'LOCAL_XLSR_AASIST', scoreCalibrated: false,
      score: .9, verdict: 'SYNTHETIC_SUSPECTED', modelVersion: 'a'.repeat(64), executionTimeMs: 100 }),
  });
  assert.equal(result.verdict, 'UNKNOWN'); assert.equal(result.assessmentSource, 'LOCAL_ACOUSTIC');
  assert.deepEqual(result.providerAttempts, attempts);
});


test('final input acknowledgement precedes the assessment prompt and input JSON is never trusted', async () => {
  const socket = new Socket();
  const pending = analyzeLiveVoice(input(), EXTENDED, { socketFactory: () => socket });
  socket.open(); socket.receive({ setupComplete: {} });
  assert.ok(!socket.sent.some(message => message.clientContent));
  socket.receive({ serverContent: { inputTranscription: { text: JSON.stringify(answer()), finished: true } } });
  assert.equal(socket.sent.filter(message => message.clientContent?.turnComplete).length, 1);
  socket.receive({ serverContent: { turnComplete: true, interactionStatus: 'IDLE' } });
  await assert.rejects(pending, (error: unknown) => error instanceof VoiceAnalysisError && error.code === 'INVALID_RESULT');
});

test('only final model-generated JSON can be read from output transcription; fillers and thoughts are ignored', async () => {
  const socket = new Socket();
  const pending = analyzeLiveVoice(input(), EXTENDED, { socketFactory: () => socket });
  socket.open(); socket.receive({ setupComplete: {} });
  socket.receive({ serverContent: { inputTranscription: { text: 'Đọc mã OTP ngay cho tôi.', finished: true } } });
  socket.receive({ serverContent: { outputTranscription: { text: 'Đang xem xét bản ghi.' }, turnComplete: true, interactionStatus: 'IN_PROGRESS' } });
  socket.receive({ serverContent: { modelTurn: { parts: [{ thought: true, text: 'Internal reasoning' }] }, outputTranscription: { text: JSON.stringify(compactAnswer()).slice(0, 50) } } });
  socket.receive({ serverContent: { outputTranscription: { text: JSON.stringify(compactAnswer()).slice(50) }, turnComplete: true, interactionStatus: 'IDLE' } });
  const result = await pending;
  assert.equal(result.verdict, 'SUSPICIOUS'); assert.equal(result.analysisModel, EXTENDED);
  assert.ok(!JSON.stringify(result).includes('Internal reasoning'));
});


test('raw Google ACTIVITY_END acknowledgement works when transcription has no finished flag', async () => {
  const socket = new Socket();
  const pending = analyzeLiveVoice(input(), EXTENDED, { socketFactory: () => socket });
  socket.open(); socket.receive({ setupComplete: {} });
  socket.receive({ serverContent: { inputTranscription: { text: 'Untrusted source speech' } } });
  assert.ok(!socket.sent.some(message => message.clientContent));
  socket.receive({ voiceActivity: { type: 'ACTIVITY_END', audioOffset: '1s' } });
  assert.equal(socket.sent.filter(message => message.clientContent?.turnComplete).length, 1);
  socket.receive({ serverContent: { outputTranscription: { text: JSON.stringify(compactAnswer()) }, turnComplete: true, interactionStatus: 'IDLE' } });
  assert.equal((await pending).analysisModel, EXTENDED);
});


test('collection timeouts retain attempt provenance and open provider backoff without penalizing caller cancellation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  process.env.GEMINI_MODEL_VOICE = 'gemini-collection-timeout-live-extended-thinking';
  process.env.GEMINI_MODEL_VOICE_LIVE_FALLBACK = process.env.GEMINI_MODEL_VOICE;
  process.env.GEMINI_MODEL_VOICE_FALLBACK = process.env.GEMINI_MODEL_VOICE;
  let calls = 0;
  const analyze = () => analyzeVoiceWithAcoustic(input(), new AbortController().signal, {
    content: (audio, signal) => analyzeAudioScam(audio, { signal, socketFactory: () => { calls++; return new Socket(); } }),
    acoustic: async () => ({ status: 'AVAILABLE', source: 'LOCAL_XLSR_AASIST', scoreCalibrated: false,
      score: .9, verdict: 'SYNTHETIC_SUSPECTED', modelVersion: 'a'.repeat(64), executionTimeMs: 100 }),
  });
  for (let i = 0; i < 3; i++) {
    const pending = analyze();
    t.mock.timers.tick(VOICE_ANALYSIS_TIMEOUTS.realtime.model);
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(20);
    const result = await pending;
    assert.equal(result.contentAnalysis?.status, 'UNAVAILABLE');
    assert.equal(result.providerAttempts?.[0].model, process.env.GEMINI_MODEL_VOICE);
    assert.equal(result.providerAttempts?.[0].reason, 'TIMEOUT');
  }
  const skipped = await analyze();
  assert.equal(calls, 3);
  assert.equal(skipped.providerAttempts?.[0].status, 'SKIPPED');
});


test('a validated JSON utterance still waits for Thinking IDLE before returning', async () => {
  const socket = new Socket(); let settled = false;
  const pending = analyzeLiveVoice(input(), EXTENDED, { socketFactory: () => socket });
  void pending.then(() => { settled = true; });
  socket.open(); socket.receive({ setupComplete: {} });
  socket.receive({ serverContent: { inputTranscription: { text: 'Đọc mã OTP ngay cho tôi.' } } });
  socket.receive({ voiceActivity: { type: 'ACTIVITY_END' } });
  socket.receive({ serverContent: { outputTranscription: { text: JSON.stringify(compactAnswer()) }, turnComplete: true, interactionStatus: 'IN_PROGRESS' } });
  await Promise.resolve(); assert.equal(settled, false);
  socket.receive({ serverContent: { turnComplete: true, interactionStatus: 'IDLE' } });
  assert.equal((await pending).verdict, 'SUSPICIOUS');
});


test('Extended JSON success is attributed to the primary with no hidden Flash call', async () => {
  route('primary-json'); const calls: string[] = [];
  const result = await analyzeAudioScam(input(), { socketFactory: routedFactory(() => false, calls),
    generate: async () => { throw new Error('Unexpected Flash call'); } });
  assert.equal(result.analysisModel, 'gemini-primary-json-live-extended-thinking');
  assert.equal(result.analysisTransport, 'LIVE_API'); assert.equal(result.fallbackUsed, false);
  assert.deepEqual(result.providerAttempts, [{ model: 'gemini-primary-json-live-extended-thinking', transport: 'LIVE_API', status: 'SUCCEEDED' }]);
  assert.equal(calls.length, 1);
});


test('Extended waits for delayed ASR after ACTIVITY_END and requests exactly one assessment', async () => {
  const socket = new Socket();
  const pending = analyzeLiveVoice(input(), EXTENDED, { socketFactory: () => socket });
  socket.open(); socket.receive({ setupComplete: {} });
  socket.receive({ voiceActivity: { type: 'ACTIVITY_END' } });
  assert.equal(socket.sent.filter(message => message.clientContent).length, 0);
  socket.receive({ serverContent: { inputTranscription: { text: 'Đọc mã OTP ngay cho tôi.' } } });
  socket.receive({ voiceActivity: { type: 'ACTIVITY_END' } });
  const prompts = socket.sent.filter(message => message.clientContent);
  assert.equal(prompts.length, 1);
  assert.ok(prompts[0].clientContent.turns[0].parts[0].text.includes(JSON.stringify({ transcript: 'Đọc mã OTP ngay cho tôi.' })));
  socket.receive({ serverContent: { outputTranscription: { text: JSON.stringify(compactAnswer()) }, interactionStatus: 'IDLE' } });
  assert.equal((await pending).verdict, 'SUSPICIOUS');
});

test('missing input ASR times out without asking the model to invent quote evidence', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const socket = new Socket();
  const pending = analyzeLiveVoice(input(), EXTENDED, { budgetMs: 120, socketFactory: () => socket });
  const failed = assert.rejects(pending, (error: unknown) => error instanceof VoiceAnalysisError && error.code === 'TIMEOUT');
  socket.open(); socket.receive({ setupComplete: {} }); socket.receive({ voiceActivity: { type: 'ACTIVITY_END' } });
  socket.receive({ serverContent: { inputTranscription: { text: ' ', finished: true } } });
  assert.equal(socket.sent.filter(message => message.clientContent).length, 0);
  t.mock.timers.tick(120); await failed;
  assert.equal(socket.closes, 1);
});

test('a newer malformed Thinking utterance invalidates an older SAFE candidate', async () => {
  const socket = new Socket();
  const pending = analyzeLiveVoice(input(), EXTENDED, { socketFactory: () => socket });
  socket.open(); socket.receive({ setupComplete: {} });
  socket.receive({ serverContent: { inputTranscription: { text: 'Họp chiều nay nhé.', finished: true } } });
  socket.receive({ serverContent: { outputTranscription: { text: JSON.stringify({ a: 3, v: 0, r: 0, q: 0, f: [] }) }, turnComplete: true, interactionStatus: 'IN_PROGRESS' } });
  socket.receive({ serverContent: { outputTranscription: { text: '{invalid' }, turnComplete: true, interactionStatus: 'IN_PROGRESS' } });
  socket.receive({ serverContent: { turnComplete: true, interactionStatus: 'IDLE' } });
  await assert.rejects(pending, (error: unknown) => error instanceof VoiceAnalysisError && error.code === 'INVALID_RESULT');
  assert.equal(socket.closes, 1);
});


test('task synthesis survives Extended IN_PROGRESS to IDLE and standard Live tool output', async () => {
  for(const model of [EXTENDED,'gemini-3.8-live']){
    const socket=new Socket();
    const pending=analyzeLiveVoice(input(),model,{socketFactory:()=>socket,assessSynthetic:true});
    socket.open();socket.receive({setupComplete:{}});socket.receive({serverContent:{inputTranscription:{text:'Đọc mã OTP ngay cho tôi.',finished:true}}});
    if(model===EXTENDED){
      socket.receive({serverContent:{outputTranscription:{text:JSON.stringify({...compactAnswer(),p:.05})},turnComplete:true,interactionStatus:'IN_PROGRESS'}});
      socket.receive({serverContent:{interactionStatus:'IDLE'}});
    }else socket.receive(report({...answer(),syntheticVoiceProbability:.05}));
    const result=await pending;assert.equal(result.syntheticVoiceProbability,.05);assert.equal(result.verdict,'SUSPICIOUS');assert.equal(socket.closes,1);
  }
});

test('task synthesis is requested and retained when both Live providers fail and Flash succeeds', async () => {
  route('task-flash');const calls:string[]=[];
  const result=await analyzeAudioScam(input(),{assessSynthetic:true,socketFactory:routedFactory(()=>true,calls),generate:async params=>{
    calls.push(params.model);assert.ok(params.config?.responseSchema?.required?.includes('syntheticVoiceProbability'));
    return {text:JSON.stringify({...answer(),syntheticVoiceProbability:.15})};
  }});
  assert.equal(result.syntheticVoiceProbability,.15);assert.equal(result.fallbackUsed,true);assert.equal(result.analysisTransport,'GENERATE_CONTENT');assert.equal(calls.length,3);
});


test('review repairs malformed task JSON once on the same socket without resending audio', async () => {
  const socket=new Socket();let connections=0;
  const pending=analyzeLiveVoice({...input(),analysisMode:'review'},EXTENDED,{assessSynthetic:true,socketFactory:()=>{connections++;return socket;}});
  socket.open();socket.receive({setupComplete:{}});socket.receive({serverContent:{inputTranscription:{text:'Đọc mã OTP ngay cho tôi.',finished:true}}});
  socket.receive({serverContent:{outputTranscription:{text:'{invalid'},interactionStatus:'IDLE'}});
  assert.equal(socket.sent.filter(m=>m.clientContent).length,2);assert.equal(socket.closes,0);
  socket.receive({serverContent:{outputTranscription:{text:JSON.stringify({...compactAnswer(),p:null})},interactionStatus:'IDLE'}});
  const result=await pending;assert.equal(result.verdict,'SUSPICIOUS');assert.equal(result.formatRepairAttempts,1);
  assert.equal(connections,1);assert.equal(socket.sent.filter(m=>m.realtimeInput?.activityStart).length,1);assert.equal(socket.closes,1);
});

test('valid UNKNOWN, realtime, legacy hybrid and insufficient budget do not request a repair', async () => {
  for(const scenario of ['unknown','realtime','hybrid','short']){
    const socket=new Socket();const pending=analyzeLiveVoice({...input(),...(scenario==='realtime'?{}:{analysisMode:'review' as const})},EXTENDED,
      {assessSynthetic:scenario!=='hybrid',budgetMs:scenario==='short'?2999:15000,socketFactory:()=>socket});
    socket.open();socket.receive({setupComplete:{}});socket.receive({serverContent:{inputTranscription:{text:'Đọc mã OTP ngay cho tôi.',finished:true}}});
    socket.receive({serverContent:{outputTranscription:{text:scenario==='unknown'?JSON.stringify({a:4,v:3,r:null,q:1,f:[],p:null}):'{invalid'},interactionStatus:'IDLE'}});
    if(scenario==='unknown'){const result=await pending;assert.equal(result.verdict,'UNKNOWN');assert.equal(result.formatRepairAttempts,undefined);}
    else await assert.rejects(pending,(e:unknown)=>e instanceof VoiceAnalysisError&&e.code==='INVALID_RESULT');
    assert.equal(socket.sent.filter(m=>m.clientContent).length,1);
  }
});

test('a second invalid reply rejects and a repair never reuses an earlier SAFE candidate', async () => {
  const socket=new Socket();const pending=analyzeLiveVoice({...input(),analysisMode:'review'},EXTENDED,{assessSynthetic:true,socketFactory:()=>socket});
  socket.open();socket.receive({setupComplete:{}});socket.receive({serverContent:{inputTranscription:{text:'Lịch họp ngày mai.',finished:true}}});
  socket.receive({serverContent:{outputTranscription:{text:JSON.stringify({a:3,v:0,r:0,q:0,f:[],p:null})},turnComplete:true,interactionStatus:'IN_PROGRESS'}});
  socket.receive({serverContent:{outputTranscription:{text:'broken'},interactionStatus:'IDLE'}});
  assert.equal(socket.sent.filter(m=>m.clientContent).length,2);
  socket.receive({serverContent:{interactionStatus:'IDLE'}});
  await assert.rejects(pending,(e:unknown)=>e instanceof VoiceAnalysisError&&e.code==='INVALID_RESULT');
  assert.equal(socket.sent.filter(m=>m.clientContent).length,2);assert.equal(socket.closes,1);
});

test('review repair stays inside the original deadline and respects caller cancellation', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  for(const cancellation of [false,true]){
    const socket=new Socket(),controller=new AbortController();
    const pending=analyzeLiveVoice({...input(),analysisMode:'review'},EXTENDED,{assessSynthetic:true,budgetMs:4000,signal:controller.signal,socketFactory:()=>socket});
    const failed=assert.rejects(pending,(e:unknown)=>e instanceof VoiceAnalysisError&&e.code==='TIMEOUT');
    socket.open();socket.receive({setupComplete:{}});socket.receive({serverContent:{inputTranscription:{text:'Đọc mã OTP ngay cho tôi.',finished:true}}});
    socket.receive({serverContent:{outputTranscription:{text:'broken'},interactionStatus:'IDLE'}});assert.equal(socket.sent.filter(m=>m.clientContent).length,2);
    if(cancellation)controller.abort();else t.mock.timers.tick(4000);
    await failed;socket.receive({serverContent:{outputTranscription:{text:JSON.stringify({...compactAnswer(),p:null})},interactionStatus:'IDLE'}});
    assert.equal(socket.closes,1);assert.equal(socket.sent.filter(m=>m.clientContent).length,2);
  }
});


test('Live uploads every nonzero sample but omits outer digital silence with context padding', async () => {
  const original = Buffer.from(input().audioBase64, 'base64');
  const padded = Buffer.alloc(160044); original.copy(padded, 0, 0, 44);
  padded.writeUInt32LE(padded.length - 8, 4); padded.writeUInt32LE(160000, 40);
  original.copy(padded, 44 + 32000, 44); padded.writeInt16LE(1, 44 + 32000);
  padded.writeInt16LE(-1, 44 + 64000 - 2);
  const socket = new Socket();
  const pending = analyzeLiveVoice({ mimeType: 'audio/wav', audioBase64: padded.toString('base64') }, 'gemini-3.8-live', { socketFactory: () => socket });
  socket.open(); socket.receive({ setupComplete: {} });
  const sent = Buffer.concat(socket.sent.flatMap(m => m.realtimeInput?.audio ? [Buffer.from(m.realtimeInput.audio.data, 'base64')] : []));
  assert.deepEqual(sent, padded.subarray(44 + 25600, 44 + 70400));
  assert.equal(sent.length, 44800); // 1s speech + 200ms at each end, not the original 5s.
  socket.receive(report()); await pending;
});


function longReviewInput(): AnalyzeVoiceRequest {
  const original = Buffer.from(input().audioBase64, 'base64'), data = Buffer.alloc(192044);
  original.copy(data, 0, 0, 44); data.writeUInt32LE(data.length - 8, 4); data.writeUInt32LE(192000, 40);
  for (let i = 0; i < 6; i++) original.copy(data, 44 + i * 32000, 44);
  return { mimeType:'audio/wav', audioBase64:data.toString('base64'), analysisMode:'review' };
}

test('long review waits for late ASR evidence and sends the full transcript once in the same session', async t => {
  t.mock.timers.enable({apis:['setTimeout']}); const socket = new Socket();
  const pending = analyzeLiveVoice(longReviewInput(), EXTENDED, {socketFactory:()=>socket,assessSynthetic:true});
  socket.open(); socket.receive({setupComplete:{}});
  const frames = socket.sent.flatMap(m => m.realtimeInput?.audio ? [Buffer.from(m.realtimeInput.audio.data, 'base64')] : []);
  assert.equal(frames.length, 60);
  assert.deepEqual(Buffer.concat(frames), Buffer.from(longReviewInput().audioBase64, 'base64').subarray(44));
  const prefix = 'Chúng ta trao đổi lịch làm việc ngày mai. '.repeat(10);
  socket.receive({serverContent:{inputTranscription:{text:prefix}}});socket.receive({voiceActivity:{type:'ACTIVITY_END'}});
  t.mock.timers.tick(150); assert.ok(!socket.sent.some(x=>x.clientContent));
  socket.receive({serverContent:{inputTranscription:{text:'Đọc mã OTP ngay cho tôi.'}}});
  t.mock.timers.tick(199); assert.ok(!socket.sent.some(x=>x.clientContent));
  t.mock.timers.tick(1);
  const reports=socket.sent.filter(x=>x.clientContent);assert.equal(reports.length,1);
  assert.ok(reports[0].clientContent.turns[0].parts[0].text.includes('Đọc mã OTP ngay cho tôi.'));
  socket.receive({serverContent:{outputTranscription:{text:JSON.stringify({...compactAnswer(),p:null})},turnComplete:true,interactionStatus:'IDLE'}});
  const result=await pending;assert.equal(result.verdict,'SUSPICIOUS');assert.ok(result.transcriptSnippet.length>300);
});

test('cancelling a long review clears its pending ASR timer and cannot send a later report', async t => {
  t.mock.timers.enable({apis:['setTimeout']});const socket=new Socket(),caller=new AbortController();
  const pending=analyzeLiveVoice(longReviewInput(),EXTENDED,{socketFactory:()=>socket,signal:caller.signal,assessSynthetic:true});
  socket.open();socket.receive({setupComplete:{}});socket.receive({serverContent:{inputTranscription:{text:'Đọc mã OTP ngay cho tôi.'}}});socket.receive({voiceActivity:{type:'ACTIVITY_END'}});
  caller.abort();await assert.rejects(pending);t.mock.timers.tick(500);
  assert.equal(socket.sent.filter(x=>x.clientContent).length,0);assert.equal(socket.closes,1);
});

test('review fails closed on an oversized ASR instead of assessing a silently truncated prefix', async () => {
  const socket=new Socket();const pending=analyzeLiveVoice(longReviewInput(),EXTENDED,{socketFactory:()=>socket,assessSynthetic:true});
  socket.open();socket.receive({setupComplete:{}});socket.receive({serverContent:{inputTranscription:{text:'x'.repeat(1501)}}});
  await assert.rejects(pending,(e:unknown)=>e instanceof VoiceAnalysisError&&e.code==='INVALID_RESULT');
  assert.equal(socket.sent.filter(x=>x.clientContent).length,0);
});
