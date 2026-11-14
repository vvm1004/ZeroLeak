/** Metrics for selective detectors. UNKNOWN/error are never counted as correct. */
export interface VoiceEvalCase {
  id: string;
  file: string;
  sha256: string;
  originId: string;
  condition: string;
  family: string;
  label: 'human' | 'synthetic';
  scamLabel: boolean | null;
  split: 'screening' | 'dev' | 'test';
  source: string;
  license: string;
  cohort?: string;
  expectedTactics?: string[];
  speakerId?: string;
  scenarioId?: string;
}

export interface VoiceEvalRow {
  id: string;
  originId: string;
  condition: string;
  family: string;
  label: VoiceEvalCase['label'];
  scamLabel: boolean | null;
  mode: 'realtime' | 'quality' | 'review';
  requestedModel: string;
  model: string | null;
  status: 'OK' | 'TIMEOUT' | 'PROVIDER_ERROR' | 'INVALID_RESULT' | 'INPUT_ERROR';
  syntheticScore: number | null;
  contentVerdict: string | null;
  contentAlert: boolean | null;
  riskScore: number | null;
  audioQuality: string | null;
  latencyMs: number;
  providerCalls: number;
  cohort?: string;
  detectedTactics?: string[];
  expectedTactics?: string[];
}

const ratio = (n: number, d: number) => d ? n / d : null;
function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2;
}

export function summarizeVoiceEvaluation(rows: VoiceEvalRow[], threshold = 0.5, humanThreshold?: number) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('Invalid threshold');
  if (humanThreshold !== undefined && (!Number.isFinite(humanThreshold) || humanThreshold < 0 || humanThreshold >= threshold)) throw new Error('Invalid uncertainty band');
  let tp = 0, tn = 0, fp = 0, fn = 0, unknownHuman = 0, unknownSynthetic = 0;
  let contentTP = 0, contentTN = 0, contentFP = 0, contentFN = 0, contentUnknown = 0, contentLabeled = 0;
  for (const row of rows) {
    const score = row.status === 'OK' ? row.syntheticScore : null;
    if (score === null || !Number.isFinite(score) || score < 0 || score > 1 || (humanThreshold !== undefined && score > humanThreshold && score < threshold)) {
      if (row.label === 'human') unknownHuman++; else unknownSynthetic++;
    } else if (row.label === 'synthetic') {
      if (score >= threshold) tp++; else fn++;
    } else if (score >= threshold) fp++; else tn++;

    if (row.scamLabel !== null) {
      contentLabeled++;
      if (row.status !== 'OK' || row.contentAlert === null) contentUnknown++;
      else {
        const alert = row.contentAlert;
        if (row.scamLabel) { if (alert) contentTP++; else contentFN++; }
        else if (alert) contentFP++; else contentTN++;
      }
    }
  }
  const human = rows.filter(row => row.label === 'human').length;
  const synthetic = rows.length - human;
  const assessed = tp + tn + fp + fn;
  const latencies = rows.map(row => row.latencyMs).sort((a, b) => a - b);
  return {
    attempted: rows.length, sourceGroups: new Set(rows.map(row => row.originId)).size,
    human, synthetic, threshold, ...(humanThreshold === undefined ? {} : { humanThreshold }), assessed, unknownHuman, unknownSynthetic,
    tp, tn, fp, fn,
    coverage: ratio(assessed, rows.length),
    selectiveAccuracy: ratio(tp + tn, assessed),
    falsePositiveRateAmongAssessedHuman: ratio(fp, fp + tn),
    falseNegativeRateAmongAssessedSynthetic: ratio(fn, fn + tp),
    fakeDetectionYieldAllSynthetic: ratio(tp, synthetic),
    falseAlertsAllHuman: ratio(fp, human),
    latencyMedianMs: median(latencies),
    latencyMaxMs: latencies.length ? latencies[latencies.length - 1] : null,
    latencyP95Ms: latencies.length >= 20 ? latencies[Math.ceil(latencies.length * .95) - 1] : null,
    errorCounts: Object.fromEntries(['TIMEOUT', 'PROVIDER_ERROR', 'INVALID_RESULT', 'INPUT_ERROR'].map(status => [status, rows.filter(row => row.status === status).length])),
    tactics: { annotated: rows.filter(row => row.expectedTactics !== undefined).length,
      exactMatches: rows.filter(row => row.expectedTactics !== undefined && row.status === 'OK' && row.contentAlert !== null &&
        JSON.stringify([...(row.detectedTactics ?? [])].sort()) === JSON.stringify([...row.expectedTactics].sort())).length },
    content: { labeled: contentLabeled, tp: contentTP, tn: contentTN, fp: contentFP, fn: contentFN, unknown: contentUnknown,
      coverage: ratio(contentTP + contentTN + contentFP + contentFN, contentLabeled) },
  };
}
