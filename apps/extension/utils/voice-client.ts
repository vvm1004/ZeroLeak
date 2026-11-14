import type { VoiceScamAnalysisResult } from '@zeroleak/shared-types';
import { audioToBase64, encodeVoiceWav } from './voice-audio';

export interface VoiceSettings { apiBase: string; token: string }
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { apiBase: 'http://localhost:8080', token: '' };

function validAcoustic(value: unknown): boolean {
  if (value === undefined) return true;
  const raw = value as Record<string, unknown> | null;
  if (!raw) return false;
  if (raw.status === 'UNAVAILABLE') return true;
  if (raw.status !== 'AVAILABLE' || raw.source !== 'LOCAL_XLSR_AASIST' || raw.scoreCalibrated !== false ||
      !(raw.score === null || (typeof raw.score === 'number' && Number.isFinite(raw.score) && raw.score >= 0 && raw.score <= 1)) ||
      typeof raw.modelVersion !== 'string' || !/^[0-9a-f]{64}$/.test(raw.modelVersion) ||
      typeof raw.executionTimeMs !== 'number' || !Number.isFinite(raw.executionTimeMs) || raw.executionTimeMs < 0) return false;
  return raw.verdict === (raw.score === null ? 'UNKNOWN' : (raw.score as number) >= .8 ? 'SYNTHETIC_SUSPECTED' : (raw.score as number) <= .2 ? 'NO_SYNTHETIC_EVIDENCE' : 'UNKNOWN');
}

export function voiceEndpoint(base: string): string {
  let url: URL;
  try { url = new URL(base.trim()); } catch { throw new Error('Địa chỉ dịch vụ không hợp lệ.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) {
    throw new Error('Dịch vụ cần dùng HTTPS; localhost có thể dùng HTTP.');
  }
  return `${url.href.replace(/\/$/, '')}/api/v1/analyze-voice`;
}

export async function analyzeVoice(
  samples: Float32Array, settings: VoiceSettings, signal?: AbortSignal, analysisMode: 'realtime' | 'review' = 'realtime',
): Promise<VoiceScamAnalysisResult> {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), analysisMode === 'review' ? 16000 : 3500);
  try {
    const response = await fetch(voiceEndpoint(settings.apiBase), {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}) },
      body: JSON.stringify({ audioBase64: audioToBase64(encodeVoiceWav(samples)), mimeType: 'audio/wav', ...(analysisMode === 'review' ? { analysisMode } : {}) }),
      cache: 'no-store',
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message || 'Dịch vụ chưa phân tích được âm thanh.');
    if (!body || !['SAFE', 'SUSPICIOUS', 'DEEPFAKE_SCAM', 'UNKNOWN'].includes(body.verdict) ||
        typeof body.warningMessageVi !== 'string' || typeof body.transcriptSnippet !== 'string' ||
        !Array.isArray(body.detectedTactics) || body.detectedTactics.length > 4 ||
        body.detectedTactics.some((t: unknown) => !['CEO_FRAUD', 'AUTHORITY_IMPERSONATION', 'OTP_OR_CREDENTIAL_ASK', 'URGENCY_PRESSURE'].includes(t as string)) ||
        (body.tacticEvidence !== undefined && (!Array.isArray(body.tacticEvidence) || body.tacticEvidence.length > 4 ||
          body.tacticEvidence.some((item: unknown) => !item || typeof item !== 'object' ||
            typeof (item as { quote?: unknown }).quote !== 'string' || !(item as { quote: string }).quote.trim() || (item as { quote: string }).quote.length > 160 ||
            !body.detectedTactics.includes((item as { tactic?: unknown }).tactic)))) ||
        !['CLEAR', 'LIMITED', 'UNUSABLE'].includes(body.audioQuality) ||
        !['GEMINI_AUDIO', 'HYBRID_AUDIO', 'LOCAL_ACOUSTIC'].includes(body.assessmentSource) || typeof body.analysisModel !== 'string' ||
        (body.contentAnalysis !== undefined && (!body.contentAnalysis || !['AVAILABLE', 'UNAVAILABLE'].includes(body.contentAnalysis.status) ||
          (body.contentAnalysis.status === 'UNAVAILABLE' && !['TIMEOUT', 'RATE_LIMITED', 'NOT_CONFIGURED', 'INVALID_RESULT', 'PROVIDER_ERROR'].includes(body.contentAnalysis.reason)))) ||
        (body.contentAnalysis?.status === 'UNAVAILABLE' && (body.verdict !== 'UNKNOWN' || body.riskScore !== null || body.detectedTactics.length > 0)) ||
        (body.assessmentSource === 'LOCAL_ACOUSTIC' && body.contentAnalysis?.status === 'AVAILABLE') ||
        !validAcoustic(body.acousticAnalysis) ||
        (body.assessmentSource !== 'GEMINI_AUDIO' && body.acousticAnalysis?.status !== 'AVAILABLE') ||
        !Number.isFinite(body.executionTimeMs) || body.executionTimeMs < 0 ||
        body.warningMessageVi.length > 2000 || body.transcriptSnippet.length > 2000 ||
        !((body.riskScore === null) || (Number.isFinite(body.riskScore) && body.riskScore >= 0 && body.riskScore <= 100)) ||
        !((body.syntheticVoiceProbability === null) || (Number.isFinite(body.syntheticVoiceProbability) && body.syntheticVoiceProbability >= 0 && body.syntheticVoiceProbability <= 1))) {
      throw new Error('Dịch vụ trả về kết quả không hợp lệ.');
    }
    return body;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Đã hủy phân tích.', 'AbortError');
    if (controller.signal.aborted) throw new Error(analysisMode === 'review' ? 'Quá 16 giây. Chưa đánh giá được đoạn này; hãy thử lại.' : 'Quá 3,5 giây. Chưa đánh giá được đoạn này; hãy thử lại.');
    if (error instanceof TypeError) throw new Error('Không kết nối được dịch vụ Voice. Kiểm tra địa chỉ và máy chủ.');
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
  }
}
