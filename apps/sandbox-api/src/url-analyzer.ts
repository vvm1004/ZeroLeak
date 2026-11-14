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

export interface UrlAnalysisOptions {
  timeoutMs?: number;
  apiKeyGemini?: string;
  apiKeySafeBrowsing?: string;
  signal?: AbortSignal;
  captureUrl?: (url: string, opts?: any) => Promise<PlaywrightCaptureResult>;
  checkSafeBrowsing?: (url: string, key?: string) => Promise<SafeBrowsingCheckResult>;
  analyzeGemini?: (params: any, opts?: any) => Promise<VisualPhishingAnalysis>;
}

export async function coordinateUrlAnalysis(
  rawUrl: string,
  options: UrlAnalysisOptions = {}
): Promise<PhishingAnalysisResponse> {
  const startTime = Date.now();
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
    captureSandbox(rawUrl, { timeoutMs: options.timeoutMs ?? 2500 }),
  ]);

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
    }
  }

  if (indicators.length === 0) {
    indicators.push('Không phát hiện dấu hiệu giả mạo thương hiệu hoặc đánh cắp thông tin');
  }

  return {
    url: rawUrl,
    finalRedirectUrl: captureResult.finalRedirectUrl,
    actualDomain: captureResult.actualDomain,
    hasPasswordInput: captureResult.hasPasswordInput,
    hasOtpInput: captureResult.hasOtpInput,
    screenshotBase64: captureResult.screenshotBase64,
    riskScore,
    verdict,
    impersonatedBrand,
    indicators,
    executionTimeMs: Date.now() - startTime,
  };
}
