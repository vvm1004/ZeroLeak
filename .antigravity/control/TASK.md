# ✅ TASK.md — Bảng Theo dõi Tiến độ ZeroLeak

**Cuộc thi:** GDG DevFest Miền Trung 2026  
**Chủ đề:** An ninh mạng (Cybersecurity)  
**Tagline:** *"Zero Data Exposed. Zero Credentials Stolen."*

**Quy ước trạng thái:**
* `- [ ]` Chưa thực hiện (To Do - 70% Code tại Hackathon)
* `- [-]` Đang thực hiện (In Progress)
* `- [x]` Đã hoàn thành & Test xong (Done - 30% Nộp Vòng loại)

**Quy ước độ ưu tiên:**
* 🔴 **[P0 - Core MVP]:** Bắt buộc phải hoàn thành để chạy luồng Live Demo chính.
* 🟡 **[P1 - Technical Depth]:** Tính năng nâng cao giúp ăn điểm kỹ thuật với Ban Giám khảo.
* 🟢 **[P2 - Polish & UX]:** Hiệu ứng giao diện, tối ưu tốc độ và trang trí.

---

## 📦 Phase 0: Khởi tạo Monorepo & Hạ tầng Chung (Đã hoàn thiện trong gói 30%)

*Phụ trách chính: Cả đội (Tech Lead điều phối)*

* [x] 🔴 **[P0]** Khởi tạo Git Repository và cấu hình `pnpm-workspace.yaml` với 3 apps (`extension`, `sandbox-api`, `dashboard`) và 1 package (`shared-types`).
* [x] 🔴 **[P0]** Viết các TypeScript Interfaces dùng chung trong `packages/shared-types/src/index.ts`:
  * [x] `SecurityPolicy` & `PolicyActionMode` (`AUTO_TOKENIZE`, `STRICT_BLOCK`, `AUDIT_ONLY`)
  * [x] `DlpDetectionMatch` & `DlpScanResult`
  * [x] `ZeroKnowledgeTelemetryEvent` (Đảm bảo không chứa trường dữ liệu nhạy cảm thô)
  * [x] `PhishingAnalysisResponse`
  * [x] `VoiceScamAnalysisResult` & `ScamTacticType` (Interface kết quả phân tích Deepfake & Scam Script cho ZeroLeak Voice)
* [x] 🔴 **[P0]** Khởi tạo Project trên **Firebase Firestore** (hoặc **Supabase**) và bật tính năng **Realtime Subscription** cho 2 bảng/collection: `policies` và `telemetry_events`.
* [x] 🔴 **[P0]** Tạo file `.env.example` chuẩn hóa các khóa cấu hình: `GEMINI_API_KEY`, `GOOGLE_SAFE_BROWSING_API_KEY`, `FIREBASE_CONFIG`, `SANDBOX_API_URL`, `GEMINI_MODEL_VISION="gemini-3.5-flash-lite"` (đổi sang `"gemini-3.8-flash"` khi lên sân khấu).

---

## 🛡️ Epic 1: ZeroLeak Vault — Browser Extension & On-Device DLP (`apps/extension`)

*Phụ trách chính: Dev 1 (Extension Lead) & Dev 3 (Security Engine Lead)*

### 1.1. Khung Extension & Chặn Sự kiện DOM (Dev 1)
* [x] 🔴 **[P0]** Khởi tạo project Browser Extension Manifest V3 bằng **WXT Framework** (React 19 + TypeScript + TailwindCSS).
* [x] 🔴 **[P0]** Viết `entrypoints/content.ts` đăng ký lắng nghe sự kiện `paste` và `drop` ở **Capture Phase** (`window.addEventListener('paste', handler, true)`).
* [x] 🔴 **[P0]** Xử lý hàm ghi đè văn bản đã làm sạch (`replaceSelectionInEditableElement`) tương thích với:
  * [x] Ô `<textarea>` và `<input>` truyền thống.
  * [x] Vùng soạn thảo `[contenteditable="true"]` / `ProseMirror` trên **ChatGPT**, **Claude**, **Gemini** và **Gmail**.
* [x] 🟡 **[P1]** Chặn sự kiện bấm nút gửi hoặc phím `Enter` khi chính sách của doanh nghiệp đang ở chế độ `STRICT_BLOCK`.

### 1.2. Động cơ Quét DLP Cục bộ Đa tầng (Dev 3)
* [x] 🔴 **[P0]** Cài đặt bộ lọc **Tầng 1 (Deterministic Filter)** trong `utils/deterministic-dlp.ts`:
  * [x] Regex nhận diện **CCCD Việt Nam 12 số** (kiểm tra mã tỉnh hợp lệ `001`–`096`).
  * [x] Regex nhận diện **Số điện thoại Việt Nam** (`+84` hoặc `03/05/07/08/09`).
  * [x] Regex nhận diện thẻ ngân hàng kết hợp thuật toán kiểm tra **Luhn Checksum** (`isValidLuhn`).
  * [x] Regex nhận diện tiền tố **API Key** (`AIza...`, `sk-...`, `ghp_...`, `AKIA...`) kết hợp hàm đo độ hỗn loạn **Shannon Entropy** ($H(X) > 4.5$).
* [x] 🟡 **[P1]** Đóng gói bộ quét vào **Web Worker** (`workers/dlp.worker.ts`) để không làm khựng giao diện khi người dùng dán văn bản dài.
* [x] 🟡 **[P1]** Tích hợp **Tầng 2 (Contextual AI)** nhận diện Tên người (`PER`) và Tổ chức (`ORG`) bằng **Contextual Heuristics + Chrome Built-in AI (`window.ai` / Gemini Nano & WebGPU)** với cơ chế fallback mượt mà nếu trình duyệt chưa bật cờ AI.

### 1.3. Mã hóa Hai chiều Cục bộ — Reversible Tokenization (Dev 1)
* [x] 🔴 **[P0]** Xây dựng `utils/reversible-vault.ts` lưu trữ cặp ánh xạ `[ZL_CCCD_01]` $\leftrightarrow$ `"048099001234"` trong bộ nhớ phiên (`Map` + `sessionStorage`).
* [x] 🔴 **[P0]** Viết `MutationObserver` theo dõi luồng câu trả lời (streaming response) của ChatGPT/Gemini:
  * [x] Tự động phát hiện các nhãn `[ZL_PER_01]`, `[ZL_CCCD_01]`, `[ZL_KEY_01]` ngay khi AI vừa sinh ra.
  * [x] Thay thế tức thì bằng giá trị thật trên màn hình người dùng kèm thẻ badge màu xanh lá có tooltip *"Đã khôi phục cục bộ bởi ZeroLeak"*.
  * [x] Đảm bảo `MutationObserver` bỏ qua vùng ô nhập liệu để không làm lộ dữ liệu thật ở lượt gửi tiếp theo.

### 1.4. Giao diện Cảnh báo Shadow DOM & Quét Mã QR (Dev 1 & Dev 3)
* [x] 🔴 **[P0]** Tạo **Shadow DOM Toast / Telemetry Badge** (`createShadowRootUi`) ở góc dưới màn hình hiển thị trực tiếp:
  * [x] Thời gian quét cục bộ (ví dụ: `Edge DLP Latency: 11ms`).
  * [x] Số lượng thông tin nhạy cảm vừa được ẩn danh.
* [x] 🔴 **[P0]** Tạo Context Menu chuột phải: *"Kiểm tra liên kết an toàn với ZeroLeak Lens"*.
* [x] 🟡 **[P1]** Tích hợp công cụ chụp vùng màn hình và giải mã **QR Code** bằng thư viện `jsQR` (`utils/qr-scanner.ts`), tự động gửi URL trích xuất được lên Cloud Sandbox.
* [x] 🟢 **[P2]** Thiết kế giao diện Popup của Extension hiển thị trạng thái kết nối Policy, chế độ bảo vệ hiện tại và bộ đếm số vụ rò rỉ đã chặn trong ngày.

---

## ☁️ Epic 2: ZeroLeak Lens & ZeroLeak Voice — Cloud Sandbox & Multimodal AI (`apps/sandbox-api`)

*Phụ trách chính: Dev 2 (Backend & Cloud Lead)*

### 2.1. Máy chủ Cô lập Playwright Headless (ZeroLeak Lens)
* [ ] 🔴 **[P0]** Khởi tạo server **Hono** (hoặc **Fastify**) bằng TypeScript tại `apps/sandbox-api/src/index.ts` với endpoint `POST /api/v1/analyze-url`.
* [ ] 🔴 **[P0]** Viết mô-đun `playwright.ts` mở URL mục tiêu trong Headless Chromium cô lập:
  * [ ] Thiết lập bộ lọc chống SSRF, viewport `1280x720` và timeout tải trang tối đa $2000\text{ ms}$.
  * [ ] Thu thập chuỗi chuyển hướng (`finalRedirectUrl`), tiêu đề trang (`pageTitle`).
  * [ ] Bóc tách cấu trúc DOM để kiểm tra sự tồn tại của `<input type="password">`, ô nhập mã OTP hoặc Seed Phrase.
  * [ ] Chụp ảnh màn hình trang web nén sang định dạng **WebP Base64** nhẹ.

### 2.2. Phân tích Giả mạo Thị giác với Gemini 3.8 Flash / 3.5 Flash Lite & Safe Browsing v4
* [ ] 🔴 **[P0]** Viết mô-đun `gemini-analyzer.ts` sử dụng `@google/genai` SDK gọi mô hình `gemini-3.8-flash` (tự động fallback sang `gemini-3.5-flash-lite` khi test DEV).
* [ ] 🔴 **[P0]** Cấu hình **Structured Outputs (`responseSchema`)** ép kết quả trả về đúng chuẩn JSON: `riskScore` ($0\text{–}100$), `verdict` (`SAFE` | `SUSPICIOUS` | `MALICIOUS`), `impersonatedBrand`, và danh sách `indicators` bằng tiếng Việt rõ ràng.
* [ ] 🟡 **[P1]** Tích hợp **Google Safe Browsing API v4** (`safebrowsing.ts`) kiểm tra nhanh danh sách đen toàn cầu của Google trước khi mở Playwright.

### 2.3. Tối ưu Tốc độ, Dự phòng & Triển khai Cloud Run
* [ ] 🔴 **[P0]** Cài đặt **In-Memory LRU Cache** lưu kết quả phân tích theo URL để các lần quét lặp lại khi demo trên sân khấu trả về tức thì trong $< 50\text{ ms}$.
* [ ] 🔴 **[P0]** Viết bộ đánh giá dự phòng `localHeuristicFallback(url)` trong Extension phòng trường hợp mạng Wi-Fi tại hội trường bị nghẽn.
* [ ] 🟡 **[P1]** Viết `Dockerfile` chuẩn (dùng base image `mcr.microsoft.com/playwright`) và triển khai dịch vụ lên **Google Cloud Run**.

### 2.4. Phân tích Âm thanh Deepfake & Kịch bản Lừa đảo — ZeroLeak Voice (Dev 2 & Dev 3)
* [x] 🔴 **[P0]** Tạo endpoint `POST /api/v1/analyze-voice` nhận phân đoạn âm thanh 5 giây (`audio/webm` hoặc `audio/wav` Base64).
* [x] 🔴 **[P0]** Viết `voice-analyzer.ts` gọi Gemini (`gemini-3.8-live-extended-thinking` / `gemini-3.8-live` / fallback `gemini-3.5-flash-lite`) trả về JSON chuẩn: `riskScore`, `syntheticVoiceProbability`, `detectedTactics` (`CEO_FRAUD`, `AUTHORITY_IMPERSONATION`, `OTP_OR_CREDENTIAL_ASK`, `URGENCY_PRESSURE`) và `warningMessageVi`.
* [x] 🔴 **[P0]** Thêm tab/nút **"Bảo vệ Cuộc gọi (ZeroLeak Voice)"** trên Extension Popup sử dụng `MediaRecorder` / `Web Audio API` (vẽ sóng âm FFT) và gửi chunk âm thanh lên API kiểm tra.

**Ghi chú triển khai:** bản hiện tại dùng WAV PCM16 16 kHz độc lập từng đoạn, Web Audio/AudioWorklet và một trang Voice riêng để phiên thu không phụ thuộc popup. Gọi model Flash hỗ trợ audio qua `generateContent`; model Live/WebSocket là luồng khác, chưa tích hợp. Đã có kiểm thử API và E2E. Screening 22 ca audio công khai/TTS ngày 2026-11-10 chưa chứng minh kênh phát hiện giọng giả; Test 6 chưa nghiệm thu. `syntheticVoiceProbability` chỉ là ước lượng mô hình chưa hiệu chuẩn, có thể `null`. Xem [hướng dẫn Voice](../../docs/VOICE.md) và [kết quả đánh giá](../../docs/VOICE_EVALUATION.md). **Cập nhật V2:** đã có detector âm học local, head train/calibration riêng và kiểm thử 128 ca holdout; tích hợp API/extension, giữ Gemini cho nội dung. Xem [Voice detector V2](../../docs/VOICE_DETECTOR_V2.md). Test 6 về cuộc gọi giả giọng thực tế vẫn chưa nghiệm thu. **Cập nhật V3:** thêm clone tham chiếu Nano/Turbo và channel augmentation; ứng viên đầu bị loại, ứng viên sau qua tiêu chí trước test mới. Giữ kết quả theo nhóm và giới hạn khi nhiễu trong [Voice detector V3](../../docs/VOICE_DETECTOR_V3.md). **Cập nhật 2026-11-11:** thêm bằng chứng theo tactic, phân biệt lỗi provider, waveform theo cảnh báo và file review opt-in. Bộ 24 ca nội dung có 10 TP, 6 TN, 2 FP, 6 lỗi/timeout, chưa đạt gate; review không đại diện mục tiêu <3 giây. Xem [Voice testing](../../docs/VOICE_TESTING.md). Test 6 tiếp tục chưa nghiệm thu. **Bản sửa độ ổn định tiếp theo:** coordinator giữ kết quả từng nhánh khi hết deadline, worker warmup/idle refresh và BUSY retry có giới hạn, thống nhất router model và guard lời giục việc. 66 test phần mềm qua; bộ 12 câu mới có 3 TP, 5 TN, 0 FP, 4 chưa đánh giá được, chưa đạt gate. Xem [Voice reliability](../../docs/VOICE_RELIABILITY.md). Test 6 vẫn để mở. **Followup:** thêm backoff từng model, readiness worker khi engine lỗi và đánh giá paced 5 giây. 12/12 ca paced hoàn tất; tải dồn dập vẫn lỗi. Sáu ứng viên head và thay luồng suy luận bị loại, giữ V3. Xem [Voice followup](../../docs/VOICE_FOLLOWUP.md).

---

## 📊 Epic 3: ZeroLeak Command — Realtime Admin Dashboard & Trang Demo Phishing (`apps/dashboard`)

*Phụ trách chính: Dev 3 / Dev 4 (Fullstack/UI)*

### 3.1. Trang Quản trị Chính sách & Telemetry Thời gian thực
* [ ] 🔴 **[P0]** Khởi tạo ứng dụng **Next.js (App Router)** + **Shadcn UI** + **Lucide Icons** + **Recharts**.
* [ ] 🔴 **[P0]** Xây dựng bảng điều khiển **Security Policy Engine**:
  * [ ] Nút gạt chuyển đổi trực tiếp giữa 3 chế độ: `AUTO_TOKENIZE` (Tự động ẩn danh), `STRICT_BLOCK` (Chặn cứng), `AUDIT_ONLY` (Chỉ ghi nhận).
  * [ ] Các ô checkbox bật/tắt từng loại dữ liệu nhạy cảm (`VN_CCCD`, `CREDIT_CARD`, `API_SECRET`, `PHONE_VN`, `PERSON_NAME`).
  * [ ] Kết nối Firestore/Supabase đẩy thay đổi xuống Browser Extension trong $< 500\text{ ms}$.
* [ ] 🔴 **[P0]** Xây dựng bảng **Zero-Knowledge Live Audit Log**:
  * [ ] Tự động nhảy dòng mới theo thời gian thực kèm hiệu ứng sáng đèn khi Extension chặn một vụ dán dữ liệu nhạy cảm.
  * [ ] Hiển thị rõ ràng: Thời gian, Trang đích (`chatgpt.com`), Loại dữ liệu phát hiện, Hành động xử lý và Độ trễ ($12\text{ ms}$) — tuyệt đối không lưu dữ liệu thô của người dùng.
* [ ] 🟢 **[P2]** Vẽ 2 biểu đồ trực quan bằng **Recharts**: Thống kê tỷ lệ các loại dữ liệu nhạy cảm bị rò rỉ và Số lượng trang Phishing / cuộc gọi Deepfake bị chặn theo giờ.

### 3.2. Trang Giả lập Lừa đảo để Phục vụ Live Demo (`/demo-phishing`)
* [ ] 🔴 **[P0]** Thiết kế 1 trang giả lập giao diện đăng nhập ngân hàng/ví điện tử (có gắn nhãn *"Trang Mô Phỏng Phục Vụ Cuộc Thi An Ninh Mạng DevFest"* ở footer) chứa ô nhập mật khẩu và mã OTP.
* [ ] 🔴 **[P0]** Tạo 1 trang **Email Giả lập** có đính kèm **Mã QR** dẫn tới đường link `/demo-phishing` và 1 file âm thanh giả giọng sếp/công an để đội thi bắt sống ngay trên sân khấu.

---

## 🏆 Epic 4: Kiểm thử Nghiệm thu, Đóng gói & Pitching

*Phụ trách chính: Cả đội*

### 4.1. Checklist Nghiệm thu Kỹ thuật (Definition of Done)
* [ ] 🔴 **[Test 1 - Edge DLP Speed]** Dán đoạn hợp đồng mẫu chứa CCCD, thẻ Visa hợp lệ Luhn và khóa `AIza...` vào ChatGPT $\rightarrow$ Mã hóa thành công với độ trễ hiển thị $< 30\text{ ms}$.
* [ ] 🔴 **[Test 2 - Reversible Vault]** ChatGPT phản hồi văn bản có chứa `[ZL_CCCD_01]` và `[ZL_PER_01]` $\rightarrow$ Giao diện tự động khôi phục lại tên và số CCCD thật màu xanh lá.
* [ ] 🔴 **[Test 3 - QR & Visual Phishing]** Khoanh vùng mã QR trong email mẫu $\rightarrow$ Hiển thị ảnh chụp từ Playwright Sandbox + Cảnh báo đỏ của Gemini 3.8 Flash (`Risk Score >= 90`) trong $< 2.5\text{ s}$.
* [ ] 🔴 **[Test 4 - Realtime Policy Sync]** Bật chế độ `STRICT_BLOCK` trên Dashboard $\rightarrow$ Quay sang tab ChatGPT dán thử API Key bị khóa cứng ngay lập tức mà không cần tải lại trang.
* [ ] 🔴 **[Test 5 - Fault Tolerance]** Ngắt thử kết nối tới `sandbox-api` $\rightarrow$ Extension tự động chuyển sang chế độ Fallback cục bộ, không văng lỗi đỏ trên Console.
* [ ] 🔴 **[Test 6 - Audio Deepfake & Scam]** Phát đoạn âm thanh giả giọng sếp/công an yêu cầu chuyển tiền hoặc đọc mã OTP $\rightarrow$ Sóng âm chuyển đỏ và hiển thị cảnh báo kịch bản thao túng tâm lý trong $< 3\text{ s}$.

### 4.2. Chuẩn bị Sân khấu & Slide Thuyết trình
* [ ] 🔴 **[P0]** Soạn file `DEMO_DATA.md` lưu sẵn 3 đoạn văn bản hợp đồng/mã nguồn mẫu để chỉ cần Copy & Paste nhanh khi đứng trên sân khấu.
* [ ] 🔴 **[P0]** Quay 1 video **Backup Demo 1080p** (không cắt ghép, quay trọn vẹn màn hình 2 phút) phòng trường hợp sự cố máy chiếu hoặc mất mạng toàn hội trường.
* [ ] 🔴 **[P0]** Hoàn thiện Slide Pitching (tối đa 7–8 trang):
  * [ ] Trang 1: Bài toán thực tế & Thiệt hại rò rỉ dữ liệu 2 chiều (Outbound AI Leak & Inbound QR/Deepfake Scam).
  * [ ] Trang 2: Kiến trúc **Hybrid Edge-Cloud Security** (Sơ đồ 4 phân hệ: Vault, Lens, Voice, Command).
  * [ ] Trang 3: Chiều sâu kỹ thuật 1 — **ZeroLeak Vault: On-Device DLP (Gemini Nano & WebGPU) + Reversible Tokenization**.
  * [ ] Trang 4: Chiều sâu kỹ thuật 2 — **ZeroLeak Lens & Voice: Playwright Sandbox + Gemini 3.8 Flash / 3.8 Live Extended Thinking**.
  * [ ] Trang 5: **Live Demo trực tiếp trên sân khấu**.
  * [ ] Trang 6: Kết quả Benchmark thực tế (Độ trễ $< 15\text{ ms}$, Độ chính xác, Zero-Knowledge Privacy).
* [ ] 🔴 **[P0]** Chạy thử (Dry-run) kịch bản thuyết trình 3 phút ít nhất 3 lần giữa các thành viên để khớp thao tác bấm máy và lời nói.
