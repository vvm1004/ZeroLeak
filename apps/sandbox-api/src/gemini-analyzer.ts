/**
 * ZeroLeak Lens — Multimodal Visual Phishing Analyzer
 * 
 * Epic 2.2: Phân tích Giả mạo Thị giác với Gemini 3.8 Flash / 3.5 Flash Lite
 * Uses official @google/genai SDK with Structured Outputs (responseSchema)
 * Automatically falls back between primary (gemini-3.8-flash) and fallback (gemini-3.5-flash-lite).
 */

import { GoogleGenAI, Type } from '@google/genai';

export interface VisualPhishingAnalysis {
  riskScore: number; // 0 - 100
  verdict: 'SAFE' | 'SUSPICIOUS' | 'MALICIOUS';
  impersonatedBrand: string | null;
  indicators: string[];
  modelUsed?: string;
  executionTimeMs?: number;
}

export const GEMINI_MODELS = {
  PRIMARY_VISION: process.env.GEMINI_MODEL_VISION || 'gemini-3.8-flash',
  FALLBACK_LITE: 'gemini-3.5-flash-lite',
};

export const visualPhishingResponseSchema = {
  type: Type.OBJECT,
  properties: {
    riskScore: { type: Type.INTEGER },
    verdict: { type: Type.STRING, enum: ['SAFE', 'SUSPICIOUS', 'MALICIOUS'] },
    impersonatedBrand: { type: Type.STRING, nullable: true },
    indicators: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ['riskScore', 'verdict', 'indicators'],
};

export const VISUAL_PHISHING_SYSTEM_INSTRUCTION = `Bạn là Chuyên gia An ninh mạng Cấp cao phân tích tấn công giả mạo thương hiệu (Visual Phishing & Brand Impersonation) tại Việt Nam cho hệ thống ZeroLeak.

Nhiệm vụ:
1. Đối chiếu hình ảnh chụp màn hình (logo, màu sắc nhận diện, bố cục đăng nhập) với URL đích thực tế.
2. Các mục tiêu trọng điểm thường bị mạo danh tại Việt Nam:
   - Ngân hàng: Vietcombank, Techcombank, MB Bank, VPBank, ACB, BIDV, Agribank, TPBank...
   - Cổng Dịch vụ công Quốc gia, ứng dụng định danh VNeID, Bộ Công an.
   - Mạng xã hội: Facebook, Google, Meta, Telegram, Zalo.
   - Ví tiền điện tử: Yêu cầu nhập 12/24 từ Seed Phrase / Private Key.
3. Nguyên tắc chấm điểm:
   - Nếu giao diện mang logo, màu sắc, form đăng nhập của một thương hiệu/ngân hàng nhưng tên miền thực tế KHÔNG PHẢI tên miền chính thức của thương hiệu đó: CHẤM riskScore >= 90, verdict = "MALICIOUS", điền impersonatedBrand.
   - Nếu trang có ô nhập mật khẩu hoặc OTP trên tên miền khả nghi/mới tạo: riskScore >= 75, verdict = "SUSPICIOUS" hoặc "MALICIOUS".
   - Nếu trang là trang web bình thường, blog, hoặc tên miền chính thức của tổ chức: riskScore <= 20, verdict = "SAFE", impersonatedBrand = null.
4. Trả về đúng schema JSON với các chỉ số indicators bằng tiếng Việt rõ ràng, ngắn gọn.`;

/**
 * Analyzes webpage visual appearance and DOM summary to detect phishing attacks
 */
export async function analyzeVisualPhishing(
  params: {
    url: string;
    finalRedirectUrl: string;
    pageTitle: string;
    actualDomain: string;
    hasPasswordInput: boolean;
    hasOtpInput: boolean;
    hasSeedPhraseInput?: boolean;
    domSummary: string;
    screenshotBase64?: string;
  },
  options: {
    apiKey?: string;
    signal?: AbortSignal;
    generate?: (params: any) => Promise<{ text?: string }>;
  } = {}
): Promise<VisualPhishingAnalysis> {
  const startTime = Date.now();
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;

  if (!apiKey && !options.generate) {
    throw new Error('GEMINI_API_KEY chưa được cấu hình trên máy chủ');
  }

  const ai = new GoogleGenAI({ apiKey: apiKey || '' });

  const textPrompt = `Phân tích trang web này để phát hiện tấn công giả mạo thương hiệu (Visual Phishing):
- URL người dùng cung cấp: ${params.url}
- URL sau khi chuyển hướng (Final URL): ${params.finalRedirectUrl}
- Tên miền thực tế (Actual Domain): ${params.actualDomain}
- Tiêu đề trang (Page Title): ${params.pageTitle}
- Dấu hiệu phát hiện trên DOM:
  + Ô nhập mật khẩu: ${params.hasPasswordInput ? 'CÓ' : 'KHÔNG'}
  + Ô nhập mã OTP: ${params.hasOtpInput ? 'CÓ' : 'KHÔNG'}
  + Ô nhập Seed Phrase ví crypto: ${params.hasSeedPhraseInput ? 'CÓ' : 'KHÔNG'}
- Cấu trúc Form & Input:
${params.domSummary}

Hãy đối chiếu kỹ lưỡng giao diện trang web (nếu có ảnh chụp màn hình kèm theo) với tên miền thực tế.`;

  const contents: any[] = [];
  if (params.screenshotBase64) {
    contents.push({
      inlineData: {
        mimeType: 'image/webp',
        data: params.screenshotBase64,
      },
    });
  }
  contents.push({ text: textPrompt });

  // Custom generator for testing / dependency injection
  if (options.generate) {
    const rawRes = await options.generate({ contents });
    const parsed = JSON.parse(rawRes.text || '{}');
    return {
      riskScore: Number(parsed.riskScore ?? 0),
      verdict: parsed.verdict || 'SAFE',
      impersonatedBrand: parsed.impersonatedBrand || null,
      indicators: Array.isArray(parsed.indicators) ? parsed.indicators : [],
      modelUsed: 'custom-generator',
      executionTimeMs: Date.now() - startTime,
    };
  }

  // Smart Model Routing (AGENTS.md Rule 4):
  // Ưu tiên gemini-3.5-flash-lite (500 RPD) khi dev/test, chuyển sang gemini-3.8-flash khi lên sân khấu
  const primaryModel = process.env.GEMINI_MODEL_VISION || (process.env.NODE_ENV === 'production' ? 'gemini-3.8-flash' : 'gemini-3.5-flash-lite');
  const fallbackModel = 'gemini-3.5-flash-lite';
  const modelsToAttempt = primaryModel === fallbackModel ? [primaryModel] : [primaryModel, fallbackModel];

  let lastError: any = null;

  for (const model of modelsToAttempt) {
    const callController = new AbortController();
    const callTimer = setTimeout(() => callController.abort(), 6000);

    try {
      console.log(`[ZeroLeak Lens] 🤖 Đang phân tích qua mô hình Gemini: ${model}...`);
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: VISUAL_PHISHING_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: visualPhishingResponseSchema,
          temperature: 0.1,
          abortSignal: callController.signal,
        },
      });
      clearTimeout(callTimer);

      if (response.text) {
        const parsed = JSON.parse(response.text);
        const duration = Date.now() - startTime;
        console.log(`[ZeroLeak Lens] ✅ Gemini [${model}] phân tích thành công trong ${duration}ms!`);
        console.log(`[ZeroLeak Lens]    📊 Phán quyết: ${parsed.verdict} | Điểm rủi ro: ${parsed.riskScore}/100`);
        if (parsed.impersonatedBrand) {
          console.log(`[ZeroLeak Lens]    🚨 Thương hiệu bị mạo danh: ${parsed.impersonatedBrand}`);
        }
        if (Array.isArray(parsed.indicators) && parsed.indicators.length > 0) {
          console.log(`[ZeroLeak Lens]    🔍 Bằng chứng: ${parsed.indicators.join(' | ')}`);
        }

        return {
          riskScore: Math.max(0, Math.min(100, Number(parsed.riskScore ?? 0))),
          verdict: parsed.verdict || 'SAFE',
          impersonatedBrand: parsed.impersonatedBrand || null,
          indicators: Array.isArray(parsed.indicators) ? parsed.indicators : [],
          modelUsed: model,
          executionTimeMs: duration,
        };
      }
    } catch (err: any) {
      lastError = err;
      console.warn(`[ZeroLeak Lens] Model ${model} failed, attempting next model in route:`, err?.message);
    }
  }

  throw lastError || new Error('Không thể phân tích trang web với các mô hình Gemini');
}

