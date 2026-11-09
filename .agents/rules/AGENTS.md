# 🤖 AGENTS.md — AI Coding Assistant Guidelines (ZeroLeak)

> **Mục đích tài liệu:** File này cung cấp toàn bộ ngữ cảnh kỹ thuật, quy chuẩn kiến trúc, hợp đồng dữ liệu (Data Contracts) và quy tắc bảo mật bắt buộc cho AI Coding Agent (Cursor, Claude Code, Windsurf, Antigravity, Copilot) khi tham gia viết code cho dự án **ZeroLeak** tại GDG DevFest Miền Trung 2026.

## 1. Bối cảnh & Triết lý Kỹ thuật Cốt lõi

**ZeroLeak** (*"Zero Data Exposed. Zero Credentials Stolen."*) là hệ thống bảo mật lai (**Hybrid Edge-Cloud Security**) gồm 3 ứng dụng và 1 thư viện kiểu dữ liệu chung trong một Monorepo (`pnpm workspaces`):

1. `apps/extension`: Browser Extension (Manifest V3, WXT Framework, React 19, TypeScript, TailwindCSS) thực hiện **ZeroLeak Vault** (On-Device DLP với Gemini Nano & WebGPU + Reversible Tokenization), giao diện quét QR của **ZeroLeak Lens** và thu âm thanh kiểm tra của **ZeroLeak Voice**.
2. `apps/sandbox-api`: Cloud Sandbox & Multimodal AI Server (Node.js, Hono, Playwright Headless Chromium trên Google Cloud Run) kết hợp **Google Safe Browsing API v4**, **Gemini 3.8 Flash** (fallback **Gemini 3.5 Flash Lite**) và **Gemini 3.8 Live Extended Thinking** để phát hiện **Visual Phishing** từ URL/QR Code và **Audio Deepfake / Scam Script**.
3. `apps/dashboard`: Trang quản trị **ZeroLeak Command** đồng bộ chính sách thời gian thực (Next.js App Router, Shadcn UI, Recharts, Firebase Firestore / Supabase Realtime) và trang Demo Phishing giả lập.
4. `packages/shared-types`: Định nghĩa toàn bộ TypeScript Interfaces và JSON Schema dùng chung.

### ⚠️ 4 Nguyên tắc Bất khả xâm phạm (Strict Guardrails cho AI Agent)

1. **ZERO RAW PII EXFILTRATION:** Tuyệt đối KHÔNG BAO GIỜ gửi văn bản thô (raw text), số CCCD, thẻ tín dụng hay API Key của người dùng từ Extension lên `sandbox-api` hoặc `dashboard`. Mọi quá trình quét DLP và lưu trữ ánh xạ Token (`[ZL_PER_01]` $\leftrightarrow$ `"Nguyễn Văn A"`) phải diễn ra **100% cục bộ trên trình duyệt**.
2. **CAPTURE-PHASE INTERCEPTION:** Khi viết code chặn sự kiện `paste`, `drop`, hoặc `keydown` trên các trang SPA phức tạp (ChatGPT, Claude, Gemini, Gmail), BẮT BUỘC phải đăng ký listener ở **Capture Phase** (`window.addEventListener('paste', handler, true)`) và xử lý cả `<textarea>`, `<input>` lẫn vùng `[contenteditable="true"]`.
3. **SHADOW DOM ISOLATION:** Mọi giao diện cảnh báo hoặc Telemetry Panel tiêm vào trang web thông qua Content Script BẮT BUỘC phải bọc trong **Shadow DOM** (`createShadowRootUi` của WXT) để không bị xung đột CSS với trang đích.
4. **HARD TIMEOUT, MODEL ROUTING & FALLBACK:** Mọi lệnh gọi từ Extension lên `sandbox-api` phải có `AbortController` với timeout tối đa `3500ms`. Trên Backend, sử dụng **Smart Model Routing**: ưu tiên `gemini-3.5-flash-lite` (500 RPD) trong quá trình phát triển/test (`NODE_ENV !== 'production'`) và chuyển sang `gemini-3.8-flash` / `gemini-3.8-live-extended-thinking` khi trình diễn trên sân khấu. Nếu lỗi mạng, tự động kích hoạt `localHeuristicFallback(url)`.

---

## 2. Lệnh Làm việc trong Monorepo (Build & Run Commands)

```bash
# Cài đặt toàn bộ dependencies tại thư mục gốc
pnpm install

# Chạy môi trường phát triển của từng phân hệ
pnpm --filter extension dev          # Chạy WXT Extension ở chế độ Hot-Reload (Chromium)
pnpm --filter sandbox-api dev        # Chạy Hono + Playwright server tại cổng 8080
pnpm --filter dashboard dev          # Chạy Next.js Dashboard tại cổng 3000

# Kiểm tra kiểu dữ liệu (Type-check) toàn dự án
pnpm -r typecheck
```

---

## 3. Hợp đồng Dữ liệu Chung (`packages/shared-types/src/index.ts`)

Mọi Agent khi sinh code cho Extension, Backend hoặc Dashboard phải tuân thủ chính xác các kiểu dữ liệu TypeScript dưới đây:

```typescript
export type SensitiveDataType =
  | 'VN_CCCD'
  | 'CREDIT_CARD'
  | 'API_SECRET'
  | 'EMAIL'
  | 'PHONE_VN'
  | 'PERSON_NAME'
  | 'ORGANIZATION';

export type PolicyActionMode = 'AUTO_TOKENIZE' | 'STRICT_BLOCK' | 'AUDIT_ONLY';

export interface SecurityPolicy {
  version: number;
  updatedAt: string;
  mode: PolicyActionMode;
  enabledTypes: SensitiveDataType[];
  protectedDomains: string[]; // Ví dụ: ["chatgpt.com", "claude.ai", "gemini.google.com"]
}

export interface DlpDetectionMatch {
  type: SensitiveDataType;
  originalValue: string;
  tokenPlaceholder: string; // Ví dụ: "[ZL_CCCD_01]", "[ZL_KEY_01]"
  startIndex: number;
  endIndex: number;
  confidence: number;
}

export interface DlpScanResult {
  sanitizedText: string;
  matches: DlpDetectionMatch[];
  scanLatencyMs: number;
  entropyMax: number;
}

/**
 * Dữ liệu Telemetry ẩn danh gửi lên Dashboard (TUYỆT ĐỐI KHÔNG chứa originalValue)
 */
export interface ZeroKnowledgeTelemetryEvent {
  id: string;
  timestamp: string;
  targetDomain: string;
  actionTaken: PolicyActionMode;
  detectedTypes: SensitiveDataType[];
  matchCount: number;
  scanLatencyMs: number;
}

/**
 * Kết quả trả về từ ZeroLeak Lens (Cloud Sandbox + Safe Browsing v4 + Gemini 3.8 Flash)
 */
export interface PhishingAnalysisResponse {
  url: string;
  finalRedirectUrl: string;
  riskScore: number; // 0 - 100
  verdict: 'SAFE' | 'SUSPICIOUS' | 'MALICIOUS';
  impersonatedBrand: string | null; // Ví dụ: "Vietcombank DigiBank"
  actualDomain: string;
  hasPasswordInput: boolean;
  hasOtpInput: boolean;
  screenshotBase64?: string;
  indicators: string[];
  executionTimeMs: number;
}

export type ScamTacticType =
  | 'CEO_FRAUD'               // Giả giọng lãnh đạo yêu cầu chuyển khoản gấp
  | 'AUTHORITY_IMPERSONATION' // Giả danh Công an, Viện kiểm sát, Ngân hàng
  | 'OTP_OR_CREDENTIAL_ASK'   // Yêu cầu đọc mã OTP, mật khẩu, quét QR độc hại
  | 'URGENCY_PRESSURE';       // Thao túng tâm lý, thúc giục trong hoảng loạn

/**
 * Kết quả trả về từ ZeroLeak Voice (Audio Deepfake & Scam Script Detector)
 */
export interface VoiceScamAnalysisResult {
  riskScore: number; // 0 - 100
  verdict: 'SAFE' | 'SUSPICIOUS' | 'DEEPFAKE_SCAM';
  syntheticVoiceProbability: number; // 0.0 - 1.0
  detectedTactics: ScamTacticType[];
  transcriptSnippet: string;
  warningMessageVi: string;
  executionTimeMs: number;
}
```

---

## 4. Mẫu Triển khai Chuẩn cho Từng Phân hệ (Implementation Blueprints)

### 4.1. Bộ lọc DLP Tầng 1: Regex + Luhn Checksum + Shannon Entropy (`apps/extension/utils/deterministic-dlp.ts`)

Sử dụng thuật toán chuẩn sau để đảm bảo thời gian chạy $< 3\text{ ms}$ và không có cảnh báo giả:

```typescript
/**
 * Kiểm tra số thẻ ngân hàng hợp lệ bằng thuật toán Luhn Checksum
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
 * Tính độ hỗn loạn Shannon Entropy để bắt API Key / Secret Token
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
  // CCCD Việt Nam 12 số (bắt đầu bằng 0 + mã tỉnh 01..96)
  VN_CCCD: /\b0(?:0[1-9]|[1-8]\d|9[0-6])[0-3]\d{2}\d{6}\b/g,
  // Số điện thoại Việt Nam
  PHONE_VN: /\b(?:\+84|0)(?:3[2-9]|5[2689]|7[06-9]|8[1-9]|9\d)\d{7}\b/g,
  // Các mẫu API Key phổ biến (Google Cloud, OpenAI, GitHub, AWS)
  API_SECRET: /\b(?:AIza[0-9A-Za-z\-_]{35}|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AKIA[0-9A-Z]{16})\b/g,
  // Chuỗi ứng viên thẻ tín dụng (cần qua bước kiểm tra isValidLuhn)
  CREDIT_CARD_CANDIDATE: /\b(?:\d[ -]*?){13,19}\b/g,
};

export const TOKEN_PREFIX_MAP = {
  VN_CCCD: 'ZL_CCCD',
  CREDIT_CARD: 'ZL_CARD',
  API_SECRET: 'ZL_KEY',
  EMAIL: 'ZL_EMAIL',
  PHONE_VN: 'ZL_PHONE',
  PERSON_NAME: 'ZL_PER',
  ORGANIZATION: 'ZL_ORG',
} as const;
```

### 4.2. Chặn Sự kiện Paste & Thay thế Văn bản trong Rich-Text Editor (`apps/extension/entrypoints/content.ts`)

Các trang AI như ChatGPT và Claude dùng `ProseMirror` hoặc `contenteditable="true"` thay vì `<textarea>` thuần túy. Để chèn văn bản đã mã hóa (`[ZL_CCCD_01]`) mà không làm hỏng state của React/ProseMirror, Agent phải dùng kỹ thuật sau:

```typescript
export function replaceSelectionInEditableElement(sanitizedText: string): void {
  const activeEl = document.activeElement as HTMLElement | null;
  if (!activeEl) return;

  // Trường hợp 1: Input hoặc Textarea tiêu chuẩn
  if (activeEl instanceof HTMLTextAreaElement || activeEl instanceof HTMLInputElement) {
    const start = activeEl.selectionStart ?? activeEl.value.length;
    const end = activeEl.selectionEnd ?? activeEl.value.length;
    const before = activeEl.value.slice(0, start);
    const after = activeEl.value.slice(end);
    activeEl.value = before + sanitizedText + after;
    activeEl.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // Trường hợp 2: ContentEditable (ProseMirror của ChatGPT/Claude/Gemini)
  if (activeEl.isContentEditable) {
    const success = document.execCommand('insertText', false, sanitizedText);
    if (!success) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(sanitizedText));
        range.collapse(false);
        activeEl.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }
    }
  }
}
```

### 4.3. Khôi phục Hai chiều bằng `MutationObserver` (`apps/extension/utils/reversible-vault.ts`)

* Lưu ánh xạ vào bộ nhớ cục bộ (`Map<string, string>` trong bộ nhớ + `sessionStorage`).
* Khi AI trả lời có chứa chuỗi dạng `\[ZL_[A-Z]+_\d{2}\]` (ví dụ: `[ZL_CCCD_01]`, `[ZL_PER_01]`), `MutationObserver` chỉ quét các `TextNode` nằm bên trong vùng hiển thị câu trả lời của AI (không quét bên trong ô nhập liệu của người dùng để tránh gửi nhầm dữ liệu thật ở lượt chat tiếp theo).

### 4.4. Kiểm tra Nhanh Danh sách Đen với Google Safe Browsing API v4 (`apps/sandbox-api/src/safebrowsing.ts`)

```typescript
export async function checkUrlSafeBrowsing(urlToCheck: string, apiKey?: string) {
  if (!apiKey) return { isKnownThreat: false, threatType: null };

  const endpoint = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`;
  const payload = {
    client: { clientId: 'zeroleak-devfest-2026', clientVersion: '1.0.0' },
    threatInfo: {
      threatTypes: [
        'MALWARE',
        'SOCIAL_ENGINEERING',
        'UNWANTED_SOFTWARE',
        'POTENTIALLY_HARMFUL_APPLICATION',
      ],
      platformTypes: ['ANY_PLATFORM'],
      threatEntryTypes: ['URL'],
      threatEntries: [{ url: urlToCheck }],
    },
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return {
      isKnownThreat: Boolean(data.matches && data.matches.length > 0),
      threatType: (data.matches?.[0]?.threatType as string) ?? null,
    };
  } catch {
    return { isKnownThreat: false, threatType: null };
  }
}
```

### 4.5. Smart Model Router & Phân tích Giả mạo Thị giác (`apps/sandbox-api/src/gemini-analyzer.ts`)

Sử dụng SDK chính thức `@google/genai` kết hợp cơ chế tự động chuyển đổi giữa `gemini-3.8-flash` (khi lên sân khấu) và `gemini-3.5-flash-lite` (500 lượt/ngày khi dev/test hoặc khi chạm trần 5 RPM):

```typescript
import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const GEMINI_MODELS = {
  PRIMARY_VISION: process.env.GEMINI_MODEL_VISION || 'gemini-3.8-flash',
  FALLBACK_LITE: 'gemini-3.5-flash-lite',
};

async function generateWithFallback(contents: any[], responseSchema: any) {
  try {
    return await ai.models.generateContent({
      model: GEMINI_MODELS.PRIMARY_VISION,
      contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema,
      },
    });
  } catch (err) {
    // Tự động chuyển sang gemini-3.5-flash-lite (15 RPM / 500 RPD) nếu chạm Rate Limit
    return await ai.models.generateContent({
      model: GEMINI_MODELS.FALLBACK_LITE,
      contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema,
      },
    });
  }
}

export async function analyzeVisualPhishing(params: {
  url: string;
  finalRedirectUrl: string;
  pageTitle: string;
  domSummary: string;
  screenshotBase64: string;
}) {
  const response = await generateWithFallback(
    [
      {
        inlineData: {
          mimeType: 'image/webp',
          data: params.screenshotBase64,
        },
      },
      {
        text: `Phân tích trang web này để phát hiện tấn công giả mạo thương hiệu (Visual Phishing).
URL gốc: ${params.url}
URL đích sau chuyển hướng: ${params.finalRedirectUrl}
Tiêu đề trang: ${params.pageTitle}
Cấu trúc Form & Input trên DOM: ${params.domSummary}

Hãy đối chiếu logo, màu sắc, bố cục giao diện trong ảnh chụp màn hình với tên miền thực tế. Nếu giao diện giống ngân hàng (Vietcombank, Techcombank, MB...), ví điện tử hoặc Cổng Dịch vụ công nhưng tên miền không phải tên miền chính thức, hãy chấm riskScore >= 90 và verdict = "MALICIOUS".`,
      },
    ],
    {
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
    }
  );

  return JSON.parse(response.text!);
}
```

### 4.6. Phân tích Audio Deepfake & Scam Script — ZeroLeak Voice (`apps/sandbox-api/src/voice-analyzer.ts`)

```typescript
import { Type } from '@google/genai';
import { generateWithFallback } from './gemini-analyzer';

export async function analyzeAudioScam(audioBase64: string, mimeType = 'audio/webm') {
  const response = await generateWithFallback(
    [
      {
        inlineData: {
          mimeType,
          data: audioBase64,
        },
      },
      {
        text: `Phân tích đoạn âm thanh cuộc gọi này để phát hiện:
1. Dấu hiệu giọng nói nhân tạo (AI Deepfake / TTS Voice Cloning: nhịp thở bất thường, âm sắc máy móc, cắt tần số cao).
2. Kịch bản thao túng tâm lý lừa đảo tại Việt Nam (giả danh lãnh đạo CEO Fraud yêu cầu chuyển tiền gấp, giả danh công an/ngân hàng yêu cầu đọc mã OTP hoặc quét mã QR).
Trả về đúng định dạng JSON được yêu cầu.`,
      },
    ],
    {
      type: Type.OBJECT,
      properties: {
        riskScore: { type: Type.INTEGER },
        verdict: { type: Type.STRING, enum: ['SAFE', 'SUSPICIOUS', 'DEEPFAKE_SCAM'] },
        syntheticVoiceProbability: { type: Type.NUMBER },
        detectedTactics: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
            enum: [
              'CEO_FRAUD',
              'AUTHORITY_IMPERSONATION',
              'OTP_OR_CREDENTIAL_ASK',
              'URGENCY_PRESSURE',
            ],
          },
        },
        transcriptSnippet: { type: Type.STRING },
        warningMessageVi: { type: Type.STRING },
      },
      required: [
        'riskScore',
        'verdict',
        'syntheticVoiceProbability',
        'detectedTactics',
        'transcriptSnippet',
        'warningMessageVi',
      ],
    }
  );

  return JSON.parse(response.text!);
}
```

---

## 5. Checklist Kiểm thử trước Giờ Pitching (Definition of Done)

Khi AI Agent hoàn thành một tính năng, hãy đối chiếu với 6 bài kiểm tra nghiệm thu sau:

* [ ] **Test 1 (Edge DLP Latency):** Dán đoạn hợp đồng dài 500 từ chứa 2 số CCCD, 1 thẻ Visa hợp lệ Luhn và 1 khóa `AIza...` vào ChatGPT $\rightarrow$ Thời gian xử lý hiển thị trên Telemetry Badge phải $< 30\text{ ms}$.
* [ ] **Test 2 (Reversible Restoration):** Khi ChatGPT sinh văn bản phản hồi chứa `[ZL_CCCD_01]` và `[ZL_PER_01]`, giao diện tự động đổi lại thành số CCCD và tên thật được bọc trong nhãn màu xanh lá có hiệu ứng hover.
* [ ] **Test 3 (QR Phishing Sandbox):** Quét mã QR dẫn tới trang Demo Phishing ngân hàng $\rightarrow$ Trả về ảnh chụp màn hình từ Playwright + Điểm rủi ro $\ge 90$ từ Gemini 3.8 Flash trong $< 2.5\text{ s}$.
* [ ] **Test 4 (Realtime Policy Sync):** Đổi chế độ từ `AUTO_TOKENIZE` sang `STRICT_BLOCK` trên Dashboard $\rightarrow$ Extension nhận luật mới ngay lập tức mà không cần F5 trang web.
* [ ] **Test 5 (Offline/Timeout Resilience):** Tắt mạng Wi-Fi hoặc tắt `sandbox-api` $\rightarrow$ Extension vẫn hoạt động bình thường với bộ lọc DLP cục bộ và bộ đánh giá URL dự phòng.
* [ ] **Test 6 (Audio Deepfake & Scam):** Phát đoạn âm thanh giả giọng sếp/công an yêu cầu chuyển khoản gấp hoặc cung cấp OTP $\rightarrow$ Sóng âm chuyển đỏ và hiển thị cảnh báo kịch bản thao túng tâm lý trong $< 3\text{ s}$.