/**
 * ZeroLeak Lens — Full Phishing Analysis Coordinator
 * 
 * Combines:
 * 1. SSRF Safety Filter (playwright.ts)
 * 2. Google Safe Browsing API v4 blacklist check (safebrowsing.ts)
 * 3. Isolated Playwright Headless Chromium DOM & WebP screenshot (playwright.ts)
 * 4. Gemini 3.8 Flash / 3.5 Flash Lite Multimodal Visual Phishing Analyzer (gemini-analyzer.ts)
 */

import type { PhishingAnalysisResponse } from '@zeroleak/shared-types';
import { captureUrlInSandbox, validateUrlSafety, type PlaywrightCaptureResult } from './playwright.js';
import { checkUrlSafeBrowsing, type SafeBrowsingCheckResult } from './safebrowsing.js';
import { analyzeVisualPhishing, type VisualPhishingAnalysis } from './gemini-analyzer.js';
import { LruCache, normalizeUrlForCache, defaultUrlAnalysisCache } from './cache.js';

export interface UrlAnalysisOptions {
  timeoutMs?: number;
  apiKeyGemini?: string;
  apiKeySafeBrowsing?: string;
  signal?: AbortSignal;
  captureUrl?: (url: string, opts?: any) => Promise<PlaywrightCaptureResult>;
  checkSafeBrowsing?: (url: string, key?: string) => Promise<SafeBrowsingCheckResult>;
  analyzeGemini?: (params: any, opts?: any) => Promise<VisualPhishingAnalysis>;
  cache?: LruCache<PhishingAnalysisResponse> | null;
  noCache?: boolean;
}

const BANK_PATTERNS: Array<{ brand: string; pattern: RegExp; officialDomains: string[] }> = [
  { brand: 'Vietcombank DigiBank', pattern: /(?:vietcombank|vcb)/i, officialDomains: ['vietcombank.com.vn', 'vcbdigibank.vietcombank.com.vn'] },
  { brand: 'Techcombank Mobile', pattern: /(?:techcombank|tcb)/i, officialDomains: ['techcombank.com.vn', 'techcombank.com'] },
  { brand: 'MB Bank', pattern: /(?:mbbank|mb-bank)/i, officialDomains: ['mbbank.com.vn'] },
  { brand: 'VPBank NEO', pattern: /(?:vpbank|vp-bank)/i, officialDomains: ['vpbank.com.vn'] },
  { brand: 'BIDV SmartBanking', pattern: /(?:bidv|smartbanking)/i, officialDomains: ['bidv.com.vn'] },
  { brand: 'Agribank', pattern: /agribank/i, officialDomains: ['agribank.com.vn'] },
  { brand: 'ACB ONE', pattern: /(?:acb(?:bank)?|online\.acb)/i, officialDomains: ['acb.com.vn'] },
  { brand: 'TPBank', pattern: /(?:tpbank|tpb)/i, officialDomains: ['tpbank.com.vn', 'tpb.vn'] },
  { brand: 'Cổng Dịch vụ công Quốc gia', pattern: /(?:dichvucong|vneid|bocongan)/i, officialDomains: ['dichvucong.gov.vn', 'vneid.gov.vn', 'bocongan.gov.vn'] },
  { brand: 'Facebook / Meta Login', pattern: /(?:facebook|fb-login|meta-security)/i, officialDomains: ['facebook.com', 'meta.com'] },
  { brand: 'Google Account Authentication', pattern: /(?:google-login|gmail-verify|accounts-google)/i, officialDomains: ['google.com', 'accounts.google.com'] },
];

export function evaluateDomainBrandHeuristics(rawUrl: string, actualDomain: string): {
  impersonatedBrand: string | null;
  riskScore: number;
  indicator: string | null;
} {
  let domain = (actualDomain || '').toLowerCase().trim();
  let rawHostname = '';
  try {
    rawHostname = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`).hostname.toLowerCase().trim();
  } catch {}

  if (!domain || domain === 'about:blank') {
    domain = rawHostname;
  }

  for (const item of BANK_PATTERNS) {
    if (item.pattern.test(rawUrl)) {
      const isOfficial = item.officialDomains.some((d) =>
        domain === d || domain.endsWith(`.${d}`) || (rawHostname && (rawHostname === d || rawHostname.endsWith(`.${d}`)))
      );
      if (!isOfficial) {
        return {
          impersonatedBrand: item.brand,
          riskScore: 92,
          indicator: `CẢNH BÁO GIẢ MẠO: Tên miền ${domain || rawHostname} không thuộc ${item.brand} nhưng chứa từ khóa nhận diện!`,
        };
      } else {
        // Explicitly identified as official legitimate domain!
        return { impersonatedBrand: null, riskScore: 0, indicator: null };
      }
    }
  }
  return { impersonatedBrand: null, riskScore: 0, indicator: null };
}

export async function coordinateUrlAnalysis(
  rawUrl: string,
  options: UrlAnalysisOptions = {}
): Promise<PhishingAnalysisResponse> {
  const startTime = Date.now();
  console.log(`\n[ZeroLeak Lens] 🔍 Bắt đầu phân tích liên kết: ${rawUrl}`);
  const cacheKey = normalizeUrlForCache(rawUrl);
  const cache = options.cache !== undefined ? options.cache : defaultUrlAnalysisCache;

  // 0. Check In-Memory LRU Cache (< 5ms response for stage demo re-scans)
  if (!options.noCache && cache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`[ZeroLeak Lens] ⚡ CACHE HIT (< 5ms): Trả về ngay kết quả lưu sẵn [${cached.verdict} - ${cached.riskScore}/100] | Ảnh Sandbox: ${cached.screenshotBase64 ? 'CÓ' : 'KHÔNG'}`);
      return {
        ...cached,
        url: rawUrl,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
  const captureSandbox = options.captureUrl ?? captureUrlInSandbox;
  const safeBrowsingCheck = options.checkSafeBrowsing ?? checkUrlSafeBrowsing;
  const geminiAnalyze = options.analyzeGemini ?? analyzeVisualPhishing;

  // 1. SSRF Safety Pre-check
  const safety = validateUrlSafety(rawUrl);
  if (!safety.safe || !safety.parsedUrl) {
    throw new Error(safety.reason || 'URL bị chặn bởi bộ lọc chống tấn công SSRF');
  }

  // 2. Run Safe Browsing check and Playwright Sandbox in parallel for speed
  const [safeBrowsingResult, captureResult] = await Promise.all([
    safeBrowsingCheck(rawUrl, options.apiKeySafeBrowsing).catch(() => ({
      isKnownThreat: false,
      threatType: null,
      executionTimeMs: 0,
    })),
    captureSandbox(rawUrl, { timeoutMs: options.timeoutMs ?? 2000 }),
  ]);

  console.log(`[ZeroLeak Lens] 🌐 Playwright Sandbox (${captureResult.executionTimeMs}ms): Trạng thái: ${captureResult.status} | Tiêu đề: "${captureResult.pageTitle || 'N/A'}" | Ảnh chụp: ${captureResult.screenshotBase64 ? 'CÓ (WebP ' + Math.round(captureResult.screenshotBase64.length / 1024) + 'KB)' : 'KHÔNG'}`);

  if (captureResult.status === 'BLOCKED_SSRF') {
    throw new Error(captureResult.errorMessage || 'URL bị chặn bởi bộ lọc an ninh SSRF');
  }

  const indicators: string[] = [];
  let impersonatedBrand: string | null = null;
  let riskScore = 0;
  let verdict: 'SAFE' | 'SUSPICIOUS' | 'MALICIOUS' = 'SAFE';

  // 3. Safe Browsing Verdict Override
  if (safeBrowsingResult.isKnownThreat) {
    riskScore = 100;
    verdict = 'MALICIOUS';
    indicators.push(`Google Safe Browsing: URL nằm trong danh sách đen toàn cầu (${safeBrowsingResult.threatType || 'Mối đe dọa an ninh mạng'})`);
  }

  // 4. DOM Elements Indicators
  if (captureResult.hasPasswordInput) {
    indicators.push('Phát hiện ô nhập mật khẩu (<input type="password">)');
  }
  if (captureResult.hasOtpInput) {
    indicators.push('Phát hiện trường nhập mã OTP / mã xác thực 2 lớp');
  }
  if (captureResult.hasSeedPhraseInput) {
    indicators.push('CẢNH BÁO NGUY HIỂM: Phát hiện ô yêu cầu nhập 12/24 từ Seed Phrase khôi phục ví');
    riskScore = Math.max(riskScore, 95);
    verdict = 'MALICIOUS';
  }

  // 5. Multimodal AI Analysis with Gemini (if not already confirmed malicious by Safe Browsing)
  if (verdict !== 'MALICIOUS' || !safeBrowsingResult.isKnownThreat) {
    try {
      const geminiResult = await geminiAnalyze(
        {
          url: rawUrl,
          finalRedirectUrl: captureResult.finalRedirectUrl,
          pageTitle: captureResult.pageTitle,
          actualDomain: captureResult.actualDomain,
          hasPasswordInput: captureResult.hasPasswordInput,
          hasOtpInput: captureResult.hasOtpInput,
          hasSeedPhraseInput: captureResult.hasSeedPhraseInput,
          domSummary: captureResult.domSummary,
          screenshotBase64: captureResult.screenshotBase64,
        },
        {
          apiKey: options.apiKeyGemini,
          signal: options.signal,
        }
      );

      if (geminiResult) {
        riskScore = Math.max(riskScore, geminiResult.riskScore);
        if (geminiResult.verdict === 'MALICIOUS' || verdict === 'MALICIOUS') {
          verdict = 'MALICIOUS';
        } else if (geminiResult.verdict === 'SUSPICIOUS') {
          verdict = 'SUSPICIOUS';
        }

        if (geminiResult.impersonatedBrand) {
          impersonatedBrand = geminiResult.impersonatedBrand;
        }

        for (const ind of geminiResult.indicators) {
          if (!indicators.includes(ind)) {
            indicators.push(ind);
          }
        }
      }
    } catch (err: any) {
      // Graceful AI Fallback (e.g. no GEMINI_API_KEY in dev, or offline): Heuristic evaluation
      console.warn('[ZeroLeak Lens] Gemini Analyzer fallback to local heuristics:', err?.message);
      if (captureResult.hasPasswordInput && captureResult.hasOtpInput) {
        riskScore = Math.max(riskScore, 75);
        verdict = verdict === 'MALICIOUS' ? 'MALICIOUS' : 'SUSPICIOUS';
        indicators.push('Dấu hiệu nguy cơ: Form đồng thời yêu cầu cả mật khẩu và mã OTP');
      } else if (captureResult.hasPasswordInput || captureResult.hasOtpInput) {
        riskScore = Math.max(riskScore, 50);
        if (verdict === 'SAFE') verdict = 'SUSPICIOUS';
      }

      // Check domain brand heuristics if brand not identified yet
      if (!impersonatedBrand) {
        const brandCheck = evaluateDomainBrandHeuristics(rawUrl, captureResult.actualDomain);
        if (brandCheck.impersonatedBrand) {
          impersonatedBrand = brandCheck.impersonatedBrand;
          riskScore = Math.max(riskScore, brandCheck.riskScore);
          verdict = 'MALICIOUS';
          if (brandCheck.indicator && !indicators.includes(brandCheck.indicator)) {
            indicators.unshift(brandCheck.indicator);
          }
        }
      }
    }
  }

  let finalIndicators = [...indicators];

  // Check if target is a known legitimate official domain
  const rawHost = safety.parsedUrl?.hostname.toLowerCase() || '';
  const actualHost = (captureResult.actualDomain || '').toLowerCase();
  const isKnownOfficial = BANK_PATTERNS.some((item) =>
    item.officialDomains.some((d) =>
      rawHost === d || rawHost.endsWith(`.${d}`) ||
      (actualHost && (actualHost === d || actualHost.endsWith(`.${d}`)))
    )
  );

  if (isKnownOfficial && !safeBrowsingResult.isKnownThreat) {
    // Legitimate official bank domain must never be flagged as phishing
    riskScore = Math.min(riskScore, 10);
    verdict = 'SAFE';
    impersonatedBrand = null;
    finalIndicators = finalIndicators.filter(
      (ind) => !ind.includes('CẢNH BÁO GIẢ MẠO') && !ind.includes('giả mạo') && !ind.includes('Nguy cơ') && !ind.includes('Dấu hiệu nguy cơ')
    );
    if (!finalIndicators.some((ind) => ind.includes('chính thức'))) {
      finalIndicators.unshift('Xác thực an toàn: Tên miền thuộc hệ thống chính thức của ngân hàng / tổ chức');
    }
  }

  if (finalIndicators.length === 0) {
    finalIndicators.push('Không phát hiện dấu hiệu giả mạo thương hiệu hoặc đánh cắp thông tin');
  }

  const result: PhishingAnalysisResponse = {
    url: rawUrl,
    finalRedirectUrl: captureResult.finalRedirectUrl,
    actualDomain: captureResult.actualDomain,
    hasPasswordInput: captureResult.hasPasswordInput,
    hasOtpInput: captureResult.hasOtpInput,
    screenshotBase64: captureResult.screenshotBase64,
    riskScore,
    verdict,
    impersonatedBrand,
    indicators: finalIndicators,
    executionTimeMs: Date.now() - startTime,
  };

  // Cache result for instant retrieval (< 50ms SLO)
  if (!options.noCache && cache) {
    cache.set(cacheKey, result);
  }

  console.log(`[ZeroLeak Lens] 🏁 KẾT QUẢ TỔNG HỢP: [${result.verdict}] - Rủi ro: ${result.riskScore}/100 - Tổng thời gian: ${result.executionTimeMs}ms\n`);

  return result;
}
