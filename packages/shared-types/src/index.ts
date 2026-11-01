/**
 * @zeroleak/shared-types
 * Shared TypeScript Data Contracts for ZeroLeak & PhishGuard
 * GDG DevFest Mien Trung 2026
 */

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
 * Strict Guardrail: Zero Raw PII Exfiltration.
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
 * Kết quả trả về từ Cloud Sandbox + Gemini 3.5 Flash Lite
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

/**
 * Request payload gửi từ Extension lên Sandbox API
 */
export interface AnalyzeUrlRequest {
  url: string;
  sourceContext?: 'CONTEXT_MENU' | 'QR_CODE' | 'DIRECT_CHECK';
  timeoutMs?: number;
}

/**
 * Request payload gửi kèm ảnh QR giải mã
 */
export interface AnalyzeQrRequest {
  qrData: string;
  capturedAt: string;
}

/**
 * Thông tin thống kê tổng hợp dùng cho Dashboard Metrics
 */
export interface TelemetrySummary {
  totalScans: number;
  totalTokensCreated: number;
  totalBlockedAttempts: number;
  avgLatencyMs: number;
  threatDistribution: Record<SensitiveDataType, number>;
  recentEvents: ZeroKnowledgeTelemetryEvent[];
}

/**
 * Danh sách tên miền mặc định cần kích hoạt On-Device DLP
 */
export const DEFAULT_PROTECTED_DOMAINS: string[] = [
  'chatgpt.com',
  'chat.openai.com',
  'claude.ai',
  'gemini.google.com',
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
];

/**
 * Cấu hình chính sách bảo mật mặc định (Fallback & Initial State)
 */
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  version: 1,
  updatedAt: new Date().toISOString(),
  mode: 'AUTO_TOKENIZE',
  enabledTypes: [
    'VN_CCCD',
    'CREDIT_CARD',
    'API_SECRET',
    'EMAIL',
    'PHONE_VN',
    'PERSON_NAME',
    'ORGANIZATION',
  ],
  protectedDomains: DEFAULT_PROTECTED_DOMAINS,
};

