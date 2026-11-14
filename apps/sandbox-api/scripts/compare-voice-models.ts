/** Paired route comparison. Each WAV goes through the existing evaluator unchanged. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { matchedVoiceRows, pairedVoiceJobs, validateVoiceEvaluationSplits } from '../src/voice-evaluation-plan.js';
import { summarizeVoiceEvaluation, type VoiceEvalCase, type VoiceEvalRow } from '../src/voice-evaluation.js';

const {values}=parseArgs({options:{manifest:{type:'string'},plan:{type:'string'},output:{type:'string'},'dry-run':{type:'boolean',default:false}}});
if(!values.manifest||!values.plan||!values.output)throw new Error('Required: --manifest <cases.json> --plan <protocol.json> --output <new-directory>');
const manifestPath=resolve(values.manifest),planPath=resolve(values.plan),output=resolve(values.output);
const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const manifestBytes=readFileSync(manifestPath),plan=JSON.parse(readFileSync(planPath,'utf8'));
const manifest=JSON.parse(manifestBytes.toString()),cases:VoiceEvalCase[]=manifest.cases;
if(!Array.isArray(cases)||!cases.length||cases.length>1000||new Set(cases.map(x=>x.id)).size!==cases.length)throw new Error('Invalid manifest');
validateVoiceEvaluationSplits(cases);
if(plan.manifestSha256!==digest(manifestBytes)||!Array.isArray(plan.models)||plan.models.length!==2||
 plan.models.some((x:unknown)=>typeof x!=='string'||!/^gemini-[a-z0-9.-]{1,100}$/.test(x))||
 !Number.isInteger(plan.seed)||plan.seed<0||plan.seed>0xffffffff||
 !Array.isArray(plan.selectedIds)||new Set(plan.selectedIds).size!==plan.selectedIds.length||
 !Number.isInteger(plan.maxCalls)||plan.maxCalls<2||plan.maxCalls>200||plan.selectedIds.length*2>plan.maxCalls||
 !Number.isFinite(plan.intervalMs)||plan.intervalMs<2000||plan.intervalMs>60000||plan.mode!=='realtime'||
 plan.acousticHumanThreshold!==.2||plan.acousticSyntheticThreshold!==.8)throw new Error('Invalid fixed comparison protocol');
const selected=plan.selectedIds.map((id:string)=>{const item=cases.find(x=>x.id===id);if(!item)throw new Error('Unknown selected ID');return item;}) as VoiceEvalCase[];
const models=plan.models as [string,string];
const jobs=['dev','test'].flatMap((split,index)=>pairedVoiceJobs(selected.filter(x=>x.split===split),models,(plan.seed+index)>>>0));
if(jobs.length!==selected.length*2)throw new Error('Select only dev/test cases');
const tsx=fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs',import.meta.url));
const evaluator=fileURLToPath(new URL('./evaluate-voice.ts',import.meta.url));
const common=['--manifest',manifestPath,'--strategy','gemini','--mode','realtime','--interval-ms','2000'];
// Reuse all canonical WAV, SHA, size and provenance validation before the first paid call.
for(const model of models){
 const validated=spawnSync(process.execPath,[tsx,evaluator,...common,'--model',model,'--ids',plan.selectedIds.join(','),'--limit','200','--max-calls','1','--output',resolve(output,'validation.json'),'--dry-run'],{encoding:'utf8',maxBuffer:1_000_000});
 if(validated.status!==0)throw new Error('Canonical evaluator rejected manifest/configuration before provider use');
 const meta=JSON.parse(validated.stdout).meta;
 if(meta.productionDeadlineMs!==8000)throw new Error('Expected current realtime 8s budget');
}
const sources=['voice-analyzer.ts','voice-live.ts','voice-live-output.ts','voice-result.ts','voice-input.ts','voice-service.ts','voice-acoustic.ts'].map(x=>new URL('../src/'+x,import.meta.url));
const currentCode=()=>digest(Buffer.concat(sources.map(x=>readFileSync(x))));
const frozenCode=currentCode();
if(values['dry-run']){console.log(JSON.stringify({plannedCases:selected.length,plannedCalls:jobs.length,manifestSha256:plan.manifestSha256,analyzerCodeSha256:frozenCode,providerCalls:0,models},null,2));process.exit(0);}
if(existsSync(output))throw new Error('Use a new output directory; refusing overwrite/resume');
mkdirSync(output);mkdirSync(resolve(output,'calls'));
writeFileSync(resolve(output,'frozen-plan.json'),JSON.stringify({protocol:plan,analyzerCodeSha256:frozenCode,jobs,createdBeforeProviderCalls:true},null,2)+'\n',{flag:'wx'});
const rows:VoiceEvalRow[]=[],notAttempted:{id:string;model:string;reason:string}[]=[];
const errors=new Map<string,number>();let calls=0,lastStart=0;
const summary=(group:VoiceEvalRow[])=>({
 ...summarizeVoiceEvaluation(group,.8,.2),providerSuccessful:group.filter(x=>x.status==='OK').length,
 contentCorrectAllLabeled:group.filter(x=>x.scamLabel!==null&&x.status==='OK'&&x.contentAlert===x.scamLabel).length,
});
const matchedSummary=()=>{const matched=matchedVoiceRows(rows,models);return {cases:matched.cases,byModel:Object.fromEntries(models.map(model=>[model,summary(matched.byModel[model])]))};};
const persist=()=>writeFileSync(resolve(output,'report.json'),JSON.stringify({
 protocol:plan,analyzerCodeSha256:frozenCode,providerCalls:calls,plannedCalls:jobs.length,completed:rows.length,notAttempted,stopAfterConsecutiveErrors:3,matched:matchedSummary(),
 byModel:Object.fromEntries(models.map(model=>[model,{
  overall:summary(rows.filter(x=>x.requestedModel===model)),
  bySplit:Object.fromEntries(['dev','test'].map(split=>[split,summary(rows.filter(x=>x.requestedModel===model&&cases.find(c=>c.id===x.id)?.split===split))])),
  byCondition:Object.fromEntries([...new Set(selected.map(x=>x.condition))].map(condition=>[condition,summary(rows.filter(x=>x.requestedModel===model&&x.condition===condition))])),
  byCohort:Object.fromEntries([...new Set(selected.map(x=>x.cohort??'unspecified'))].map(cohort=>[cohort,summary(rows.filter(x=>x.requestedModel===model&&(x.cohort??'unspecified')===cohort))])),
 }])),results:rows,
},null,2)+'\n');
persist();
for(const [index,job]of jobs.entries()){
 if(currentCode()!==frozenCode)throw new Error('Analyzer changed during evaluation; report kept, comparison stopped');
 if((errors.get(job.model)??0)>=3){notAttempted.push({...job,reason:'THREE_CONSECUTIVE_ERRORS'});persist();continue;}
 if(calls>=plan.maxCalls)throw new Error('Provider call cap reached');
 await delay(Math.max(0,plan.intervalMs-(performance.now()-lastStart)));lastStart=performance.now();
 const target=resolve(output,'calls',`${String(index).padStart(3,'0')}.json`);
 // Child process isolates model env/cooldown and invokes the same production router.
 // Suppress raw stderr: only validated reports and enumerated statuses are retained.
 const child=spawnSync(process.execPath,[tsx,evaluator,...common,'--model',job.model,'--ids',job.id,'--limit','1','--max-calls','1','--output',target],{stdio:'ignore',timeout:20000});
 if(child.status!==0||!existsSync(target))throw new Error('Evaluation child failed; no automatic rerun');
 const response=JSON.parse(readFileSync(target,'utf8')),row:VoiceEvalRow=response.results?.[0];
 if(!row||row.id!==job.id||row.requestedModel!==job.model||response.providerCalls>1||response.meta.analyzerCodeSha256!==frozenCode)throw new Error('Mismatched evaluation result');
 calls+=response.providerCalls;rows.push(row);errors.set(job.model,row.status==='OK'?0:(errors.get(job.model)??0)+1);persist();
 console.log(JSON.stringify({completed:rows.length,planned:jobs.length,providerCalls:calls,id:job.id,model:job.model,status:row.status,latencyMs:row.latencyMs}));
}
persist();console.log(JSON.stringify({output,completed:rows.length,planned:jobs.length,providerCalls:calls,skipped:notAttempted.length,productionModelChanged:false}));
