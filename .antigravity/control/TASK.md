# ✅ TASK.md — Bảng Theo dõi Tiến độ ZeroLeak & PhishGuard

**Cuộc thi:** GDG DevFest Miền Trung 2026

**Chủ đề:** An ninh mạng (Cybersecurity)

**Quy ước trạng thái:**

* `- [ ]` Chưa thực hiện (To Do)

* `- [-]` Đang thực hiện (In Progress)

* `- [x]` Đã hoàn thành & Test xong (Done)

**Quy ước độ ưu tiên:**

* 🔴 **\[P0 - Core MVP\]:** Bắt buộc phải hoàn thành để chạy luồng Live Demo chính.

* 🟡 **\[P1 - Technical Depth\]:** Tính năng nâng cao giúp ăn điểm kỹ thuật với Ban Giám khảo.

* 🟢 **\[P2 - Polish & UX\]:** Hiệu ứng giao diện, tối ưu tốc độ và trang trí.

## 📦 Phase 0: Khởi tạo Monorepo & Hạ tầng Chung (Giờ 00 – Giờ 03)

*Phụ trách chính: Cả đội (Tech Lead điều phối)*

* [x] 🔴 **[P0]** Khởi tạo Git Repository và cấu hình `pnpm-workspace.yaml` với 3 apps (`extension`, `sandbox-api`, `dashboard`) và 1 package (`shared-types`).

* [x] 🔴 **[P0]** Viết toàn bộ TypeScript Interfaces dùng chung trong `packages/shared-types/src/index.ts`:

  * [x] `SecurityPolicy` & `PolicyActionMode` (`AUTO_TOKENIZE`, `STRICT_BLOCK`, `AUDIT_ONLY`)

  * [x] `DlpDetectionMatch` & `DlpScanResult`

  * [x] `ZeroKnowledgeTelemetryEvent` (Đảm bảo không chứa trường dữ liệu nhạy cảm thô)

  * [x] `PhishingAnalysisResponse`

* [x] 🔴 **[P0]** Khởi tạo Project trên **Firebase Firestore** (hoặc **Supabase**) và bật tính năng **Realtime Subscription** cho 2 bảng/collection: `policies` và `telemetry_events`.

* [x] 🔴 **[P0]** Tạo file `.env.example` chuẩn hóa các khóa cấu hình: `GEMINI_API_KEY`, `GOOGLE_WEBRISK_API_KEY`, `FIREBASE_CONFIG`, `SANDBOX_API_URL`.

## 🛡️ Epic 1: Browser Extension & On-Device DLP (`apps/extension`)

*Phụ trách chính: Dev 1 (Extension Lead) & Dev 3 (Security Engine Lead)*

### 1.1. Khung Extension & Chặn Sự kiện DOM (Dev 1)

* [x] 🔴 **[P0]** Khởi tạo project Browser Extension Manifest V3 bằng **WXT Framework** (React 19 + TypeScript + TailwindCSS).

* [x] 🔴 **[P0]** Viết `entrypoints/content.ts` đăng ký lắng nghe sự kiện `paste` và `drop` ở **Capture Phase** (`window.addEventListener('paste', handler, true)`).

* [x] 🔴 **[P0]** Xử lý hàm ghi đè văn bản đã làm sạch (`replaceSelectionInEditableElement`) tương thích với:

  * [x] Ô `<textarea>` và `<input>` truyền thống.

  * [x] Vùng soạn thảo `[contenteditable="true"]` / `ProseMirror` trên **ChatGPT**, **Claude**, **Gemini** và **Gmail**.

* [x] 🟡 **[P1]** Chặn sự kiện bấm nút gửi hoặc phím `Enter` khi chính sách của doanh nghiệp đang ở chế độ `STRICT_BLOCK`.

### 1.2. Động cơ Quét DLP Cục bộ Đa tầng (Dev 3)

* \[ \] 🔴 **\[P0\]** Cài đặt bộ lọc **Tầng 1 (Deterministic Filter)** trong `utils/deterministic-dlp.ts`:

  * \[ \] Regex nhận diện **CCCD Việt Nam 12 số** (kiểm tra mã tỉnh hợp lệ `001`–`096`).

  * \[ \] Regex nhận diện **Số điện thoại Việt Nam** (`+84` hoặc `03/05/07/08/09`).

  * \[ \] Regex nhận diện thẻ ngân hàng kết hợp thuật toán kiểm tra **Luhn Checksum** (`isValidLuhn`).

  * \[ \] Regex nhận diện tiền tố **API Key** (`AIza...`, `sk-...`, `ghp_...`, `AKIA...`) kết hợp hàm đo độ hỗn loạn **Shannon Entropy** ($H(X) > 4.5$).

* \[ \] 🟡 **\[P1\]** Đóng gói bộ quét vào **Web Worker** (`workers/dlp.worker.ts`) để không làm khựng giao diện khi người dùng dán văn bản dài.

* \[ \] 🟡 **\[P1\]** Tích hợp **Tầng 2 (Contextual AI)** nhận diện Tên người (`PER`) và Tổ chức (`ORG`) bằng **Transformers.js (ONNX Quantized NER)** hoặc **Chrome Built-in AI (`window.ai` / Gemini Nano)** với cơ chế fallback mượt mà nếu trình duyệt chưa bật cờ AI.

### 1.3. Mã hóa Hai chiều Cục bộ — Reversible Tokenization (Dev 1)

* \[ \] 🔴 **\[P0\]** Xây dựng `utils/reversible-vault.ts` lưu trữ cặp ánh xạ `[VN_CCCD_01]` $\leftrightarrow$ `"048099001234"` trong bộ nhớ phiên (`Map` + `sessionStorage`).

* \[ \] 🔴 **\[P0\]** Viết `MutationObserver` theo dõi luồng câu trả lời (streaming response) của ChatGPT/Gemini:

  * \[ \] Tự động phát hiện các nhãn `[PER_01]`, `[VN_CCCD_01]`, `[API_SECRET_01]` ngay khi AI vừa sinh ra.

  * \[ \] Thay thế tức thì bằng giá trị thật trên màn hình người dùng kèm thẻ badge màu xanh lá có tooltip *"Đã khôi phục cục bộ bởi ZeroLeak"*.

  * \[ \] Đảm bảo `MutationObserver` bỏ qua vùng ô nhập liệu để không làm lộ dữ liệu thật ở lượt gửi tiếp theo.

### 1.4. Giao diện Cảnh báo Shadow DOM & Quét Mã QR (Dev 1 & Dev 3)

* \[ \] 🔴 **\[P0\]** Tạo **Shadow DOM Toast / Telemetry Badge** (`createShadowRootUi`) ở góc dưới màn hình hiển thị trực tiếp:

  * \[ \] Thời gian quét cục bộ (ví dụ: `Edge DLP Latency: 11ms`).

  * \[ \] Số lượng thông tin nhạy cảm vừa được ẩn danh.

* \[ \] 🔴 **\[P0\]** Tạo Context Menu chuột phải: *"Kiểm tra liên kết an toàn với PhishGuard"*.

* \[ \] 🟡 **\[P1\]** Tích hợp công cụ chụp vùng màn hình và giải mã **QR Code** bằng thư viện `jsQR` (`utils/qr-scanner.ts`), tự động gửi URL trích xuất được lên Cloud Sandbox.

* \[ \] 🟢 **\[P2\]** Thiết kế giao diện Popup của Extension hiển thị trạng thái kết nối Policy, chế độ bảo vệ hiện tại và bộ đếm số vụ rò rỉ đã chặn trong ngày.

## ☁️ Epic 2: Cloud Phishing Sandbox & Multimodal AI (`apps/sandbox-api`)

*Phụ trách chính: Dev 2 (Backend & Cloud Lead)*

### 2.1. Máy chủ Cô lập Playwright Headless

* \[ \] 🔴 **\[P0\]** Khởi tạo server **Hono** (hoặc **Fastify**) bằng TypeScript tại `apps/sandbox-api/src/index.ts` với endpoint `POST /api/v1/analyze-url`.

* \[ \] 🔴 **\[P0\]** Viết mô-đun `playwright.ts` mở URL mục tiêu trong Headless Chromium cô lập:

  * \[ \] Thiết lập viewport `1280x720` và timeout tải trang tối đa $2000\text{ ms}$.

  * \[ \] Thu thập chuỗi chuyển hướng (`finalRedirectUrl`), tiêu đề trang (`pageTitle`).

  * \[ \] Bóc tách cấu trúc DOM để kiểm tra sự tồn tại của `<input type="password">`, ô nhập mã OTP hoặc Seed Phrase.

  * \[ \] Chụp ảnh màn hình trang web nén sang định dạng **WebP Base64** nhẹ.

### 2.2. Phân tích Giả mạo Thị giác với Gemini 3.5 Flash Lite

* \[ \] 🔴 **\[P0\]** Viết mô-đun `gemini-analyzer.ts` sử dụng `@google/genai` SDK gọi mô hình `gemini-3.5-flash-lite`.

* \[ \] 🔴 **\[P0\]** Cấu hình **Structured Outputs (`responseSchema`)** ép kết quả trả về đúng chuẩn JSON: `riskScore` ($0\text{–}100$), `verdict` (`SAFE` | `SUSPICIOUS` | `MALICIOUS`), `impersonatedBrand`, và danh sách `indicators` bằng tiếng Việt rõ ràng.

* \[ \] 🟡 **\[P1\]** Tích hợp thêm **Google Web Risk API** (`webrisk.ts`) để kiểm tra song song với danh sách đen toàn cầu của Google.

### 2.3. Tối ưu Tốc độ, Dự phòng & Triển khai Cloud Run

* \[ \] 🔴 **\[P0\]** Cài đặt **In-Memory LRU Cache** lưu kết quả phân tích theo URL để các lần quét lặp lại khi demo trên sân khấu trả về tức thì trong $< 50\text{ ms}$.

* \[ \] 🔴 **\[P0\]** Viết bộ đánh giá dự phòng `localHeuristicFallback(url)` trong Extension phòng trường hợp mạng Wi-Fi tại hội trường bị nghẽn.

* \[ \] 🟡 **\[P1\]** Viết `Dockerfile` chuẩn (dùng base image `mcr.microsoft.com/playwright`) và triển khai dịch vụ lên **Google Cloud Run**.

## 📊 Epic 3: Realtime Admin Dashboard & Trang Demo Phishing (`apps/dashboard`)

*Phụ trách chính: Dev 4 (Fullstack/UI) hoặc chia cho Dev 1 & Dev 2*

### 3.1. Trang Quản trị Chính sách & Telemetry Thời gian thực

* \[ \] 🔴 **\[P0\]** Khởi tạo ứng dụng **Next.js (App Router)** + **Shadcn UI** + **Lucide Icons** + **Recharts**.

* \[ \] 🔴 **\[P0\]** Xây dựng bảng điều khiển **Security Policy Engine**:

  * \[ \] Nút gạt chuyển đổi trực tiếp giữa 3 chế độ: `AUTO_TOKENIZE` (Tự động ẩn danh), `STRICT_BLOCK` (Chặn cứng), `AUDIT_ONLY` (Chỉ ghi nhận).

  * \[ \] Các ô checkbox bật/tắt từng loại dữ liệu nhạy cảm (`VN_CCCD`, `CREDIT_CARD`, `API_SECRET`, `PHONE_VN`, `PERSON_NAME`).

  * \[ \] Kết nối Firestore/Supabase đẩy thay đổi xuống Browser Extension trong $< 500\text{ ms}$.

* \[ \] 🔴 **\[P0\]** Xây dựng bảng **Zero-Knowledge Live Audit Log**:

  * \[ \] Tự động nhảy dòng mới theo thời gian thực kèm hiệu ứng sáng đèn khi Extension chặn một vụ dán dữ liệu nhạy cảm.

  * \[ \] Hiển thị rõ ràng: Thời gian, Trang đích (`chatgpt.com`), Loại dữ liệu phát hiện, Hành động xử lý và Độ trễ ($12\text{ ms}$) — tuyệt đối không lưu dữ liệu thô của người dùng.

* \[ \] 🟢 **\[P2\]** Vẽ 2 biểu đồ trực quan bằng **Recharts**: Thống kê tỷ lệ các loại dữ liệu nhạy cảm bị rò rỉ và Số lượng trang Phishing bị chặn theo giờ.

### 3.2. Trang Giả lập Lừa đảo để Phục vụ Live Demo (`/demo-phishing`)

* \[ \] 🔴 **\[P0\]** Thiết kế 1 trang giả lập giao diện đăng nhập ngân hàng/ví điện tử (có gắn nhãn *"Trang Mô Phỏng Phục Vụ Cuộc Thi An Ninh Mạng DevFest"* ở footer) chứa ô nhập mật khẩu và mã OTP.

* \[ \] 🔴 **\[P0\]** Tạo 1 trang **Email Giả lập** có đính kèm **Mã QR** dẫn tới đường link `/demo-phishing` để đội thi dùng tính năng quét QR của Extension bắt sống ngay trên sân khấu.

## 🏆 Epic 4: Kiểm thử Nghiệm thu, Đóng gói & Pitching (Giờ 25 – Giờ 36)

*Phụ trách chính: Cả đội*

### 4.1. Checklist Nghiệm thu Kỹ thuật (Definition of Done)

* \[ \] 🔴 **\[Test 1 - Edge DLP Speed\]** Dán đoạn hợp đồng mẫu chứa CCCD, thẻ Visa hợp lệ Luhn và khóa `AIza...` vào ChatGPT $\rightarrow$ Mã hóa thành công với độ trễ hiển thị $< 30\text{ ms}$.

* \[ \] 🔴 **\[Test 2 - Reversible Vault\]** ChatGPT phản hồi văn bản có chứa `[VN_CCCD_01]` và `[PER_01]` $\rightarrow$ Giao diện tự động khôi phục lại tên và số CCCD thật màu xanh lá.

* \[ \] 🔴 **\[Test 3 - QR & Visual Phishing\]** Khoanh vùng mã QR trong email mẫu $\rightarrow$ Hiển thị ảnh chụp từ Playwright Sandbox + Cảnh báo đỏ của Gemini 3.5 Flash Lite (`Risk Score >= 90`) trong $< 2.5\text{ s}$.

* \[ \] 🔴 **\[Test 4 - Realtime Policy Sync\]** Bật chế độ `STRICT_BLOCK` trên Dashboard $\rightarrow$ Quay sang tab ChatGPT dán thử API Key bị khóa cứng ngay lập tức mà không cần tải lại trang.

* \[ \] 🔴 **\[Test 5 - Fault Tolerance\]** Ngắt thử kết nối tới `sandbox-api` $\rightarrow$ Extension tự động chuyển sang chế độ Fallback cục bộ, không văng lỗi đỏ trên Console.

### 4.2. Chuẩn bị Sân khấu & Slide Thuyết trình

* \[ \] 🔴 **\[P0\]** Soạn file `DEMO_DATA.md` lưu sẵn 3 đoạn văn bản hợp đồng/mã nguồn mẫu để chỉ cần Copy & Paste nhanh khi đứng trên sân khấu.

* \[ \] 🔴 **\[P0\]** Quay 1 video **Backup Demo 1080p** (không cắt ghép, quay trọn vẹn màn hình 2 phút) phòng trường hợp sự cố máy chiếu hoặc mất mạng toàn hội trường.

* \[ \] 🔴 **\[P0\]** Hoàn thiện Slide Pitching (tối đa 7–8 trang):

  * \[ \] Trang 1: Bài toán thực tế & Thiệt hại rò rỉ dữ liệu lên AI / Lừa đảo QR.

  * \[ \] Trang 2: Kiến trúc **Hybrid Edge-Cloud Security** (Sơ đồ luồng dữ liệu).

  * \[ \] Trang 3: Chiều sâu kỹ thuật 1 — **On-Device DLP & Reversible Tokenization**.

  * \[ \] Trang 4: Chiều sâu kỹ thuật 2 — **Playwright Cloud Sandbox & Gemini 3.5 Flash Lite Visual Phishing**.

  * \[ \] Trang 5: **Live Demo trực tiếp trên sân khấu**.

  * \[ \] Trang 6: Kết quả Benchmark thực tế (Độ trễ $< 15\text{ ms}$, Độ chính xác, Zero-Knowledge Privacy).

* \[ \] 🔴 **\[P0\]** Chạy thử (Dry-run) kịch bản thuyết trình 3 phút ít nhất 3 lần giữa các thành viên để khớp thao tác bấm máy và lời nói.