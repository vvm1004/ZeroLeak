import type { VoiceEvalCase, VoiceEvalRow } from './voice-evaluation.js';

/** Reject source leakage before looking at predictions; synthetic speaker IDs may repeat. */
export function validateVoiceEvaluationSplits(cases: VoiceEvalCase[]) {
  const groups = new Map<string, string>();
  for (const item of cases) {
    for (const key of [`origin:${item.originId}`, ...(item.scenarioId ? [`scenario:${item.scenarioId}`] : []),
      ...(item.speakerId && item.label === 'human' ? [`speaker:${item.speakerId}`] : [])]) {
      if (groups.has(key) && groups.get(key) !== item.split) throw new Error('Source group crosses evaluation splits');
      groups.set(key, item.split);
    }
  }
}

/** Seeded order is independent of labels; each model runs first equally often. */
export function pairedVoiceJobs(cases: VoiceEvalCase[], models: readonly [string, string], seed: number) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || models[0] === models[1]) throw new Error('Invalid comparison plan');
  validateVoiceEvaluationSplits(cases);
  let state = seed >>> 0;
  const random = () => ((state = (Math.imul(1664525, state) + 1013904223) >>> 0) / 4294967296);
  const result = cases.slice();
  for (let i=result.length-1;i>0;i--) { const j=Math.floor(random()*(i+1)); [result[i],result[j]]=[result[j],result[i]]; }
  return result.flatMap((item,index)=>(index%2 ? [models[1],models[0]] : [...models]).map(model=>({id:item.id,model})));
}


/** Keep failed attempts in matched pairs; missing attempts are explicitly excluded. */
export function matchedVoiceRows(rows: VoiceEvalRow[], models: readonly [string,string]) {
  const ids=[...new Set(rows.map(row=>row.id))].filter(id=>models.every(model=>rows.some(row=>row.id===id&&row.requestedModel===model)));
  const set=new Set(ids);
  return { cases:ids.length, byModel:Object.fromEntries(models.map(model=>[model,rows.filter(row=>row.requestedModel===model&&set.has(row.id))])) };
}
