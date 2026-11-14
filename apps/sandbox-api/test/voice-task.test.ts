import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { parseCompactVoiceResult, taskVoiceInstruction } from '../src/voice-live-output.js';
import { createVoiceLiveSetup } from '../src/voice-live.js';
import { createVoiceGenerationRequest, parseVoiceResult, VoiceAnalysisError } from '../src/voice-analyzer.js';
import { voiceAnalysisStrategy } from '../src/voice-service.js';
const original={...process.env};afterEach(()=>{process.env={...original};});
const model='gemini-3.8-live-extended-thinking';
const value={a:3,v:0,r:0,q:0,f:[],p:.95};
const parse=(v:unknown)=>parseCompactVoiceResult(JSON.stringify(v),'Chiều nay họp nhóm nhé.',model,10,true);
test('task mode preserves Gemini synthesis independently of benign or unknown content',()=>{
 const r=parse(value);assert.equal(r.verdict,'SAFE');assert.equal(r.syntheticVoiceProbability,.95);assert.deepEqual(r.detectedTactics,[]);
 const unknown=parse({...value,a:4,v:3,r:null});assert.equal(unknown.verdict,'UNKNOWN');assert.equal(unknown.syntheticVoiceProbability,.95);
 assert.equal(parse({...value,p:null}).syntheticVoiceProbability,null);
 assert.equal(parse({...value,q:2}).syntheticVoiceProbability,null);
});
test('task mode rejects missing or invalid p rather than creating a probability',()=>{
 const {p,...missing}=value;for(const v of [missing,{...value,p:2},{...value,p:'0.9'},{...value,extra:true}])assert.throws(()=>parse(v),VoiceAnalysisError);
 assert.throws(()=>parseCompactVoiceResult(JSON.stringify(value),'Chiều nay họp nhóm nhé.',model,10),VoiceAnalysisError);
});
test('task mode still requires supported scam quotes even when synthesis is high',()=>{
 const r=parse({...value,a:0,v:1,r:90,f:[[2,'Gửi mã OTP ngay']]});assert.equal(r.verdict,'UNKNOWN');assert.equal(r.syntheticVoiceProbability,.95);
 const humanScam=parseCompactVoiceResult(JSON.stringify({a:0,v:1,r:90,q:0,f:[[2,'Đọc mã OTP ngay']],p:.05}),'Đọc mã OTP ngay cho tôi.',model,10,true);
 assert.equal(humanScam.verdict,'SUSPICIOUS');assert.equal(humanScam.syntheticVoiceProbability,.05);
});
test('both Live models and Flash fallback request the task synthesis field',()=>{
 assert.ok(createVoiceLiveSetup(model,true).setup.systemInstruction.parts[0].text.includes('p is your uncalibrated'));
 const live=createVoiceLiveSetup('gemini-3.8-live',true).setup;
 assert.ok(live.tools![0].functionDeclarations[0].parameters.required.includes('syntheticVoiceProbability'));
 const flash=createVoiceGenerationRequest({mimeType:'audio/wav',audioBase64:''},'gemini-test',new AbortController().signal,true);
 assert.ok(flash.config!.responseSchema!.required!.includes('syntheticVoiceProbability'));
 assert.ok(!taskVoiceInstruction.includes('never estimate voice authenticity'));
});
test('task schema requires the estimate but permits explicit abstention',()=>{
 const r={speechAct:'ORDINARY',transcriptSnippet:'Chiều nay họp nhóm nhé.',riskScore:0,verdict:'SAFE',findings:[],audioQuality:'CLEAR',syntheticVoiceProbability:.9};
 assert.equal(parseVoiceResult(JSON.stringify(r),model,1,true).syntheticVoiceProbability,.9);
 const {syntheticVoiceProbability,...missing}=r;assert.throws(()=>parseVoiceResult(JSON.stringify(missing),model,1,true));
 assert.equal(parseVoiceResult(JSON.stringify({...r,syntheticVoiceProbability:null}),model,1,true).syntheticVoiceProbability,null);
 assert.equal(parseVoiceResult(JSON.stringify(r),model,1).syntheticVoiceProbability,null);
});
test('Gemini strategy is the default; legacy hybrid is explicit and invalid settings fail closed',()=>{
 delete process.env.VOICE_ANALYSIS_STRATEGY;assert.equal(voiceAnalysisStrategy(),'gemini');
 process.env.VOICE_ANALYSIS_STRATEGY='hybrid';assert.equal(voiceAnalysisStrategy(),'hybrid');
 process.env.VOICE_ANALYSIS_STRATEGY='invalid';assert.throws(()=>voiceAnalysisStrategy(),VoiceAnalysisError);
});


test('CEO title, secrecy and ordinary deadlines cannot establish fraud without a sensitive action', () => {
 const benign = [
  ['Anh là giám đốc đây, việc này tuyệt đối bí mật.', 'Anh là giám đốc đây'],
  ['Giám đốc yêu cầu họp gấp ngay chiều nay.', 'yêu cầu họp gấp ngay'],
  ['Tôi là tổng giám đốc, đừng nói chuyện này với ai.', 'Tôi là tổng giám đốc'],
  ['Anh là sếp đây, giữ kín lịch công tác nhé.', 'Anh là sếp đây'],
 ];
 for (const [transcript, quote] of benign) {
  const parsed = parseCompactVoiceResult(JSON.stringify({a:0,v:2,r:90,q:0,f:[[0,quote]],p:.9}),transcript,model,10,true);
  assert.equal(parsed.verdict,'UNKNOWN');assert.equal(parsed.riskScore,null);assert.deepEqual(parsed.detectedTactics,[]);
  assert.equal(parsed.syntheticVoiceProbability,.9);assert.match(parsed.warningMessageVi,/chưa đủ/);
 }
});

test('the CEO evidence guard preserves supported money, credential and remote-access alerts', () => {
 for (const transcript of [
  'Anh là giám đốc, chuyển khoản cho anh ngay.',
  'Anh là giám đốc, đọc mã OTP cho anh ngay.',
  'Anh là giám đốc, gửi mật khẩu cho anh ngay.',
  'Anh là giám đốc, bật truy cập từ xa ngay.',
 ]) {
  const result=parseCompactVoiceResult(JSON.stringify({a:0,v:2,r:90,q:0,f:[[0,transcript.split(' ').slice(0,5).join(' ')]],p:.05}),transcript,model,10,true);
  assert.equal(result.verdict,'DEEPFAKE_SCAM');assert.deepEqual(result.detectedTactics,['CEO_FRAUD']);
  assert.equal(result.syntheticVoiceProbability,.05);
 }
 // A guard abstains; it must not rewrite a provider UNKNOWN into SAFE or an alert.
 const unknown=parseCompactVoiceResult(JSON.stringify({a:4,v:3,r:null,q:0,f:[],p:null}),'Anh là giám đốc, chuyển khoản ngay.',model,10,true);
 assert.equal(unknown.verdict,'UNKNOWN');
});
