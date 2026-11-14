import type { VoiceScamAnalysisResult } from '@zeroleak/shared-types';

export const VOICE_HISTORY_LIMIT = 20;
type Summary = Pick<VoiceScamAnalysisResult, 'verdict' | 'riskScore' | 'detectedTactics' | 'tacticEvidence' | 'transcriptSnippet' | 'warningMessageVi' | 'analysisModel' | 'acousticAnalysis'>;
export interface VoiceEntryMeta { id: number; source: 'tab' | 'microphone' | 'file'; durationSeconds: number }
export type VoiceSessionEntry = VoiceEntryMeta & (
  { status: 'RESULT'; result: Summary } | { status: 'ERROR' | 'CANCELLED'; message: string }
);
export interface VoiceSession {
  entries: VoiceSessionEntry[];
  alert: (VoiceEntryMeta & { status: 'RESULT'; result: Summary }) | null;
  acousticAlert: (VoiceEntryMeta & { analysis: Extract<NonNullable<VoiceScamAnalysisResult['acousticAnalysis']>, {status:'AVAILABLE'}> }) | null;
  received: number;
  failed: number;
  cancelled: number;
  skipped: number;
  lastId: number;
}
export const EMPTY_VOICE_SESSION: VoiceSession = { entries: [], alert: null, acousticAlert: null, received: 0, failed: 0, cancelled: 0, skipped: 0, lastId: 0 };

function supportedWarning(result: Summary): boolean {
  if (!['SUSPICIOUS', 'DEEPFAKE_SCAM'].includes(result.verdict) || result.riskScore === null || !Number.isFinite(result.riskScore) || result.riskScore < 0 || result.riskScore > 100) return false;
  const normalize = (text: string) => text.normalize('NFC').toLocaleLowerCase('vi').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const transcript = normalize(result.transcriptSnippet);
  const evidence = result.tacticEvidence ?? [];
  return evidence.length > 0 && evidence.length === new Set(result.detectedTactics).size &&
    new Set(evidence.map(item => item.tactic)).size === evidence.length && evidence.every(item =>
      result.detectedTactics.includes(item.tactic) && normalize(item.quote).split(' ').length >= 3 && transcript.includes(normalize(item.quote)));
}

function acousticSummary(value: VoiceScamAnalysisResult['acousticAnalysis']): VoiceScamAnalysisResult['acousticAnalysis'] {
  if (!value) return undefined;
  if (value.status === 'UNAVAILABLE') return {status:'UNAVAILABLE'};
  return {status:value.status,score:value.score,verdict:value.verdict,source:value.source,scoreCalibrated:value.scoreCalibrated,modelVersion:value.modelVersion,executionTimeMs:value.executionTimeMs,windowCount:value.windowCount,audioDurationSeconds:value.audioDurationSeconds};
}

/** Only in-page summaries, never samples/base64/embeddings or persisted history. */
export function recordVoiceEntry(session: VoiceSession, input: VoiceSessionEntry): VoiceSession {
  if (input.id <= session.lastId) return session;
  const meta = { id: input.id, source: input.source, durationSeconds: input.durationSeconds };
  const entry: VoiceSessionEntry = input.status === 'RESULT' ? { ...meta, status: 'RESULT', result: {
    verdict: input.result.verdict, riskScore: input.result.riskScore,
    detectedTactics: input.result.detectedTactics.slice(0, 4),
    tacticEvidence: input.result.tacticEvidence?.slice(0, 4).map(item => ({ tactic: item.tactic, quote: item.quote.slice(0, 160) })),
    transcriptSnippet: input.result.transcriptSnippet.slice(0, 1500),
    warningMessageVi: input.result.warningMessageVi.slice(0, 500), analysisModel: input.result.analysisModel, acousticAnalysis: acousticSummary(input.result.acousticAnalysis),
  } } : { ...meta, status: input.status, message: input.message.slice(0, 500) };
  const alert = entry.status === 'RESULT' && supportedWarning(entry.result) &&
    (!session.alert || entry.result.riskScore! > session.alert.result.riskScore!) ? entry : session.alert;
  const acoustic = entry.status === 'RESULT' ? entry.result.acousticAnalysis : undefined;
  const acousticAlert = acoustic?.status === 'AVAILABLE' && acoustic.verdict === 'SYNTHETIC_SUSPECTED' &&
    acoustic.score !== null && Number.isFinite(acoustic.score) && acoustic.score >= .8 && acoustic.score <= 1 &&
    acoustic.scoreCalibrated === false && acoustic.source === 'LOCAL_XLSR_AASIST' && /^[0-9a-f]{64}$/.test(acoustic.modelVersion) &&
    (!session.acousticAlert || acoustic.score > session.acousticAlert.analysis.score!) ? { ...meta, analysis:acoustic } : session.acousticAlert;
  return { ...session, acousticAlert, entries: [entry, ...session.entries].slice(0, VOICE_HISTORY_LIMIT), alert, lastId: entry.id,
    received: session.received + Number(entry.status === 'RESULT'),
    failed: session.failed + Number(entry.status === 'ERROR'),
    cancelled: session.cancelled + Number(entry.status === 'CANCELLED') };
}
