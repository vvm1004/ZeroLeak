import { GoogleGenAI, type GenerateContentParameters } from '@google/genai';
import type { AnalyzeVoiceRequest, VoiceScamAnalysisResult, VoiceProviderAttempt } from '@zeroleak/shared-types';
import { VoiceAnalysisError, parseVoiceResult, voiceResultSchema as schema, voiceResultInstruction as instruction } from './voice-result.js';
import { analyzeLiveVoice, isLiveVoiceModel, type VoiceSocketFactory } from './voice-live.js';
export { VoiceAnalysisError, parseVoiceResult } from './voice-result.js';

// Process-local, per-model cooldown; never stores audio, transcript or credentials.
// A single probe is allowed after 30s. Other callers can still use a healthy fallback.
const providerFailures = new Map<string, {
  count: number; retryAt: number; probe: boolean; code: VoiceAnalysisError['code'];
}>();
const PROVIDER_FAILURE_LIMIT = 3;
const PROVIDER_COOLDOWN_MS = 30000;

type Generate = (params: GenerateContentParameters) => Promise<{ text?: string }>;

/** Shared by production and offline evaluation; labels never enter the request. */
export function createVoiceGenerationRequest(input: AnalyzeVoiceRequest, model: string, signal: AbortSignal): GenerateContentParameters {
  return {
    model,
    contents: [{ role: 'user', parts: [
      { inlineData: { mimeType: input.mimeType, data: input.audioBase64 } },
      { text: 'Phân loại hành vi lời nói và dấu hiệu lừa đảo trong đoạn âm thanh. Trả JSON đúng schema.' },
    ] }],
    config: {
      systemInstruction: instruction, responseMimeType: 'application/json', responseSchema: schema,
      temperature: 0, maxOutputTokens: 700, abortSignal: signal,
      // Google's deadline is separate from our shorter application abort budget.
      httpOptions: { timeout: input.analysisMode === 'review' ? 15000 : 10000, retryOptions: { attempts: 1 } },
    },
  };
}

/** Shared model routing for serving and evaluation; explicit environment choices take priority. */
export function voiceModelRoute(input: Pick<AnalyzeVoiceRequest, 'analysisMode'>): string[] {
  const primary = process.env.GEMINI_MODEL_VOICE || 'gemini-3.8-live-extended-thinking';
  const selected = input.analysisMode === 'review' ? process.env.GEMINI_MODEL_VOICE_REVIEW || primary : primary;
  const secondary = process.env.GEMINI_MODEL_VOICE_LIVE_FALLBACK ?? (isLiveVoiceModel(selected) ? 'gemini-3.8-live' : selected);
  const models = [...new Set([selected, secondary, process.env.GEMINI_MODEL_VOICE_FALLBACK || 'gemini-3.5-flash-lite'])];
  if (models.some(model => !/^gemini-[a-z0-9.-]{1,100}$/.test(model))) throw new VoiceAnalysisError('NOT_CONFIGURED');
  return models;
}

/** One shared deadline includes primary and fallback; never return SAFE on failure. */
export async function analyzeAudioScam(
  input: AnalyzeVoiceRequest,
  options: { generate?: Generate; socketFactory?: VoiceSocketFactory; signal?: AbortSignal; budgetMs?: number } = {},
): Promise<VoiceScamAnalysisResult> {
  const started = performance.now();
  const review = input.analysisMode === 'review';
  const maximumBudget = review ? 15000 : 3100;
  const budget = Math.min(options.budgetMs ?? maximumBudget, maximumBudget);
  if (!options.generate && !options.socketFactory && !process.env.GEMINI_API_KEY) throw new VoiceAnalysisError('NOT_CONFIGURED');
  const generate: Generate = options.generate ?? ((params) => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! }).models.generateContent(params));
  const models = voiceModelRoute(input);
  let lastFailure = new VoiceAnalysisError('PROVIDER_ERROR');
  const attempts: VoiceProviderAttempt[] = [];
  for (let index = 0; index < models.length; index++) {
    const remaining = budget - (performance.now() - started);
    if (remaining < 100 || options.signal?.aborted) throw new VoiceAnalysisError('TIMEOUT', attempts);
    const model = models[index];
    const transport = isLiveVoiceModel(model) ? 'LIVE_API' as const : 'GENERATE_CONTENT' as const;
    const health = providerFailures.get(model);
    if (health && health.count >= PROVIDER_FAILURE_LIMIT) {
      if (health.retryAt > Date.now() || health.probe) {
        lastFailure = new VoiceAnalysisError(health.code);
        attempts.push({ model, transport, status: 'SKIPPED', reason: health.code });
        continue;
      }
      health.probe = true;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    // Measured successful calls often take 2.6–3.0s. Reserving a second for a
    // fresh fallback cancelled these calls at 2.1s, before a valid response.
    // A fast provider failure can still fall back within the shared deadline.
    const timer = setTimeout(abort, remaining);
    let rejectAbort: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(new VoiceAnalysisError('TIMEOUT'));
        controller.signal.addEventListener('abort', rejectAbort, { once: true });
      });
      const pending = transport === 'LIVE_API'
        ? analyzeLiveVoice(input, model, { signal: controller.signal, budgetMs: remaining, socketFactory: options.socketFactory })
        : generate(createVoiceGenerationRequest(input, model, controller.signal)).then(response =>
          parseVoiceResult(response.text ?? '', model, Math.round(performance.now() - started)));
      const result = await Promise.race([pending, aborted]);
      providerFailures.delete(model);
      attempts.push({ model, transport, status: 'SUCCEEDED' });
      return { ...result, executionTimeMs: Math.round(performance.now() - started), analysisTransport: transport,
        fallbackUsed: index > 0, providerAttempts: attempts };
    } catch (error) {
      // User/route cancellation does not establish a provider outage or quota failure.
      const collectionTimeout = options.signal?.reason instanceof VoiceAnalysisError && options.signal.reason.code === 'TIMEOUT';
      if (options.signal?.aborted && !collectionTimeout) {
        if (health && providerFailures.get(model) === health) health.probe = false;
        attempts.push({ model, transport, status: 'FAILED', reason: 'TIMEOUT' });
        throw new VoiceAnalysisError('TIMEOUT', attempts);
      }
      const status = (error as { status?: number })?.status;
      lastFailure = collectionTimeout ? new VoiceAnalysisError('TIMEOUT') : error instanceof VoiceAnalysisError ? error
        : new VoiceAnalysisError(controller.signal.aborted ? 'TIMEOUT' : status === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR');
      attempts.push({ model, transport, status: 'FAILED', reason: lastFailure.code });
      const transient = (transport === 'LIVE_API' && lastFailure.code === 'PROVIDER_ERROR') || lastFailure.code === 'TIMEOUT' || status === 429 || (typeof status === 'number' && status >= 500 && status < 600);
      if (transient) {
        const count = (providerFailures.get(model)?.count ?? 0) + 1;
        providerFailures.set(model, { count, retryAt: Date.now() + PROVIDER_COOLDOWN_MS, probe: false, code: lastFailure.code });
      } else {
        // Bad JSON or a permanent 4xx is not evidence of a transient service outage.
        providerFailures.delete(model);
      }
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
    }
  }
  throw new VoiceAnalysisError(lastFailure.code, attempts);
}
