import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, realpathSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import dotenv from 'dotenv';
import type { VoiceProviderAttempt } from '@zeroleak/shared-types';
import { GoogleGenAI, type GenerateContentParameters } from '@google/genai';
import { analyzeAudioScam, createVoiceGenerationRequest, parseVoiceResult, VoiceAnalysisError, voiceModelRoute } from '../src/voice-analyzer.js';
import { analyzeLiveVoice, createVoiceLiveSetup, isLiveVoiceModel } from '../src/voice-live.js';
import { analyzeVoiceWithAcoustic } from '../src/voice-acoustic.js';
import { voiceAnalysisStrategy } from '../src/voice-service.js';
import { parseVoiceRequest } from '../src/voice-input.js';
import { summarizeVoiceEvaluation, type VoiceEvalCase, type VoiceEvalRow } from '../src/voice-evaluation.js';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const { values } = parseArgs({ options: {
  strategy: { type: 'string' }, manifest: { type: 'string' }, output: { type: 'string' }, model: { type: 'string' },
  mode: { type: 'string', default: 'realtime' }, threshold: { type: 'string', default: '0.5' },
  limit: { type: 'string', default: '24' }, 'max-calls': { type: 'string', default: '32' },
  'interval-ms': { type: 'string', default: '6000' }, 'quality-timeout-ms': { type: 'string', default: '20000' },
  split: { type: 'string' }, ids: { type: 'string' }, 'dry-run': { type: 'boolean', default: false },
} });
const strategy = values.strategy ?? voiceAnalysisStrategy();
if (!['gemini', 'hybrid'].includes(strategy)) throw new Error('strategy must be gemini or hybrid');
if (values.mode === 'quality' && strategy === 'hybrid') throw new Error('Quality mode is single-model Gemini only; use review for hybrid.');
const assessSynthetic = strategy === 'gemini';
if (!values.manifest || !values.output) throw new Error('Required: --manifest <cases.json> --output <new-report.json>');
if (!['quality', 'realtime', 'review'].includes(values.mode!)) throw new Error('mode must be quality, realtime or review');
if (values.split && !['screening', 'dev', 'test'].includes(values.split)) throw new Error('Invalid split');
if (values.model && !/^gemini-[a-z0-9.-]+$/.test(values.model)) throw new Error('Invalid model identifier');
if (values.mode === 'quality' && !values.model) throw new Error('Quality mode requires --model; it never represents the production deadline.');
const threshold = Number(values.threshold), limit = Number(values.limit), maxCalls = Number(values['max-calls']);
const interval = Number(values['interval-ms']), qualityTimeout = Number(values['quality-timeout-ms']);
if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1 || !Number.isInteger(limit) || limit < 1 || limit > 200 ||
    !Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 40 || !Number.isFinite(interval) || interval < 2000 || interval > 60000 ||
    !Number.isFinite(qualityTimeout) || qualityTimeout < 10000 || qualityTimeout > 20000) throw new Error('Invalid evaluation bounds');

const manifestPath = realpathSync(values.manifest);
const dataRoot = realpathSync(dirname(manifestPath));
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString());
if (!manifest || !Array.isArray(manifest.cases) || manifest.cases.length > 1000) throw new Error('Expected bounded cases array');
const ids = new Set<string>();
const cases: VoiceEvalCase[] = manifest.cases.map((value: VoiceEvalCase) => {
  if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id) || ids.has(value.id) ||
      !['human', 'synthetic'].includes(value.label) || !['screening', 'dev', 'test'].includes(value.split) ||
      typeof value.file !== 'string' || !value.file.endsWith('.wav') || !/^[0-9a-f]{64}$/.test(value.sha256) ||
      typeof value.originId !== 'string' || !value.originId || typeof value.family !== 'string' ||
      typeof value.condition !== 'string' || typeof value.source !== 'string' || typeof value.license !== 'string' ||
      (value.expectedTactics !== undefined && (!Array.isArray(value.expectedTactics) || value.expectedTactics.length > 4 || value.expectedTactics.some(t => !['CEO_FRAUD', 'AUTHORITY_IMPERSONATION', 'OTP_OR_CREDENTIAL_ASK', 'URGENCY_PRESSURE'].includes(t)))) ||
      !(value.scamLabel === null || typeof value.scamLabel === 'boolean')) throw new Error('Invalid or duplicate manifest entry');
  ids.add(value.id);
  const file = realpathSync(resolve(dataRoot, value.file));
  if (!file.startsWith(dataRoot + sep) || !statSync(file).isFile() || statSync(file).size > 160044) throw new Error('Audio must be a small WAV below the manifest directory');
  const bytes = readFileSync(file);
  if (createHash('sha256').update(bytes).digest('hex') !== value.sha256) throw new Error(`Audio checksum mismatch: ${value.id}`);
  parseVoiceRequest({ mimeType: 'audio/wav', audioBase64: bytes.toString('base64') });
  return value;
});
const requestedIds = values.ids ? values.ids.split(',') : null;
if (requestedIds?.some(id => !ids.has(id))) throw new Error('Unknown requested case ID');
const eligible = cases.filter(row => (!requestedIds || requestedIds.includes(row.id)) && (!values.split || row.split === values.split));
if (eligible.length > limit) throw new Error('Limit would truncate selected cases; select a split/IDs or raise the limit.');
const selected = eligible;
if (!selected.length) throw new Error('No cases selected');
const output = resolve(values.output);
if (!output.endsWith('.json') || existsSync(output)) throw new Error('Output must be a new .json file; refusing to overwrite');
const configuredRoute = voiceModelRoute({ analysisMode: values.mode === 'review' ? 'review' : 'realtime' });
const primaryModel = values.model ?? configuredRoute[0];
const evaluationRoute = values.model ? [values.model] : configuredRoute;
const definition = isLiveVoiceModel(primaryModel) ? createVoiceLiveSetup(primaryModel, assessSynthetic)
  : createVoiceGenerationRequest({ mimeType: 'audio/wav', audioBase64: '' }, primaryModel, new AbortController().signal, assessSynthetic);
const meta = {
  createdAt: new Date().toISOString(), strategy, voiceScoreSource: assessSynthetic ? 'GEMINI_UNCALIBRATED' : 'LOCAL_XLSR_AASIST', dataset: manifest.name ?? 'local dataset',
  limitations: manifest.limitations ?? [], mode: values.mode, requestedModel: values.model ?? 'production-router',
  productionDeadlineMs: values.mode === 'review' ? 15000 : 3100, qualityDeadlineMs: values.mode === 'quality' ? qualityTimeout : null,
  threshold, thresholdWasTunedOnThisRun: false, maxProviderCalls: maxCalls,
  modelRoute: evaluationRoute, transports: evaluationRoute.map(model => ({ model, transport: isLiveVoiceModel(model) ? 'LIVE_API' : 'GENERATE_CONTENT' })),
  labelsSentToProvider: false, realApi: !values['dry-run'],
  manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
  requestDefinitionSha256: createHash('sha256').update(JSON.stringify(definition)).digest('hex'),
  analyzerCodeSha256: createHash('sha256').update(Buffer.concat(['voice-analyzer.ts','voice-live.ts','voice-live-output.ts','voice-result.ts','voice-input.ts','voice-service.ts','voice-acoustic.ts'].map(file => readFileSync(new URL('../src/' + file, import.meta.url))))).digest('hex'),
  selectedSplit: values.split ?? 'explicit selection', plannedCases: selected.length, sourceGroups: new Set(selected.map(row => row.originId)).size,
};
if (values['dry-run']) {
  console.log(JSON.stringify({ meta, validatedCases: selected.map(row => row.id), providerCalls: 0 }, null, 2));
} else {
  if (!process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');
  const api = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const rows: (VoiceEvalRow & { providerStatus: number | null; providerAttempts?: VoiceProviderAttempt[] })[] = [];
  let totalCalls = 0, lastCall = 0, consecutiveErrors = 0;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, '{}\n', { flag: 'wx' });
  const persist = () => writeFileSync(output, JSON.stringify({ meta, providerCalls: totalCalls,
    notAttempted: selected.filter(item => !rows.some(row => row.id === item.id)).map(item => item.id),
    summary: summarizeVoiceEvaluation(rows, threshold),
    byCondition: Object.fromEntries([...new Set(rows.map(row => row.condition))].map(condition => [condition, summarizeVoiceEvaluation(rows.filter(row => row.condition === condition), threshold)])),
    byCohort: Object.fromEntries([...new Set(rows.map(row => row.cohort ?? 'unspecified'))].map(cohort => [cohort, summarizeVoiceEvaluation(rows.filter(row => (row.cohort ?? 'unspecified') === cohort), threshold)])),
    results: rows,
  }, null, 2) + '\n');
  persist();
  for (const item of selected) {
    if (totalCalls >= maxCalls || consecutiveErrors >= 3) break;
    const pause = interval - (performance.now() - lastCall);
    if (pause > 0) await delay(pause);
    const started = performance.now(), before = totalCalls;
    let providerStatus: number | null = null;
    const row: VoiceEvalRow & { providerStatus: number | null; providerAttempts?: VoiceProviderAttempt[] } = {
      id: item.id, originId: item.originId, condition: item.condition, family: item.family,
      label: item.label, scamLabel: item.scamLabel, mode: values.mode as 'realtime' | 'quality' | 'review',
      cohort: typeof item.cohort === 'string' ? item.cohort : 'unspecified',
      requestedModel: values.model ?? 'production-router', model: null,
      status: 'OK', syntheticScore: null, contentVerdict: null, contentAlert: null, riskScore: null,
      audioQuality: null, latencyMs: 0, providerCalls: 0, providerStatus: null,
      detectedTactics: [], expectedTactics: item.expectedTactics,
    };
    const generate = async (params: GenerateContentParameters) => {
      if (totalCalls >= maxCalls) throw new VoiceAnalysisError('PROVIDER_ERROR');
      totalCalls++; lastCall = performance.now(); row.model = params.model;
      try { return await api.models.generateContent(params); }
      catch (error) {
        const status = (error as { status?: number }).status;
        if (typeof status === 'number') providerStatus = status;
        throw error;
      }
    };
    const socketFactory = (url: string, model: string) => {
      if (totalCalls >= maxCalls) throw new VoiceAnalysisError('PROVIDER_ERROR');
      totalCalls++; lastCall = performance.now(); row.model = model;
      return new WebSocket(url);
    };
    try {
      const input = parseVoiceRequest({ mimeType: 'audio/wav', audioBase64: readFileSync(resolve(dataRoot, item.file)).toString('base64'), ...(values.mode === 'review' ? { analysisMode: 'review' } : {}) });
      let result;
      if (values.mode !== 'quality') {
        // Optional single-model realtime comparison is explicit, never a hidden fallback.
        const originalPrimary = process.env.GEMINI_MODEL_VOICE, originalFallback = process.env.GEMINI_MODEL_VOICE_FALLBACK;
        const originalReview = process.env.GEMINI_MODEL_VOICE_REVIEW, originalLiveFallback = process.env.GEMINI_MODEL_VOICE_LIVE_FALLBACK;
        if (values.model) { process.env.GEMINI_MODEL_VOICE_LIVE_FALLBACK = values.model; process.env.GEMINI_MODEL_VOICE = values.model; process.env.GEMINI_MODEL_VOICE_FALLBACK = values.model; process.env.GEMINI_MODEL_VOICE_REVIEW = values.model; }
        try { result = assessSynthetic
          ? await analyzeAudioScam(input, { generate, socketFactory, assessSynthetic: true })
          : await analyzeVoiceWithAcoustic(input, new AbortController().signal, { content: (audio, signal) => analyzeAudioScam(audio, { generate, socketFactory, signal }) }); }
        finally {
          if (originalLiveFallback === undefined) delete process.env.GEMINI_MODEL_VOICE_LIVE_FALLBACK; else process.env.GEMINI_MODEL_VOICE_LIVE_FALLBACK = originalLiveFallback;
          if (originalReview === undefined) delete process.env.GEMINI_MODEL_VOICE_REVIEW; else process.env.GEMINI_MODEL_VOICE_REVIEW = originalReview;
          if (originalPrimary === undefined) delete process.env.GEMINI_MODEL_VOICE; else process.env.GEMINI_MODEL_VOICE = originalPrimary;
          if (originalFallback === undefined) delete process.env.GEMINI_MODEL_VOICE_FALLBACK; else process.env.GEMINI_MODEL_VOICE_FALLBACK = originalFallback;
        }
      } else if (isLiveVoiceModel(values.model!)) {
        result = await analyzeLiveVoice(input, values.model!, { budgetMs: qualityTimeout, socketFactory, assessSynthetic });
      } else {
        const controller = new AbortController();
        let rejectTimeout!: () => void;
        const timeout = new Promise<never>((_, reject) => { rejectTimeout = () => reject(new VoiceAnalysisError('TIMEOUT')); });
        const timer = setTimeout(() => { controller.abort(); rejectTimeout(); }, qualityTimeout);
        try {
          const request = createVoiceGenerationRequest(input, values.model!, controller.signal, assessSynthetic);
          request.config!.httpOptions!.timeout = qualityTimeout;
          const response = await Promise.race([generate(request), timeout]);
          result = parseVoiceResult(response.text ?? '', values.model!, Math.round(performance.now() - started), assessSynthetic);
        } finally { clearTimeout(timer); }
      }
      row.providerAttempts = result.providerAttempts;
      row.syntheticScore = assessSynthetic ? result.syntheticVoiceProbability : result.acousticAnalysis?.status === 'AVAILABLE' ? result.acousticAnalysis.score : null;
      row.contentVerdict = result.verdict;
      row.contentAlert = result.riskScore === null || result.audioQuality === 'UNUSABLE' ? null : result.detectedTactics.length > 0;
      row.detectedTactics = result.detectedTactics;
      row.riskScore = result.riskScore; row.audioQuality = result.audioQuality; row.model = result.analysisModel;
      consecutiveErrors = 0;
    } catch (error) {
      if (error instanceof VoiceAnalysisError) row.providerAttempts = error.attempts;
      row.status = error instanceof VoiceAnalysisError && ['TIMEOUT', 'INVALID_RESULT'].includes(error.code)
        ? error.code as 'TIMEOUT' | 'INVALID_RESULT' : 'PROVIDER_ERROR';
      consecutiveErrors++;
    }
    row.providerStatus = providerStatus;
    row.providerCalls = totalCalls - before;
    row.latencyMs = Math.round(performance.now() - started);
    rows.push(row); persist();
    console.log(JSON.stringify({ completed: rows.length, planned: selected.length, id: row.id,
      status: row.status, voiceScore: row.syntheticScore, latencyMs: row.latencyMs, providerCalls: totalCalls }));
  }
  persist();
  console.log(JSON.stringify({ output, providerCalls: totalCalls, summary: summarizeVoiceEvaluation(rows, threshold) }));
}
