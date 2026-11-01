import type {
  DlpDetectionMatch,
  DlpScanResult,
  SensitiveDataType,
} from '@zeroleak/shared-types';

/**
 * Checks card validity using the Luhn Checksum algorithm
 */
export function isValidLuhn(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/**
 * Calculates Shannon Entropy to catch API Keys, Secret tokens, and high-entropy strings
 */
export function calculateShannonEntropy(str: string): number {
  const len = str.length;
  if (len === 0) return 0;
  const frequencies: Record<string, number> = {};
  for (const char of str) {
    frequencies[char] = (frequencies[char] || 0) + 1;
  }
  let entropy = 0;
  for (const char in frequencies) {
    const p = frequencies[char] / len;
    entropy -= p * Math.log2(p);
  }
  return Number(entropy.toFixed(2));
}

export const DLP_PATTERNS = {
  // CCCD Vietnam: 12 digits starting with 0 + province code 001..096 + gender + year + 6 random digits
  VN_CCCD: /\b0(?:0[1-9]|[1-8]\d|9[0-6])[0-3]\d{2}\d{6}\b/g,

  // Vietnam Phone Number: +84 or 0 followed by 3x, 5x, 7x, 8x, 9x + 7 digits
  PHONE_VN: /\b(?:\+84|0)(?:3[2-9]|5[2689]|7[06-9]|8[1-9]|9\d)\d{7}\b/g,

  // Standard Email Regex
  EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,

  // Known Cloud and API Key prefixes
  API_SECRET: /\b(?:AIza[0-9A-Za-z\-_]{35}|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AKIA[0-9A-Z]{16})\b/g,

  // Credit Card candidates (must pass Luhn algorithm verification)
  CREDIT_CARD_CANDIDATE: /\b(?:\d[ -]*?){13,19}\b/g,
};

/**
 * Scans text locally using deterministic rules (Regex + Luhn + Entropy)
 * Latency is typically < 2ms.
 */
export function scanDeterministicDlp(
  text: string,
  enabledTypes: SensitiveDataType[] = [
    'VN_CCCD',
    'CREDIT_CARD',
    'API_SECRET',
    'EMAIL',
    'PHONE_VN',
  ]
): DlpScanResult {
  const startTime = performance.now();
  const matches: DlpDetectionMatch[] = [];
  const typeCounters: Record<string, number> = {};
  let entropyMax = 0;

  function getPlaceholder(type: SensitiveDataType): string {
    typeCounters[type] = (typeCounters[type] || 0) + 1;
    const num = String(typeCounters[type]).padStart(2, '0');
    return `[${type}_${num}]`;
  }

  // Helper to test regex pattern
  function testPattern(
    type: SensitiveDataType,
    regex: RegExp,
    validator?: (val: string) => boolean
  ) {
    if (!enabledTypes.includes(type)) return;
    const r = new RegExp(regex.source, regex.flags);
    let match: RegExpExecArray | null;

    while ((match = r.exec(text)) !== null) {
      const originalValue = match[0];
      if (validator && !validator(originalValue)) {
        continue;
      }

      // Check for overlap with already recorded matches
      const startIndex = match.index;
      const endIndex = startIndex + originalValue.length;
      const overlaps = matches.some(
        (m) =>
          (startIndex >= m.startIndex && startIndex < m.endIndex) ||
          (endIndex > m.startIndex && endIndex <= m.endIndex)
      );

      if (!overlaps) {
        const entropy = calculateShannonEntropy(originalValue);
        if (entropy > entropyMax) entropyMax = entropy;

        matches.push({
          type,
          originalValue,
          tokenPlaceholder: getPlaceholder(type),
          startIndex,
          endIndex,
          confidence: 0.99,
        });
      }
    }
  }

  // 1. Scan CCCD
  testPattern('VN_CCCD', DLP_PATTERNS.VN_CCCD);

  // 2. Scan Phone VN
  testPattern('PHONE_VN', DLP_PATTERNS.PHONE_VN);

  // 3. Scan Email
  testPattern('EMAIL', DLP_PATTERNS.EMAIL);

  // 4. Scan API Secrets
  testPattern('API_SECRET', DLP_PATTERNS.API_SECRET);

  // 5. Scan Credit Card Candidates (requires Luhn checksum)
  testPattern('CREDIT_CARD', DLP_PATTERNS.CREDIT_CARD_CANDIDATE, isValidLuhn);

  // Sort matches by start position descending to replace without offset shifting
  matches.sort((a, b) => b.startIndex - a.startIndex);

  let sanitizedText = text;
  for (const match of matches) {
    sanitizedText =
      sanitizedText.slice(0, match.startIndex) +
      match.tokenPlaceholder +
      sanitizedText.slice(match.endIndex);
  }

  // Restore chronological order for reporting
  matches.sort((a, b) => a.startIndex - b.startIndex);

  const scanLatencyMs = Number((performance.now() - startTime).toFixed(2));

  return {
    sanitizedText,
    matches,
    scanLatencyMs,
    entropyMax,
  };
}
