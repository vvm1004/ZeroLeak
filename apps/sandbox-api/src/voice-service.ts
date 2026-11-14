import type { AnalyzeVoiceRequest, VoiceScamAnalysisResult } from '@zeroleak/shared-types';
import { analyzeAudioScam, VoiceAnalysisError } from './voice-analyzer.js';
import { analyzeVoiceWithAcoustic } from './voice-acoustic.js';

/** Default follows task 2.4; the previous local+cloud implementation is opt-in. */
export function voiceAnalysisStrategy(): 'gemini' | 'hybrid' {
  const value = process.env.VOICE_ANALYSIS_STRATEGY || 'gemini';
  if (value !== 'gemini' && value !== 'hybrid') throw new VoiceAnalysisError('NOT_CONFIGURED');
  return value;
}

export async function analyzeVoice(input: AnalyzeVoiceRequest, signal: AbortSignal): Promise<VoiceScamAnalysisResult> {
  if (voiceAnalysisStrategy() === 'hybrid') return analyzeVoiceWithAcoustic(input, signal);
  const result = await analyzeAudioScam(input, { signal, assessSynthetic: true });
  return { ...result, contentAnalysis: { status: 'AVAILABLE' } };
}
