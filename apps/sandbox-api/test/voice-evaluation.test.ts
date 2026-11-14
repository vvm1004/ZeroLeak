import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeVoiceEvaluation, type VoiceEvalRow } from '../src/voice-evaluation.js';

function row(patch: Partial<VoiceEvalRow>): VoiceEvalRow {
  return { id: 'case', originId: 'source', condition: 'clean', family: 'test', label: 'human', scamLabel: null,
    mode: 'quality', requestedModel: 'gemini-test', model: 'gemini-test', status: 'OK',
    syntheticScore: null, contentVerdict: 'SAFE', contentAlert: false, riskScore: 0, audioQuality: 'CLEAR', latencyMs: 100,
    providerCalls: 1, ...patch };
}

test('a scam verdict alone is not evidence of a synthetic voice; null is abstention', () => {
  const result = summarizeVoiceEvaluation([
    row({ id: 'a', label: 'synthetic', syntheticScore: null, contentVerdict: 'DEEPFAKE_SCAM' }),
    row({ id: 'b', label: 'human', status: 'TIMEOUT', syntheticScore: 0.1 }),
  ]);
  assert.equal(result.assessed, 0); assert.equal(result.coverage, 0);
  assert.equal(result.selectiveAccuracy, null);
  assert.equal(result.unknownHuman, 1); assert.equal(result.unknownSynthetic, 1);
  assert.equal(result.fakeDetectionYieldAllSynthetic, 0);
});

test('calculates confusion counts with exact denominators and distinguishes transformed copies', () => {
  const result = summarizeVoiceEvaluation([
    row({ id: 'tp', originId: 'fake', label: 'synthetic', syntheticScore: .9 }),
    row({ id: 'fn', originId: 'fake', label: 'synthetic', syntheticScore: .2, condition: 'opus' }),
    row({ id: 'fp', originId: 'real1', syntheticScore: .8 }),
    row({ id: 'tn', originId: 'real2', syntheticScore: .1 }),
    row({ id: 'unknown', originId: 'real3', syntheticScore: null }),
  ]);
  assert.deepEqual([result.tp, result.tn, result.fp, result.fn], [1, 1, 1, 1]);
  assert.equal(result.coverage, .8); assert.equal(result.selectiveAccuracy, .5);
  assert.equal(result.falsePositiveRateAmongAssessedHuman, .5);
  assert.equal(result.falseAlertsAllHuman, 1 / 3);
  assert.equal(result.sourceGroups, 4);
  assert.equal(result.latencyP95Ms, null);
});

test('scores content labels separately and does not invent labels for public speech', () => {
  const result = summarizeVoiceEvaluation([
    row({ scamLabel: true, contentVerdict: 'SUSPICIOUS', contentAlert: true, syntheticScore: .1 }),
    row({ scamLabel: false, contentVerdict: 'DEEPFAKE_SCAM', contentAlert: false, label: 'synthetic', syntheticScore: .9 }),
    row({ scamLabel: null, contentVerdict: 'SUSPICIOUS' }),
    row({ scamLabel: true, status: 'TIMEOUT' }),
  ]);
  assert.deepEqual(result.content, { labeled: 3, tp: 1, tn: 1, fp: 0, fn: 0, unknown: 1, coverage: 2 / 3 });
});


test('tactic exact matches never count errors or unknown content as correct', () => {
  const result = summarizeVoiceEvaluation([
    row({ expectedTactics: ['CEO_FRAUD'], detectedTactics: ['CEO_FRAUD'], contentAlert: true }),
    row({ expectedTactics: [], detectedTactics: [], contentAlert: null }),
    row({ expectedTactics: [], detectedTactics: [], contentAlert: false, status: 'TIMEOUT' }),
  ]);
  assert.deepEqual(result.tactics, { annotated: 3, exactMatches: 1 });
});


test('the declared acoustic uncertainty band cannot inflate correct decisions',()=>{
 const summary=summarizeVoiceEvaluation([
  row({label:'synthetic',syntheticScore:.8}),row({label:'synthetic',syntheticScore:.79}),
  row({label:'human',syntheticScore:.2}),row({label:'human',syntheticScore:.21}),
 ],.8,.2);
 assert.equal(summary.tp,1);assert.equal(summary.tn,1);assert.equal(summary.assessed,2);
 assert.equal(summary.unknownHuman,1);assert.equal(summary.unknownSynthetic,1);
 assert.equal(summary.fakeDetectionYieldAllSynthetic,.5);
 assert.throws(()=>summarizeVoiceEvaluation([],.8,.8),/uncertainty band/);
});
