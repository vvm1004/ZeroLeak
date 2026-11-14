import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { timingSafeEqual } from 'node:crypto';
import type { AnalyzeVoiceRequest, VoiceScamAnalysisResult, PhishingAnalysisResponse } from '@zeroleak/shared-types';
import { VoiceAnalysisError, voiceModelRoute } from './voice-analyzer.js';
import { analyzeVoiceWithAcoustic } from './voice-acoustic.js';
import { MAX_VOICE_REQUEST_BYTES, parseVoiceRequest, VoiceInputError } from './voice-input.js';
import { captureUrlInSandbox, type PlaywrightCaptureResult } from './playwright.js';
import { coordinateUrlAnalysis, type UrlAnalysisOptions } from './url-analyzer.js';
import { defaultUrlAnalysisCache, LruCache } from './cache.js';

export function createApp(options: {
  analyzeVoice?: (input: AnalyzeVoiceRequest, signal: AbortSignal) => Promise<VoiceScamAnalysisResult>;
  analyzeUrl?: (url: string, opts?: UrlAnalysisOptions) => Promise<PhishingAnalysisResponse>;
  captureUrl?: (url: string, opts?: { timeoutMs?: number; viewport?: { width: number; height: number } }) => Promise<PlaywrightCaptureResult>;
  cache?: LruCache<PhishingAnalysisResponse> | null;
} = {}) {
  const app = new Hono();
  const analyze = options.analyzeVoice ?? analyzeVoiceWithAcoustic;
  const urlCache = options.cache !== undefined ? options.cache : defaultUrlAnalysisCache;
  const analyzeUrlFn = options.analyzeUrl ?? ((url, opts) => coordinateUrlAnalysis(url, {
    ...opts,
    cache: options.cache !== undefined ? options.cache : opts?.cache,
    captureUrl: options.captureUrl,
  }));

  app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'] }));
  app.get('/health', c => c.json({
    status: 'ok',
    service: 'zeroleak-sandbox-api',
    timestamp: new Date().toISOString(),
    cache: {
      urlAnalysis: urlCache ? urlCache.stats() : null,
    },
    voice: {
      liveApi: typeof WebSocket === 'function',
      modelRoute: voiceModelRoute({}),
      contentEvidence: true,
      fileReview: true,
      localAcousticConfigured: Boolean(process.env.VOICE_ACOUSTIC_URL),
    },
  }));

  // Endpoint to clear LRU cache (useful for stage testing / reset)
  app.post('/api/v1/clear-cache', (c) => {
    if (urlCache) {
      urlCache.clear();
    }
    return c.json({ status: 'ok', message: 'Cache đã được làm mới thành công.' });
  });

  // ---------------------------------------------------------------------------
  // Epic 2: POST /api/v1/analyze-url (Playwright Sandbox + Gemini Visual Phishing)
  // ---------------------------------------------------------------------------
  app.post('/api/v1/analyze-url', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: 'INVALID_JSON', message: 'Yêu cầu định dạng JSON hợp lệ.' } }, 400);
    }

    const rawUrl = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!rawUrl) {
      return c.json({ error: { code: 'INVALID_URL', message: 'Trường "url" không được để trống.' } }, 400);
    }

    const timeoutMs = typeof body?.timeoutMs === 'number' ? Math.min(body.timeoutMs, 6000) : 3500;
    const noCache = Boolean(body?.noCache || body?.forceRefresh);

    try {
      const result = await analyzeUrlFn(rawUrl, { timeoutMs, noCache, signal: c.req.raw.signal });
      return c.json(result);
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('SSRF') || msg.includes('nội bộ')) {
        return c.json({
          error: {
            code: 'SSRF_BLOCKED',
            message: msg,
          },
        }, 400);
      }
      return c.json({
        error: {
          code: 'ANALYSIS_ERROR',
          message: msg || 'Lỗi trong quá trình phân tích URL.',
        },
      }, 500);
    }
  });
  app.use('/api/v1/analyze-voice', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    const origin = c.req.header('Origin');
    const configuredOrigins = (process.env.VOICE_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
    const localOrigin = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
    if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin) && !localOrigin.test(origin) && !configuredOrigins.includes(origin)) {
      return c.json({ error: { code: 'ORIGIN_DENIED', message: 'Nguồn yêu cầu chưa được phép dùng Voice.' } }, 403);
    }
    const token = process.env.VOICE_API_TOKEN;
    if (process.env.NODE_ENV === 'production' && !token) {
      return c.json({ error: { code: 'NOT_CONFIGURED', message: 'Dịch vụ Voice chưa được cấu hình mã truy cập.' } }, 503);
    }
    if (token) {
      const received = Buffer.from(c.req.header('Authorization') ?? '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
        return c.json({ error: { code: 'UNAUTHORIZED', message: 'Mã truy cập Voice không hợp lệ.' } }, 401);
      }
    }
    await next();
  });
  app.use('/api/v1/analyze-voice', bodyLimit({
    maxSize: MAX_VOICE_REQUEST_BYTES,
    onError: c => c.json({ error: { code: 'TOO_LARGE', message: 'Âm thanh vượt giới hạn 5 giây.' } }, 413),
  }));
  let inFlight = 0;
  app.post('/api/v1/analyze-voice', async c => {
    if (!(c.req.header('Content-Type') ?? '').toLowerCase().startsWith('application/json')) {
      return c.json({ error: { code: 'INVALID_INPUT', message: 'Cần gửi dữ liệu JSON.' } }, 415);
    }
    if (inFlight >= 2) return c.json({ error: { code: 'BUSY', message: 'Dịch vụ đang bận. Hãy thử lại sau.' } }, 429);
    let input: AnalyzeVoiceRequest;
    try { input = parseVoiceRequest(await c.req.json()); }
    catch (error) {
      return c.json({ error: { code: 'INVALID_INPUT', message: error instanceof VoiceInputError ? error.message : 'Dữ liệu JSON không hợp lệ.' } }, 400);
    }
    inFlight++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.analysisMode === 'review' ? 15300 : 3200);
    const abort = () => controller.abort();
    c.req.raw.signal.addEventListener('abort', abort, { once: true });
    try {
      const result = await analyze(input, controller.signal);
      return c.json(result);
    } catch (error) {
      const code = error instanceof VoiceAnalysisError ? error.code : 'PROVIDER_ERROR';
      const message = code === 'RATE_LIMITED' ? 'Dịch vụ AI đã chạm giới hạn sử dụng. Hãy thử lại sau.' : code === 'NOT_CONFIGURED' ? 'Máy chủ chưa có Gemini API key.'
        : code === 'TIMEOUT' ? 'Phân tích quá thời gian. Chưa thể đánh giá đoạn âm thanh này.'
        : 'Chưa phân tích được âm thanh. Hãy thử lại sau.';
      return c.json({ error: { code, message } }, code === 'TIMEOUT' ? 504 : code === 'RATE_LIMITED' ? 429 : code === 'NOT_CONFIGURED' ? 503 : 502);
    } finally {
      clearTimeout(timer);
      c.req.raw.signal.removeEventListener('abort', abort);
      inFlight--;
    }
  });
  return app;
}
