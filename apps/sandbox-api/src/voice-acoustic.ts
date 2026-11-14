import { VOICE_ANALYSIS_TIMEOUTS } from '@zeroleak/shared-types';
import type { AcousticVoiceAnalysis, AnalyzeVoiceRequest, VoiceScamAnalysisResult } from '@zeroleak/shared-types';
import { voicePcmBytes } from './voice-input.js';
import { analyzeAudioScam, VoiceAnalysisError } from './voice-analyzer.js';

export function validateAcousticResult(value: unknown): AcousticVoiceAnalysis {
  const raw = value as Record<string, unknown> | null;
  if (!raw || raw.status !== 'AVAILABLE' || raw.source !== 'LOCAL_XLSR_AASIST' || raw.scoreCalibrated !== false ||
      !(raw.score === null || (typeof raw.score === 'number' && Number.isFinite(raw.score) && raw.score >= 0 && raw.score <= 1)) ||
      typeof raw.modelVersion !== 'string' || !/^[0-9a-f]{64}$/.test(raw.modelVersion) ||
      typeof raw.executionTimeMs !== 'number' || !Number.isFinite(raw.executionTimeMs) || raw.executionTimeMs < 0) throw new Error('INVALID_ACOUSTIC_RESULT');
  const expected = raw.score === null ? 'UNKNOWN' : (raw.score as number) >= .8 ? 'SYNTHETIC_SUSPECTED' : (raw.score as number) <= .2 ? 'NO_SYNTHETIC_EVIDENCE' : 'UNKNOWN';
  if (raw.verdict !== expected) throw new Error('INVALID_ACOUSTIC_RESULT');
  return raw as unknown as AcousticVoiceAnalysis;
}

export function localAcousticEndpoint(base: string): string {
  const url = new URL(base);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('ACOUSTIC_REQUIRES_LOOPBACK');
  return new URL('/analyze', url).href;
}

/** Cover every PCM frame. A final partial window extends backward for speech context. */
export function voiceAcousticWindows(input: AnalyzeVoiceRequest): AnalyzeVoiceRequest[] {
  const pcm=voicePcmBytes(input),windows:AnalyzeVoiceRequest[]=[];
  for(let offset=0;offset<pcm.length;offset+=160000){
    const start=pcm.length-offset<160000?Math.max(0,pcm.length-160000):offset;
    const data=pcm.subarray(start,Math.min(start+160000,pcm.length)),wav=Buffer.alloc(44+data.length);
    wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
    wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);
    wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(data.length,40);data.copy(wav,44);
    windows.push({mimeType:'audio/wav',audioBase64:wav.toString('base64')});
  }
  return windows;
}

export async function analyzeLocalAcoustic(input: AnalyzeVoiceRequest, signal: AbortSignal): Promise<AcousticVoiceAnalysis> {
  const endpoint = localAcousticEndpoint(process.env.VOICE_ACOUSTIC_URL!);
  const windows=voiceAcousticWindows(input),results:(Extract<AcousticVoiceAnalysis,{status:'AVAILABLE'}>|null)[]=[];
  const started=performance.now();
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, input.analysisMode === 'review' ? 5000 : 2800);
  try {
    for(const window of windows){
      const pcm=Buffer.from(window.audioBase64,'base64').subarray(44);let energy=0;
      for(let i=0;i<pcm.length;i+=2)energy+=(pcm.readInt16LE(i)/32768)**2;
      if(Math.sqrt(energy/(pcm.length/2))<.001){results.push(null);continue;}
      for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(endpoint, { method: 'POST', body: JSON.stringify(window), signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, redirect: 'error' });
      if (response.status === 429 && attempt === 0) {
        await response.body?.cancel();
        await new Promise<void>((resolve, reject) => {
          const cancelled = () => { clearTimeout(pause); reject(new DOMException('Aborted', 'AbortError')); };
          const pause = setTimeout(() => { controller.signal.removeEventListener('abort', cancelled); resolve(); }, 200);
          if (controller.signal.aborted) cancelled();
          else controller.signal.addEventListener('abort', cancelled, { once: true });
        });
        continue;
      }
      if (!response.ok) throw new Error('ACOUSTIC_UNAVAILABLE');
      const result=validateAcousticResult(await response.json());
      if(result.status!=='AVAILABLE')throw new Error('ACOUSTIC_UNAVAILABLE');
      results.push(result);break;
      }
    }
    if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
    const available=results.filter((value):value is Extract<AcousticVoiceAnalysis,{status:'AVAILABLE'}>=>value!==null);
    if(!available.length||available.some(value=>value.modelVersion!==available[0].modelVersion))throw new Error('ACOUSTIC_UNAVAILABLE');
    const scores=available.flatMap(value=>value.score===null?[]:[value.score]);
    const maximum=scores.length?Math.max(...scores):null;
    const incomplete=scores.length!==windows.length;
    // Positive evidence in one segment is enough to flag that segment. Missing scores
    // prevent a low-score conclusion for the whole file; scores are never averaged.
    const score=maximum!==null&&maximum>=.8?maximum:incomplete?null:maximum;
    return {...available[0],score,verdict:score===null?'UNKNOWN':score>=.8?'SYNTHETIC_SUSPECTED':score<=.2?'NO_SYNTHETIC_EVIDENCE':'UNKNOWN',
      executionTimeMs:Math.round(performance.now()-started),windowCount:windows.length,audioDurationSeconds:voicePcmBytes(input).length/32000};
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

/** Content and acoustic evidence are independent; provider failure never means SAFE. */
export async function analyzeVoiceWithAcoustic(input: AnalyzeVoiceRequest, signal: AbortSignal, options: {
  content?: (input: AnalyzeVoiceRequest, signal: AbortSignal) => Promise<VoiceScamAnalysisResult>;
  acoustic?: (input: AnalyzeVoiceRequest, signal: AbortSignal) => Promise<AcousticVoiceAnalysis>;
} = {}): Promise<VoiceScamAnalysisResult> {
  if (signal.aborted) throw new VoiceAnalysisError('TIMEOUT');
  const content = options.content ?? ((audio, childSignal) => analyzeAudioScam(audio, { signal: childSignal }));
  const withAcoustic = Boolean(options.acoustic || process.env.VOICE_ACOUSTIC_URL);
  const started = performance.now();
  const controller = new AbortController();
  const settled: { content?: PromiseSettledResult<VoiceScamAnalysisResult>; acoustic?: PromiseSettledResult<AcousticVoiceAnalysis> } = {};
  let timer: ReturnType<typeof setTimeout>;
  let onAbort!: () => void;
  let expired = false;
  const deadline = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => { expired = true; resolve(); }, VOICE_ANALYSIS_TIMEOUTS[input.analysisMode ?? 'realtime'].model);
    onAbort = () => { controller.abort(signal.reason); reject(new VoiceAnalysisError('TIMEOUT')); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const invoke = <T>(call: () => Promise<T>): Promise<T> => {
    try { return call(); } catch (error) { return Promise.reject(error); }
  };
  const contentTask = invoke(() => content(input, controller.signal)).then(
    value => { settled.content = { status: 'fulfilled', value }; },
    reason => { settled.content = { status: 'rejected', reason }; });
  const acousticTask = withAcoustic ? invoke(() => (options.acoustic ?? analyzeLocalAcoustic)(input, controller.signal)).then(
    value => { settled.acoustic = { status: 'fulfilled', value }; },
    reason => { settled.acoustic = { status: 'rejected', reason }; }) : Promise.resolve();
  try {
    await Promise.race([Promise.all([contentTask, acousticTask]), deadline]);
    if (signal.aborted) throw new VoiceAnalysisError('TIMEOUT');
  } finally {
    clearTimeout(timer!); signal.removeEventListener('abort', onAbort);
    controller.abort(expired ? new VoiceAnalysisError('TIMEOUT') : undefined);
  }
  // Let cooperative abort handlers record their model attempts before collecting a
  // local-only result. A hanging adapter gets at most 20ms of cleanup, within the
  // route's shared hard limit; no extra model or audio processing is started.
  if (expired && !settled.content) {
    let cleanup!: ReturnType<typeof setTimeout>;
    await Promise.race([contentTask, new Promise<void>(resolve => { cleanup = setTimeout(resolve, 20); })]);
    clearTimeout(cleanup);
  }
  // The collection deadline stops unfinished work, preserving results already obtained.
  // A caller cancellation above still rejects and never returns a stale result.
  const scam = settled.content ?? { status: 'rejected' as const, reason: new VoiceAnalysisError('TIMEOUT') };
  const acoustic = settled.acoustic ?? { status: 'rejected' as const, reason: new VoiceAnalysisError('TIMEOUT') };
  if (scam.status === 'fulfilled') {
    if (!withAcoustic) return { ...scam.value, contentAnalysis: { status: 'AVAILABLE' }, executionTimeMs: Math.round(performance.now() - started) };
    return { ...scam.value, contentAnalysis: { status: 'AVAILABLE' }, executionTimeMs: Math.round(performance.now() - started),
      assessmentSource: acoustic.status === 'fulfilled' && acoustic.value.status === 'AVAILABLE' ? 'HYBRID_AUDIO' : 'GEMINI_AUDIO',
      acousticAnalysis: acoustic.status === 'fulfilled' ? acoustic.value : { status: 'UNAVAILABLE' } };
  }
  if (acoustic.status === 'rejected' || acoustic.value.status !== 'AVAILABLE') throw scam.reason;
  const reason = scam.reason instanceof VoiceAnalysisError ? scam.reason.code : 'PROVIDER_ERROR';
  return { riskScore: null, verdict: 'UNKNOWN', syntheticVoiceProbability: null, detectedTactics: [], transcriptSnippet: '',
    warningMessageVi: 'Chưa phân tích được nội dung cuộc gọi. Kết quả âm học được hiển thị riêng; hãy kiểm tra lại qua kênh chính thức.',
    executionTimeMs: Math.round(performance.now() - started), audioQuality: 'LIMITED',
    contentAnalysis: { status: 'UNAVAILABLE', reason },
    providerAttempts: scam.reason instanceof VoiceAnalysisError ? scam.reason.attempts : undefined,
    assessmentSource: 'LOCAL_ACOUSTIC', analysisModel: 'local-xlsr-aasist-linear', acousticAnalysis: acoustic.value };
}
