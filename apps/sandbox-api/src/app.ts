import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { timingSafeEqual } from 'node:crypto';
import type { AnalyzeVoiceRequest, VoiceScamAnalysisResult } from '@zeroleak/shared-types';
import { VoiceAnalysisError, voiceModelRoute } from './voice-analyzer.js';
import { analyzeVoiceWithAcoustic } from './voice-acoustic.js';
import { MAX_VOICE_REQUEST_BYTES, parseVoiceRequest, VoiceInputError } from './voice-input.js';

export function createApp(options: {
  analyzeVoice?: (input: AnalyzeVoiceRequest, signal: AbortSignal) => Promise<VoiceScamAnalysisResult>;
} = {}) {
  const app = new Hono();
  const analyze = options.analyzeVoice ?? analyzeVoiceWithAcoustic;
  app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'] }));
  app.get('/health', c => c.json({ status: 'ok', service: 'zeroleak-sandbox-api', timestamp: new Date().toISOString(), voice: { liveApi: typeof WebSocket === 'function', modelRoute: voiceModelRoute({}), contentEvidence: true, fileReview: true, localAcousticConfigured: Boolean(process.env.VOICE_ACOUSTIC_URL) } }));
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
