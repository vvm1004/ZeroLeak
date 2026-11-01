# 🛡️ ZeroLeak & PhishGuard

> **Hệ thống Bảo mật Lai (Hybrid Edge-Cloud Security Platform)**
> 
> *GDG DevFest Miền Trung 2026 — Track: Cybersecurity*

---

## 🌟 2 Trụ cột Kỹ thuật Cốt lõi

1. **ZeroLeak (On-Device Data Loss Prevention):**
   * Bảo vệ người dùng trước nguy cơ rò rỉ dữ liệu nhạy cảm (CCCD, Thẻ ngân hàng, API Key, Thông tin PII) khi sử dụng các công cụ AI (ChatGPT, Claude, Gemini) hoặc web form.
   * **Reversible Tokenization:** Thay thế thông tin nhạy cảm bằng mã định danh an toàn (`[VN_CCCD_01]`, `[API_SECRET_01]`) trước khi gửi lên máy chủ AI, và tự động khôi phục hai chiều trên DOM của trình duyệt bằng `MutationObserver`.
   * **100% Cục bộ:** Quá trình quét DLP và lưu trữ ánh xạ diễn ra hoàn toàn trên thiết bị của người dùng, không bao giờ gửi văn bản thô ra ngoài.

2. **PhishGuard (Isolated Cloud Sandbox & Visual Phishing Detection):**
   * Phát hiện lừa đảo qua đường dẫn (URL) và mã QR theo thời gian thực.
   * Mở liên kết đáng ngờ trong môi trường cô lập **Playwright Headless Chromium** trên **Google Cloud Run**, thu thập ảnh chụp màn hình WebP và cấu trúc DOM form/input.
   * Đối chiếu giao diện và thương hiệu bằng **Gemini 3.5 Flash Lite Multimodal** nhằm phát hiện các trang mạo danh ngân hàng và cổng dịch vụ công (Visual Brand Impersonation) chưa có trong danh sách đen (Zero-day).

---

## 📂 Kiến trúc Monorepo (`pnpm workspaces`)

```text
MirageSec/
├── apps/
│   ├── extension/          # Browser Extension Manifest V3 (WXT + React 19 + TypeScript)
│   ├── sandbox-api/        # Cloud Sandbox API (Hono + Playwright + Gemini 3.5 Flash Lite)
│   └── dashboard/          # Realtime Operations Dashboard (Next.js 15 App Router + TailwindCSS)
├── packages/
│   ├── shared-types/       # Hợp đồng dữ liệu chung (Data Contracts)
│   └── firebase-config/    # Client & Realtime Sync Bus cho Policy & Telemetry
├── .env.example            # Bản mẫu cấu hình biến môi trường
├── firestore.rules         # Luật bảo mật Cloud Firestore ngăn chặn rò rỉ PII
└── pnpm-workspace.yaml     # Cấu hình workspace monorepo
```

---

## 🚀 Hướng dẫn Cài đặt & Chạy Môi trường Phát triển

### 1. Cài đặt Dependencies
```bash
pnpm install
```

### 2. Cấu hình Biến Môi trường
Sao chép `.env.example` thành `.env` và điền các khóa cấu hình:
```bash
cp .env.example .env
```

### 3. Chạy các Phân hệ
```bash
# Chạy Extension ở chế độ Hot-Reload
pnpm dev:extension

# Chạy Cloud Sandbox API tại http://localhost:8080
pnpm dev:sandbox

# Chạy Admin Dashboard tại http://localhost:3000
pnpm dev:dashboard

# Kiểm tra kiểu dữ liệu TypeScript toàn bộ workspace
pnpm typecheck
```

