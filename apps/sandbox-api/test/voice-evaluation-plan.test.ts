import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchedVoiceRows, pairedVoiceJobs, validateVoiceEvaluationSplits } from '../src/voice-evaluation-plan.js';
import type { VoiceEvalCase, VoiceEvalRow } from '../src/voice-evaluation.js';
const item=(id:string,patch:Partial<VoiceEvalCase>={}):VoiceEvalCase=>({id,originId:id,file:id+'.wav',sha256:'a'.repeat(64),family:'vivos',label:'human',scamLabel:null,split:'test',source:'public',license:'CC-BY',condition:'clean',...patch});
test('paired plan is deterministic, balanced and independent of ground-truth labels',()=>{
 const cases=[item('a'),item('b'),item('c'),item('d')],models=['gemini-a','gemini-b'] as const;
 const jobs=pairedVoiceJobs(cases,models,13);
 assert.deepEqual(jobs,pairedVoiceJobs(cases,models,13));assert.equal(jobs.length,8);
 assert.deepEqual(jobs,pairedVoiceJobs(cases.map(x=>({...x,label:'synthetic',scamLabel:true})),models,13));
 for(const c of cases)assert.deepEqual(jobs.filter(x=>x.id===c.id).map(x=>x.model).sort(),[...models]);
 assert.equal(jobs.filter((x,i)=>i%2===0&&x.model===models[0]).length,2);
});
test('origin, natural speaker and scenario may not leak across development and test',()=>{
 for(const pair of [
  [item('a',{originId:'shared',split:'dev'}),item('b',{originId:'shared'})],
  [item('a',{speakerId:'speaker',split:'dev'}),item('b',{speakerId:'speaker'})],
  [item('a',{scenarioId:'script',split:'dev'}),item('b',{scenarioId:'script'})],
  [item('a',{family:'FLEURS',speakerId:'speaker',split:'dev'}),item('b',{family:'FLEURS',speakerId:'speaker'})],
 ])assert.throws(()=>validateVoiceEvaluationSplits(pair),/crosses/);
 assert.doesNotThrow(()=>validateVoiceEvaluationSplits([item('a',{family:'Linh',label:'synthetic',speakerId:'Linh',split:'dev'}),item('b',{family:'Linh',label:'synthetic',speakerId:'Linh'})]));
});


test('matched summaries retain provider errors and cannot compare unmatched populations',()=>{
 const rows=[{id:'a',requestedModel:'gemini-a',status:'OK'},{id:'a',requestedModel:'gemini-b',status:'TIMEOUT'},
  {id:'b',requestedModel:'gemini-a',status:'OK'}] as VoiceEvalRow[];
 const paired=matchedVoiceRows(rows,['gemini-a','gemini-b']);
 assert.equal(paired.cases,1);assert.equal(paired.byModel['gemini-a'].length,1);
 assert.equal(paired.byModel['gemini-b'][0].status,'TIMEOUT');
});
