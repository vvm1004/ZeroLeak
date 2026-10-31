# 🤖 AGENT.md — AI Coding Assistant Guidelines (ZeroLeak & PhishGuard)

> **Mục đích tài liệu:** File này cung cấp toàn bộ ngữ cảnh kỹ thuật, quy chuẩn kiến trúc, hợp đồng dữ liệu (Data Contracts) và quy tắc bảo mật bắt buộc cho AI Coding Agent (Cursor, Claude Code, Windsurf, Copilot) khi tham gia viết code cho dự án **ZeroLeak & PhishGuard** tại GDG DevFest Miền Trung 2026.

## 1. Bối cảnh & Triết lý Kỹ thuật Cốt lõi

**ZeroLeak & PhishGuard** là hệ thống bảo mật lai (Hybrid Edge-Cloud Security) gồm 3 phân hệ trong một Monorepo (`pnpm workspaces`):

1. `apps/extension`: Browser Extension (Manifest V3, WXT Framework, React 19, TypeScript) thực hiện **On-Device DLP** và **Reversible Tokenization**.

2. `apps/sandbox-api`: Cloud Sandbox (Node.js, Hono, Playwright Chromium trên Google Cloud Run) kết hợp **Gemini 2.5 Flash** để phát hiện **Visual Phishing** từ URL/QR Code.

3. `apps/dashboard`: Trang quản trị chính sách thời gian thực (Next.js App Router, Shadcn UI, Firebase Firestore / Supabase Realtime) và trang Demo Phishing giả lập.

### ⚠️ 4 Nguyên tắc Bất khả xâm phạm (Strict Guardrails cho AI Agent)

1. **ZERO RAW PII EXFILTRATION:** Tuyệt đối KHÔNG BAO GIỜ gửi văn bản thô (raw text), số CCCD, thẻ tín dụng hay API Key của người dùng từ Extension lên `sandbox-api` hoặc `dashboard`. Mọi quá trình quét DLP và lưu trữ ánh xạ Token (`[PER_01]` $\leftrightarrow$ `"Nguyễn Văn A"`) phải diễn ra **100% cục bộ trên trình duyệt**.

2. **CAPTURE-PHASE INTERCEPTION:** Khi viết code chặn sự kiện `paste`, `drop`, hoặc `keydown` trên các trang SPA phức tạp (ChatGPT, Claude, Gemini, Gmail), BẮT BUỘC phải đăng ký listener ở **Capture Phase** (`window.addEventListener('paste', handler, true)`) và xử lý cả `<textarea>`, `<input>` lẫn vùng `[contenteditable="true"]`.

3. **SHADOW DOM ISOLATION:** Mọi giao diện cảnh báo hoặc Telemetry Panel tiêm vào trang web thông qua Content Script BẮT BUỘC phải bọc trong **Shadow DOM** (`createShadowRootUi` của WXT) để không bị xung đột CSS với trang đích.

4. **HARD TIMEOUT & FALLBACK:** Mọi lệnh gọi từ Extension lên Cloud Sandbox phải có `AbortController` với timeout tối đa `3500ms`. Nếu quá thời gian hoặc lỗi mạng, phải tự động kích hoạt `localHeuristicFallback(url)` để buổi Live Demo trên sân khấu không bao giờ bị treo.

## 2. Lệnh Làm việc trong Monorepo (Build & Run Commands)

```
# Cài đặt toàn bộ dependencies tại thư mục gốc
pnpm install

# Chạy môi trường phát triển của từng phân hệ
pnpm --filter extension dev          # Chạy WXT Extension ở chế độ Hot-Reload (Chromium)
pnpm --filter sandbox-api dev        # Chạy Hono + Playwright server tại cổng 8080
pnpm --filter dashboard dev          # Chạy Next.js Dashboard tại cổng 3000

# Kiểm tra kiểu dữ liệu (Type-check) toàn dự án
pnpm -r typecheck

```

## 3. Hợp đồng Dữ liệu Chung (`packages/shared-types/src/index.ts`)

Mọi Agent khi sinh code cho Extension, Backend hoặc Dashboard phải tuân thủ chính xác các kiểu dữ liệu TypeScript dưới đây:

```
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
  tokenPlaceholder: string; // Ví dụ: "[VN_CCCD_01]", "[API_SECRET_01]"
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
 * Dữ liệu Telemetry ẩn danh gửi lên Dashboard (KHÔNG chứa originalValue)
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
 * Kết quả trả về từ Cloud Sandbox + Gemini 2.5 Flash
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

```

## 4. Mẫu Triển khai Chuẩn cho Từng Phân hệ (Implementation Blueprints)

### 4.1. Bộ lọc DLP Tầng 1: Regex + Luhn Checksum + Shannon Entropy (`apps/extension/utils/deterministic-dlp.ts`)

Khi viết hoặc nâng cấp bộ lọc DLP cục bộ, sử dụng thuật toán chuẩn sau để đảm bảo thời gian chạy $< 3\text{ ms}$ và không có cảnh báo giả:

```
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

```

### 4.2. Chặn Sự kiện Paste & Thay thế Văn bản trong Rich-Text Editor (`apps/extension/entrypoints/content.ts`)

Các trang AI như ChatGPT và Claude dùng `ProseMirror` hoặc `contenteditable="true"` thay vì `<textarea>` thuần túy. Để chèn văn bản đã mã hóa (`[VN_CCCD_01]`) mà không làm hỏng state của React/ProseMirror, Agent phải dùng kỹ thuật sau:

```
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
    // Kích hoạt sự kiện input để React/Vue cập nhật state
    activeEl.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // Trường hợp 2: ContentEditable (ProseMirror của ChatGPT/Claude)
  if (activeEl.isContentEditable) {
    // execCommand('insertText') giúp giữ nguyên Undo Stack và đồng bộ với Virtual DOM của ProseMirror
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

* Khi AI trả lời có chứa chuỗi dạng `\[[A-Z_]+_\d{2}\]` (ví dụ: `[VN_CCCD_01]`), `MutationObserver` chỉ quét các `TextNode` nằm bên trong vùng hiển thị câu trả lời của AI (không quét bên trong ô nhập liệu của người dùng để tránh gửi nhầm dữ liệu thật ở lượt chat tiếp theo).

### 4.4. Cấu hình Gemini 2.5 Flash Structured Output (`apps/sandbox-api/src/gemini-analyzer.ts`)

Sử dụng SDK chính thức `@google/genai` với `responseMimeType: "application/json"` và `responseSchema` để đảm bảo Gemini 2.5 Flash luôn trả về JSON khớp 100% với `PhishingAnalysisResponse`:

```
import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function analyzeVisualPhishing(params: {
  url: string;
  finalRedirectUrl: string;
  pageTitle: string;
  domSummary: string;
  screenshotBase64: string;
}) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
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
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
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
      },
    },
  });

  return JSON.parse(response.text!);
}

```

## 5. Checklist Kiểm thử trước Giờ Pitching (Definition of Done)

Khi AI Agent hoàn thành một tính năng, hãy đối chiếu với 5 bài kiểm tra nghiệm thu sau:

* \[ \] **Test 1 (Edge DLP Latency):** Dán đoạn hợp đồng dài 500 từ chứa 2 số CCCD, 1 thẻ Visa hợp lệ Luhn và 1 khóa `AIza...` vào ChatGPT $\rightarrow$ Thời gian xử lý hiển thị trên Telemetry Badge phải $< 30\text{ ms}$.

* \[ \] **Test 2 (Reversible Restoration):** Khi ChatGPT sinh văn bản phản hồi chứa `[VN_CCCD_01]`, giao diện tự động đổi lại thành số CCCD thật được bọc trong nhãn màu xanh lá có hiệu ứng hover.

* \[ \] **Test 3 (QR Phishing Sandbox):** Quét mã QR dẫn tới trang Demo Phishing ngân hàng $\rightarrow$ Trả về ảnh chụp màn hình từ Playwright + Điểm rủi ro $\ge 90$ từ Gemini 2.5 Flash trong $< 2.5\text{ s}$.

* \[ \] **Test 4 (Realtime Policy Sync):** Đổi chế độ từ `AUTO_TOKENIZE` sang `STRICT_BLOCK` trên Dashboard $\rightarrow$ Extension nhận luật mới ngay lập tức mà không cần F5 trang web.

* \[ \] **Test 5 (Offline/Timeout Resilience):** Tắt mạng Wi-Fi hoặc tắt `sandbox-api` $\rightarrow$ Extension vẫn hoạt động bình thường với bộ lọc DLP cục bộ và bộ đánh giá URL dự phòng.