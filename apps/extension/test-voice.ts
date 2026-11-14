import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeVoiceWav, VoiceWindowBuffer, VOICE_WINDOW_SAMPLES, VOICE_HOP_SAMPLES, VOICE_REVIEW_SAMPLES, readVoiceFile } from './utils/voice-audio';
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


test('client rejects misleading Live model provenance and accepts an explicit Flash fallback', async () => {
  const originalFetch = globalThis.fetch;
  const samples = Float32Array.from({ length: 16000 }, (_, i) => Math.sin(i * .1) * .2);
  const answer = { riskScore: 0, verdict: 'SAFE', detectedTactics: [], tacticEvidence: [], syntheticVoiceProbability: null,
    transcriptSnippet: 'Lịch họp ngày mai.', warningMessageVi: 'Chưa thấy dấu hiệu.', executionTimeMs: 1,
    audioQuality: 'CLEAR', assessmentSource: 'GEMINI_AUDIO', analysisModel: 'gemini-3.5-flash-lite',
    analysisTransport: 'GENERATE_CONTENT', fallbackUsed: true, contentAnalysis: { status: 'AVAILABLE' },
    providerAttempts: [{ model: 'gemini-3.8-live-extended-thinking', transport: 'LIVE_API', status: 'FAILED', reason: 'PROVIDER_ERROR' },
      { model: 'gemini-3.5-flash-lite', transport: 'GENERATE_CONTENT', status: 'SUCCEEDED' }] };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(answer));
    assert.equal((await analyzeVoice(samples, { apiBase: 'http://localhost:8080', token: '' })).analysisModel, 'gemini-3.5-flash-lite');
    for (const patch of [{ analysisModel: 'gemini-3.8-live-extended-thinking' }, { analysisTransport: 'LIVE_API' },
      { fallbackUsed: false }, { providerAttempts: [] }, { providerAttempts: [{ ...answer.providerAttempts[0], reason: 'RAW_SECRET' }] }]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ ...answer, ...patch }));
      await assert.rejects(analyzeVoice(samples, { apiBase: 'http://localhost:8080', token: '' }), /không hợp lệ/);
    }
  } finally { globalThis.fetch = originalFetch; }
});


test('client accepts one disclosed Live format repair and rejects invalid repair metadata', async () => {
 const originalFetch=globalThis.fetch;const samples=Float32Array.from({length:16000},(_,i)=>Math.sin(i*.1)*.2);
 const body={riskScore:null,verdict:'UNKNOWN',syntheticVoiceProbability:null,detectedTactics:[],transcriptSnippet:'',warningMessageVi:'Chưa đủ bằng chứng.',executionTimeMs:2000,audioQuality:'LIMITED',assessmentSource:'GEMINI_AUDIO',analysisModel:'gemini-3.8-live-extended-thinking',analysisTransport:'LIVE_API',formatRepairAttempts:1};
 try{
  globalThis.fetch=async()=>new Response(JSON.stringify(body));assert.equal((await analyzeVoice(samples,{apiBase:'http://localhost:8080',token:''},undefined,'review')).formatRepairAttempts,1);
  for(const patch of [{formatRepairAttempts:2},{formatRepairAttempts:'1'},{formatRepairAttempts:-1},{analysisTransport:'GENERATE_CONTENT'}]){
   globalThis.fetch=async()=>new Response(JSON.stringify({...body,...patch}));await assert.rejects(analyzeVoice(samples,{apiBase:'http://localhost:8080',token:''}),/không hợp lệ/);
  }
 }finally{globalThis.fetch=originalFetch;}
});


test('overlapping live windows preserve exact order and both sides of a boundary without mutating earlier audio', () => {
  const samples = Float32Array.from({ length: VOICE_WINDOW_SAMPLES * 2 }, (_, i) => i);
  const windows = new VoiceWindowBuffer(VOICE_HOP_SAMPLES);
  const received: Float32Array[] = [];
  for (let i = 0; i < samples.length; i += 2048) received.push(...windows.push(samples.subarray(i, i + 2048)));
  assert.equal(received.length, 3);
  for (let i = 0; i < received.length; i++) {
    assert.deepEqual(received[i], samples.slice(i * VOICE_HOP_SAMPLES, i * VOICE_HOP_SAMPLES + VOICE_WINDOW_SAMPLES));
  }
  // A request crossing the old 5s cut is intact in the middle window.
  const start = 72000, end = 96000;
  assert.deepEqual(received[1].slice(start - VOICE_HOP_SAMPLES, end - VOICE_HOP_SAMPLES), samples.slice(start, end));
  windows.push(Float32Array.from({ length: VOICE_WINDOW_SAMPLES }, () => -1));
  assert.equal(received[0][received[0].length - 1], VOICE_WINDOW_SAMPLES - 1);
  assert.equal(new VoiceWindowBuffer(VOICE_HOP_SAMPLES).push(new Float32Array(VOICE_WINDOW_SAMPLES - 1)).length, 0);
});

test('large capture batches and tiny packets produce identical overlapping windows; invalid hops are rejected', () => {
  const data = Float32Array.from({ length: VOICE_WINDOW_SAMPLES * 3 + 17 }, (_, i) => Math.sin(i));
  const all = new VoiceWindowBuffer(VOICE_HOP_SAMPLES).push(data);
  const buffer = new VoiceWindowBuffer(VOICE_HOP_SAMPLES), pieces: Float32Array[] = [];
  for (let i = 0; i < data.length; i += 127) pieces.push(...buffer.push(data.subarray(i, i + 127)));
  assert.deepEqual(pieces, all);
  for (const hop of [0, -1, 1, 7999, VOICE_WINDOW_SAMPLES + 1, 40000.5, NaN, Infinity]) {
    assert.throws(() => new VoiceWindowBuffer(hop));
  }
});


test('long browser WAV is sent only by explicit review and is accepted without truncating its tail', async () => {
  const samples = Float32Array.from({length:VOICE_REVIEW_SAMPLES},(_,i)=>i>=160000?.25:.1);
  assert.throws(()=>encodeVoiceWav(samples));
  const encoded=encodeVoiceWav(samples,true);
  const request=parseVoiceRequest({mimeType:'audio/wav',audioBase64:Buffer.from(encoded).toString('base64'),analysisMode:'review'});
  assert.equal(encoded.length,480044);assert.equal(request.analysisMode,'review');
  assert.equal(new DataView(encoded.buffer).getInt16(encoded.length-2,true),Math.round(.25*32767));
  assert.throws(()=>encodeVoiceWav(new Float32Array(VOICE_REVIEW_SAMPLES+1),true));
  let calls=0;const old=globalThis.fetch;
  try{
    globalThis.fetch=async(_url,init)=>{calls++;const payload=JSON.parse(String(init?.body));assert.equal(payload.analysisMode,'review');assert.equal(Buffer.from(payload.audioBase64,'base64').length,480044);return new Response('{}');};
    await assert.rejects(analyzeVoice(samples,{apiBase:'http://localhost:8080',token:''},undefined,'review'),/không hợp lệ/);assert.equal(calls,1);
    await assert.rejects(analyzeVoice(samples,{apiBase:'http://localhost:8080',token:''}));assert.equal(calls,1);
  }finally{globalThis.fetch=old;}
});

test('file decoding reviews the entire allowed file, keeps fast preview, and closes its context on rejection', async () => {
  const originalAudio=globalThis.AudioContext,originalOffline=globalThis.OfflineAudioContext;
  let duration=12,closed=0;const rendered:number[]=[];
  class Audio {async decodeAudioData(){return {duration};}async close(){closed++;}}
  class Offline {constructor(_channels:number,public length:number,_rate:number){rendered.push(length);}createBufferSource(){return {buffer:null,connect(){},start(){}};}async startRendering(){return {getChannelData:()=>new Float32Array(this.length).fill(.25)};}}
  try{
    globalThis.AudioContext=Audio as unknown as typeof AudioContext;globalThis.OfflineAudioContext=Offline as unknown as typeof OfflineAudioContext;
    const file=new File(['fixture'],'test.wav');
    assert.equal((await readVoiceFile(file)).length,80000);
    assert.equal((await readVoiceFile(file,true)).length,192000);
    duration=16;await assert.rejects(readVoiceFile(file,true),/không tự bỏ phần cuối/);
    assert.deepEqual(rendered,[80000,192000]);assert.equal(closed,3);
  }finally{globalThis.AudioContext=originalAudio;globalThis.OfflineAudioContext=originalOffline;}
});


test('realtime client accepts a 4.5s result and aborts a hung request at 9s', async t => {
  const originalFetch=globalThis.fetch; t.mock.timers.enable({apis:['setTimeout']});
  const samples=Float32Array.from({length:80000},(_,i)=>Math.sin(i*.1)*.2);
  const result={riskScore:0,verdict:'SAFE',syntheticVoiceProbability:null,detectedTactics:[],tacticEvidence:[],
    transcriptSnippet:'Lịch họp ngày mai.',warningMessageVi:'Chưa thấy dấu hiệu.',executionTimeMs:4500,
    audioQuality:'CLEAR',assessmentSource:'GEMINI_AUDIO',analysisModel:'fixture'};
  try {
    globalThis.fetch=async (_url,init)=>{
      const body=JSON.parse(String(init?.body));assert.equal(body.analysisMode,undefined);
      assert.equal(Buffer.from(body.audioBase64,'base64').readUInt32LE(40),160000);
      await new Promise(resolve=>setTimeout(resolve,4500));return new Response(JSON.stringify(result));
    };
    const delayed=analyzeVoice(samples,{apiBase:'http://localhost:8080',token:''});
    t.mock.timers.tick(4500);assert.equal((await delayed).verdict,'SAFE');
    let aborted=false;
    globalThis.fetch=async (_url,init)=>new Promise((_resolve,reject)=>{
      init?.signal?.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Aborted','AbortError'));},{once:true});
    });
    const hung=analyzeVoice(samples,{apiBase:'http://localhost:8080',token:''});
    const rejected=assert.rejects(hung,/Quá 9 giây/);
    t.mock.timers.tick(9000);await rejected;assert.equal(aborted,true);
  }finally{globalThis.fetch=originalFetch;}
});


test('flush preserves an unfinished final clip and never resubmits completed audio', () => {
  const buffer = new VoiceWindowBuffer();
  const samples = Float32Array.from({length:104000},(_,i)=>i);
  assert.equal(buffer.push(samples).length,1);
  assert.deepEqual(buffer.flush(),samples.slice(80000));assert.equal(buffer.flush(),null);
  assert.equal(buffer.push(new Float32Array(80000)).length,1);assert.equal(buffer.flush(),null);
});

test('flush does not submit retained overlap without new input', () => {
  const buffer = new VoiceWindowBuffer(VOICE_HOP_SAMPLES);
  const samples=Float32Array.from({length:80000},(_,i)=>i);
  buffer.push(samples);assert.equal(buffer.flush(),null);
  buffer.push(samples);buffer.push(new Float32Array(8000).fill(-1));
  const tail=buffer.flush()!;assert.equal(tail.length,48000);
  assert.deepEqual(tail.subarray(0,40000),samples.subarray(40000));assert.equal(tail[47999],-1);
});
