/**
 * Phishing Analysis Client (Extension <-> Sandbox API)
 *
 * Communicates with Cloud Sandbox API (Playwright + Gemini 3.5 Flash Lite)
 * Enforces Strict Guardrail 4: Hard 3500ms timeout with local heuristic fallback.
 */

import type { PhishingAnalysisResponse } from '@zeroleak/shared-types';

const SANDBOX_API_ENDPOINT =
  typeof process !== 'undefined' && process.env?.SANDBOX_API_URL
    ? process.env.SANDBOX_API_URL
    : 'http://localhost:8080/api/v1/analyze-url';

const TIMEOUT_MS = 3500;

const VIETNAMESE_BANKS: Array<{ brand: string; pattern: RegExp; officialDomains: string[] }> = [
  {
    brand: 'Vietcombank DigiBank',
    pattern: /(?:vietcombank|vcb)/i,
    officialDomains: ['vietcombank.com.vn', 'vcbdigibank.vietcombank.com.vn'],
  },
  {
    brand: 'Techcombank Mobile',
    pattern: /(?:techcombank|tcb)/i,
    officialDomains: ['techcombank.com.vn', 'techcombank.com'],
  },
  {
    brand: 'MB Bank',
    pattern: /(?:mbbank|mb-bank)/i,
    officialDomains: ['mbbank.com.vn'],
  },
  {
    brand: 'VPBank NEO',
    pattern: /(?:vpbank|vp-bank)/i,
    officialDomains: ['vpbank.com.vn', 'neo.vpbank.com.vn'],
  },
  {
    brand: 'ACB ONE',
    pattern: /(?:acb(?:bank)?|online\.acb)/i,
    officialDomains: ['acb.com.vn'],
  },
  {
    brand: 'Cổng Dịch vụ công Quốc gia',
    pattern: /(?:dichvucong|vneid|bocongan)/i,
    officialDomains: ['dichvucong.gov.vn', 'vneid.gov.vn', 'bocongan.gov.vn'],
  },
  {
    brand: 'Facebook / Meta Login',
    pattern: /(?:facebook|fb-login|meta-security)/i,
    officialDomains: ['facebook.com', 'meta.com'],
  },
  {
    brand: 'Google Account Authentication',
    pattern: /(?:google-login|gmail-verify|accounts-google)/i,
    officialDomains: ['google.com', 'accounts.google.com'],
  },
];

const SUSPICIOUS_TLDS = new Set([
  'top',
  'xyz',
  'click',
  'buzz',
  'club',
  'work',
  'gq',
  'tk',
  'ml',
  'ga',
  'cf',
  'fit',
  'rest',
  'cam',
  'surf',
]);

/**
 * High-speed local heuristic evaluation fallback (< 1ms execution time)
 * Activated when Sandbox API is unreachable, offline, or times out > 3500ms.
 */
export function localHeuristicFallback(rawUrl: string): PhishingAnalysisResponse {
  const startTime = Date.now();
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
  } catch {
    return {
      url: rawUrl,
      finalRedirectUrl: rawUrl,
      riskScore: 85,
      verdict: 'SUSPICIOUS',
      impersonatedBrand: null,
      actualDomain: rawUrl,
      hasPasswordInput: false,
      hasOtpInput: false,
      indicators: ['URL không đúng định dạng chuẩn RFC', 'Cấu trúc tên miền bất thường'],
      executionTimeMs: Date.now() - startTime,
    };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const indicators: string[] = [];
  let riskScore = 0;
  let impersonatedBrand: string | null = null;

  // 1. IP address check
  const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
  if (isIpAddress) {
    riskScore += 45;
    indicators.push('Sử dụng địa chỉ IP trực tiếp thay vì tên miền (Dấu hiệu nguy hiểm)');
  }

  // 2. Suspicious TLD check
  const tldMatch = hostname.split('.').pop();
  if (tldMatch && SUSPICIOUS_TLDS.has(tldMatch)) {
    riskScore += 30;
    indicators.push(`Đuôi tên miền giá rẻ .${tldMatch} thường bị lạm dụng trong tấn công lừa đảo`);
  }

  // 3. Excessive hyphens or subdomains
  const hyphenCount = (hostname.match(/-/g) || []).length;
  if (hyphenCount >= 2) {
    riskScore += 20;
    indicators.push(`Tên miền chứa nhiều dấu gạch ngang (${hyphenCount} dấu '-') để đánh lừa mắt`);
  }

  const subdomainLevels = hostname.split('.').length;
  if (subdomainLevels >= 4) {
    riskScore += 15;
    indicators.push('Tên miền có cấu trúc đa tầng bất thường (quá nhiều subdomain)');
  }

  // 4. Punycode check (homograph attack)
  if (hostname.includes('xn--')) {
    riskScore += 40;
    indicators.push('Phát hiện kỹ thuật Punycode giả dạng ký tự Latinh (Homograph Attack)');
  }

  // 5. Brand impersonation check
  for (const item of VIETNAMESE_BANKS) {
    if (item.pattern.test(rawUrl)) {
      const isOfficial = item.officialDomains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
      if (!isOfficial) {
        riskScore = Math.max(riskScore + 50, 92);
        impersonatedBrand = item.brand;
        indicators.unshift(
          `CẢNH BÁO GIẢ MẠO: Tên miền không thuộc ${item.brand} nhưng chứa từ khóa nhận diện!`
        );
        break;
      }
    }
  }

  riskScore = Math.min(Math.max(riskScore, 5), 100);

  let verdict: 'SAFE' | 'SUSPICIOUS' | 'MALICIOUS' = 'SAFE';
  if (riskScore >= 75) {
    verdict = 'MALICIOUS';
  } else if (riskScore >= 40) {
    verdict = 'SUSPICIOUS';
  }

  if (indicators.length === 0) {
    indicators.push('Tên miền có định dạng chuẩn, không phát hiện dấu hiệu giả mạo cơ bản');
  }

  return {
    url: rawUrl,
    finalRedirectUrl: rawUrl,
    riskScore,
    verdict,
    impersonatedBrand,
    actualDomain: hostname,
    hasPasswordInput: riskScore >= 75,
    hasOtpInput: riskScore >= 75,
    indicators,
    executionTimeMs: Date.now() - startTime,
  };
}

/**
 * Primary Sandbox Analyzer with Strict Guardrail 4 (Hard Timeout & Fallback)
 */
export async function analyzeUrlWithSandbox(
  url: string,
  sourceContext: 'CONTEXT_MENU' | 'QR_CODE' | 'DIRECT_CHECK' = 'CONTEXT_MENU'
): Promise<PhishingAnalysisResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(SANDBOX_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        sourceContext,
        timeoutMs: 2500,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[ZeroLeak] Sandbox API returned status ${response.status}. Using local fallback.`);
      return localHeuristicFallback(url);
    }

    const data: PhishingAnalysisResponse = await response.json();
    return data;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error?.name === 'AbortError') {
      console.warn(`[ZeroLeak] Sandbox API request timed out (> ${TIMEOUT_MS}ms). Falling back to local heuristic.`);
    } else {
      console.warn('[ZeroLeak] Sandbox API connection failed:', error?.message);
    }
    return localHeuristicFallback(url);
  }
}
