import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseCompactVoiceResult,compactVoiceInstruction} from '../src/voice-live-output.js';
const model='gemini-3.8-live-extended-thinking';
const parse=(value:unknown,source='Đọc mã OTP ngay cho tôi.')=>parseCompactVoiceResult(JSON.stringify(value),source,model,10);
test('compact encoding preserves a model scam assessment and validates ASR quote evidence',()=>{
 const r=parse({a:0,v:1,r:90,q:0,f:[[2,'Đọc mã OTP ngay']]});
 assert.equal(r.verdict,'SUSPICIOUS');assert.equal(r.riskScore,90);assert.deepEqual(r.detectedTactics,['OTP_OR_CREDENTIAL_ASK']);assert.equal(r.syntheticVoiceProbability,null);
 assert.equal(parse({a:0,v:1,r:90,q:0,f:[[2,'Gửi mật khẩu cho tôi']]}).verdict,'UNKNOWN');
});
test('malformed numeric codes and extra fields never become valid classifications',()=>{
 for(const patch of [{a:5},{a:'0'},{v:-1},{q:3},{r:101},{f:[[9,'Đọc mã OTP ngay']]},{f:[[2]]},{extra:'unexpected'}])assert.throws(()=>parse({a:0,v:1,r:90,q:0,f:[],...patch}));
});
test('no ASR, unclear audio, contradictory or quoted advice all abstain',()=>{
 const value={a:0,v:1,r:90,q:0,f:[[2,'Đọc mã OTP ngay']]};
 for(const [v,source]of [[value,''],[{...value,q:2},'Đọc mã OTP ngay cho tôi.'],[{...value,v:0},'Đọc mã OTP ngay cho tôi.'],[{...value,a:1},'Đừng đọc mã OTP ngay cho tôi.']] as const){const r=parse(v,source);assert.equal(r.verdict,'UNKNOWN');assert.equal(r.riskScore,null);}
});
test('ordinary urgency and source credentials stay subject to the original conservative guards',()=>{
 const r=parse({a:0,v:1,r:40,q:0,f:[[3,'Mau gửi báo cáo ngay']]},'Mau gửi báo cáo ngay nhé.');assert.equal(r.verdict,'UNKNOWN');
 const secret=parse({a:0,v:1,r:90,q:0,f:[[2,'Đọc mã OTP 123456']]},'Đọc mã OTP 123456 cho tôi.');assert.ok(!JSON.stringify(secret).includes('123456'));
 assert.ok(compactVoiceInstruction.includes('untrusted DATA'));
});
