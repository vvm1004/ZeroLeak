# 🛡️ PLAN.md — ZeroLeak

**Cuộc thi:** GDG DevFest Miền Trung 2026  
**Chủ đề:** An ninh mạng (Cybersecurity)  
**Tagline:** *"Zero Data Exposed. Zero Credentials Stolen."*  
**Định hướng chấm điểm:** Chiều sâu kỹ thuật (Technical Depth) & Mức độ hoàn thiện (Completeness)

---

## 1. Tổng quan Dự án (Executive Summary)

**ZeroLeak** là nền tảng bảo mật trình duyệt lai (**Hybrid Edge-Cloud Security**) bảo vệ người dùng cá nhân và doanh nghiệp trước bài toán **"rò rỉ dữ liệu 2 chiều"** trong kỷ nguyên AI thông qua 4 phân hệ tích hợp:

1. **ZeroLeak Vault (On-Device DLP & Reversible Tokenization):** Chặn rò rỉ dữ liệu nhạy cảm chiều đi ra (CCCD, thẻ ngân hàng, API Key, mã nguồn, tên khách hàng) ngay trên RAM trình duyệt bằng cơ chế mã hóa hai chiều cục bộ (`[ZL_PER_01]`, `[ZL_CCCD_01]`, `[ZL_KEY_01]`) kết hợp **Gemini Nano (Chrome Built-in AI) & WebGPU** trước khi dữ liệu được gửi lên ChatGPT, Claude, Gemini hoặc biểu mẫu web.
2. **ZeroLeak Lens (Isolated Cloud Sandbox & Visual Phishing):** Chặn rò rỉ thông tin định danh chiều đi vào qua đường dẫn (URL) và mã QR độc hại bằng cách lọc nhanh qua **Google Safe Browsing API v4**, mở trang đích trong trình duyệt ảo cô lập (**Playwright trên Google Cloud Run**) và dùng **Gemini 3.8 Flash** đối chiếu giao diện giả mạo thương hiệu (Visual Brand Impersonation).
3. **ZeroLeak Voice (Real-time Audio Deepfake & Scam Detector):** Bảo vệ người dùng trong các cuộc gọi trực tuyến (Google Meet, Zoom Web, Zalo Web, Messenger) bằng cách phân tích phổ âm thanh cục bộ (**Web Audio API FFT**) kết hợp **Gemini 3.8 Live Extended Thinking** để phát hiện giọng nói nhân tạo (AI Voice Cloning) và bóc tách kịch bản thao túng tâm lý (CEO Fraud, giả danh công an/ngân hàng đòi mã OTP).
4. **ZeroLeak Command (Realtime Policy & Zero-Knowledge Telemetry):** Trung tâm điều khiển cho phép doanh nghiệp đồng bộ chính sách bảo mật xuống toàn bộ trình duyệt nhân viên trong $< 500\text{ ms}$ và giám sát rủi ro mà không lưu trữ bất kỳ dữ liệu thô nào.

### Các chỉ số kỹ thuật mục tiêu (System Benchmarks để trình chiếu)

* **Độ trễ quét DLP cục bộ (Edge Latency):** $< 30\text{ ms}$ (chạy $100\%$ trên trình duyệt, dữ liệu thô không bao giờ rời khỏi máy người dùng).
* **Độ chính xác nhận diện PII/Secrets có cấu trúc:** $99.5\%$ (kết hợp Regex + Luhn Checksum + Shannon Entropy).
* **Thời gian phân tích Sandbox & Visual Phishing:** $< 2.5\text{ s}$ cho mỗi URL/QR mới (bắt được các trang Zero-day Phishing chưa có trong danh sách đen).
* **Thời gian phát hiện Audio Deepfake & Scam Script:** $< 3.0\text{ s}$ trên mỗi phân đoạn âm thanh (sliding audio chunk).

---

## 2. Kiến trúc Hệ thống & Tech Stack

### 2.1. 4 Luồng Dữ liệu Cốt lõi

1. **Luồng ZeroLeak Vault (Chạy $100\%$ tại Client):**
   $$\text{User Paste/Drop} \rightarrow \text{Content Script Interceptor} \rightarrow \text{Web Worker (Regex/Luhn + Gemini Nano)} \rightarrow \text{Reversible Tokenizer } (\text{Lưu SessionStorage}) \rightarrow \text{Web/AI nhận mã } \text{[ZL\_...]} \rightarrow \text{MutationObserver khôi phục dữ liệu thật trên màn hình}$$

2. **Luồng ZeroLeak Lens (Cô lập Link & QR trên Đám mây):**
   $$\text{Click Link / Quét QR} \rightarrow \text{Google Safe Browsing API v4} \rightarrow \text{Cloud Run (Playwright Headless)} \rightarrow \text{Screenshot + DOM/SSL} \rightarrow \text{Gemini 3.8 Flash (Fallback 3.5 Flash Lite)} \rightarrow \text{Trả về Risk Score \& Chặn truy cập}$$

3. **Luồng ZeroLeak Voice (Phát hiện Deepfake & Thao túng Tâm lý):**
   $$\text{Tab Audio / Mic Capture} \rightarrow \text{Web Audio API (FFT Spectral Analysis)} \rightarrow \text{Gemini 3.8 Live Extended Thinking / Flash Audio} \rightarrow \text{Cảnh báo Đỏ Deepfake \& Kịch bản Lừa đảo}$$

4. **Luồng ZeroLeak Command (Đồng bộ Chính sách Thời gian thực):**
   $$\text{Admin bật/tắt Policy trên Dashboard} \rightarrow \text{Firebase Firestore Realtime} \rightarrow \text{Đẩy WebSocket xuống toàn bộ Browser Extension trong } < 500\text{ ms}$$

### 2.2. Danh mục Công nghệ (Tech Stack)

| Phân hệ | Công nghệ lựa chọn | Lý do chọn & Chiến lược tối ưu cho Hackathon |
| :--- | :--- | :--- |
| **Browser Extension** | **WXT Framework**, React 19, TypeScript, TailwindCSS (Chrome Manifest V3) | Hỗ trợ Hot-Reload nhanh, cô lập giao diện cảnh báo bằng Shadow DOM (`createShadowRootUi`) không làm vỡ CSS trang đích. |
| **On-Device DLP Engine** | **RegExp + Luhn + Entropy**, **Gemini Nano (Chrome Built-in AI / Prompt API) & WebGPU**, **jsQR** | Xử lý nhận diện thực thể nhạy cảm trực tiếp trên thiết bị với chi phí máy chủ bằng $0$, không rò rỉ dữ liệu thô. |
| **Cloud Sandbox API** | **Node.js (Hono)** + **Playwright Headless Chromium** đóng gói **Docker** trên **Google Cloud Run** | Cô lập hoàn toàn mã độc, chống tấn công SSRF, chụp ảnh giao diện trang web thực tế và bóc tách thẻ `<input type="password">`. |
| **AI Vision & Threat Intel** | **Gemini 3.8 Flash** (Fallback **Gemini 3.5 Flash Lite**) + **Google Safe Browsing API v4** | Kết hợp lọc danh sách đen toàn cầu miễn phí ($100\text{ ms}$) và thị giác máy tính bắt trang giả mạo ngân hàng/Cổng dịch vụ công. |
| **AI Voice & Scam Engine** | **Gemini 3.8 Live Extended Thinking** + **Web Audio API (`AnalyserNode` / `MediaRecorder`)** | Suy luận chiều sâu để bắt đồng thời dấu hiệu giọng nói nhân tạo (TTS/Cloning) và kịch bản thao túng tâm lý tiếng Việt. |
| **Admin Dashboard & DB** | **Next.js (App Router)**, **Shadcn UI**, **Recharts**, **Firebase Firestore** | Giao diện quản trị hiện đại, hỗ trợ lắng nghe thay đổi chính sách và nhật ký rủi ro theo thời gian thực (`onSnapshot`). |

---

## 3. Cấu trúc Thư mục Dự án (Monorepo Structure)

Sử dụng `pnpm workspaces` để chia sẻ kiểu dữ liệu TypeScript thống nhất giữa cả 3 ứng dụng:

```text
zeroleak/
├── apps/
│   ├── extension/                 # WXT Browser Extension (Manifest V3)
│   │   ├── entrypoints/
│   │   │   ├── background.ts      # Service Worker: Đồng bộ Policy, Context Menu & Gọi API
│   │   │   ├── content.ts         # Chặn Paste/Drop, tiêm Shadow DOM UI & Khôi phục [ZL_...]
│   │   │   └── popup/             # Giao diện Vault Status, QR Scanner & ZeroLeak Voice
│   │   ├── workers/
│   │   │   └── dlp.worker.ts      # Chạy Regex, Luhn, Entropy tách biệt luồng UI chính
│   │   └── utils/
│   │       ├── deterministic-dlp.ts # Bộ lọc Tầng 1: CCCD, Thẻ ngân hàng, SĐT, API Key
│   │       ├── reversible-vault.ts  # Lưu/Đọc ánh xạ [ZL_PER_01] <-> "Nguyễn Văn A"
│   │       ├── qr-scanner.ts        # Chụp vùng màn hình và giải mã QR bằng jsQR
│   │       └── audio-capture.ts     # Thu âm thanh cuộc gọi & vẽ sóng âm FFT
│   │
│   ├── sandbox-api/               # Dịch vụ Cloud Sandbox & Multimodal AI (Google Cloud Run)
│   │   ├── src/
│   │   │   ├── index.ts           # Hono Server (/api/v1/analyze-url & /api/v1/analyze-voice)
│   │   │   ├── safebrowsing.ts    # Kiểm tra nhanh URL qua Google Safe Browsing API v4
│   │   │   ├── playwright.ts      # Mở URL trong Headless Chromium, chụp ảnh WebP & lấy DOM
│   │   │   ├── gemini-analyzer.ts # Smart Model Router (3.8 Flash / 3.5 Flash Lite) chấm điểm
│   │   │   └── voice-analyzer.ts  # Phân tích Audio Deepfake & Scam Script
│   │   └── Dockerfile             # Image mcr.microsoft.com/playwright:v1.50.0-noble
│   │
│   ├── dashboard/                 # Next.js ZeroLeak Command & Trang Demo Lừa đảo Giả lập
│   │   ├── src/app/
│   │   │   ├── (admin)/           # Quản lý Policy, Biểu đồ Recharts, Zero-Knowledge Logs
│   │   │   └── demo-phishing/     # Trang giả lập Ngân hàng & Email chứa QR/Audio để Demo
│   │   └── components/            # Shadcn UI Components
│
├── packages/
│   └── shared-types/              # Định nghĩa Interfaces: Policy, DLP, Phishing, VoiceScam
├── AGENTS.md
├── PLAN.md
└── TASK.md
```

---

## 4. Đặc tả Kỹ thuật 4 Phân hệ Cốt lõi (Killer Features)

### 4.1. ZeroLeak Vault — Bộ lọc DLP Đa tầng & Reversible Tokenization

1. **Tầng 1 (Deterministic Filter — Độ trễ $\approx 2\text{ ms}$):**
   * **CCCD Việt Nam:** Regex `/\b0(?:0[1-9]|[1-8]\d|9[0-6])[0-3]\d{2}\d{6}\b/g` (kiểm tra mã tỉnh hợp lệ từ `001` đến `096`).
   * **Thẻ Tín dụng/Ngân hàng:** Regex $13\text{–}19$ chữ số kết hợp thuật toán **Luhn Checksum** ($\sum \text{digits} \pmod{10} = 0$) để loại bỏ hoàn toàn cảnh báo giả.
   * **API Keys & Secrets:** Bắt tiền tố (`AIza...`, `sk-...`, `ghp_...`, `AKIA...`) kết hợp đo độ hỗn loạn **Shannon Entropy**:
     $$H(X) = -\sum_{i=1}^{n} P(x_i) \log_2 P(x_i) > 4.5$$

2. **Tầng 2 (Contextual On-Device AI — Độ trễ $\approx 20\text{ ms}$):**
   * Nhận diện Tên người (`PER`), Tổ chức (`ORG`), Địa chỉ và điều khoản tài chính mật bằng **Gemini Nano (`window.ai`) & WebGPU** kết hợp Contextual Heuristics tiếng Việt.

3. **Cơ chế Khôi phục Hai chiều (Reversible Session Vault):**
   * Lưu vào bộ nhớ phiên cục bộ: `{"[ZL_PER_01]": "Nguyễn Văn An", "[ZL_CCCD_01]": "048099001234"}`.
   * Dùng `MutationObserver` theo dõi khung trả lời của ChatGPT/Claude/Gemini: Ngay khi luồng văn bản trả về xuất hiện chuỗi `[ZL_PER_01]`, lập tức thay thế bằng thẻ `<span class="zeroleak-restored" title="Đã khôi phục cục bộ bởi ZeroLeak">Nguyễn Văn An</span>` nổi bật màu xanh lá.

### 4.2. ZeroLeak Lens — Lọc Kép Safe Browsing v4 & Cloud Visual Sandbox

Khi người dùng bấm chuột phải chọn **"Kiểm tra liên kết an toàn với ZeroLeak Lens"** hoặc quét mã QR trên màn hình:

1. **Lớp 1 (`Google Safe Browsing API v4` — $\approx 100\text{ ms}$):** Kiểm tra URL trong cơ sở dữ liệu `MALWARE` và `SOCIAL_ENGINEERING` của Google.
2. **Lớp 2 (`Playwright Cloud Sandbox` — $\le 2000\text{ ms}$):** Mở URL trong container cô lập, chặn dải IP nội bộ (chống SSRF), thu thập ảnh chụp màn hình định dạng WebP Base64, tiêu đề trang, chuỗi chuyển hướng và các thẻ `<input type="password">`, ô nhập OTP.
3. **Lớp 3 (`Gemini 3.8 Flash Structured Output`):** Đối chiếu nhận diện thị giác trong ảnh chụp màn hình với tên miền thực tế và trả về JSON nghiêm ngặt:
   ```json
   {
     "riskScore": 96,
     "verdict": "MALICIOUS",
     "impersonatedBrand": "Vietcombank DigiBank",
     "actualDomain": "vcb-digibank-confirm.top",
     "indicators": [
       "Giao diện sử dụng logo và nhận diện thương hiệu của Vietcombank",
       "Tên miền .top không thuộc quyền sở hữu chính thức của ngân hàng",
       "Trang yêu cầu nhập đồng thời Mật khẩu và Mã OTP trên cùng một biểu mẫu"
     ]
   }
   ```

### 4.3. ZeroLeak Voice — Phát hiện Audio Deepfake & Kịch bản Thao túng Tâm lý

1. **Thu âm & Phân tích Phổ âm Cục bộ:** Sử dụng `MediaRecorder` và `AnalyserNode` (Web Audio API) vẽ biểu đồ sóng âm FFT trực tiếp trên Extension Popup, kiểm tra hiện tượng cắt tần số cao và nhịp nghỉ máy móc.
2. **Phân tích Đa phương thức (`Gemini 3.8 Live Extended Thinking` / `3.8 Flash`):** Gửi phân đoạn âm thanh $5\text{ s}$ (`audio/webm` Base64) để phát hiện 4 chiến thuật lừa đảo phổ biến tại Việt Nam:
   * `CEO_FRAUD`: Giả giọng sếp yêu cầu kế toán/nhân viên chuyển khoản gấp.
   * `AUTHORITY_IMPERSONATION`: Giả danh Công an, Viện kiểm sát, Nhân viên ngân hàng.
   * `OTP_OR_CREDENTIAL_ASK`: Dụ đọc mã OTP, mật khẩu hoặc quét mã QR độc hại.
   * `URGENCY_PRESSURE`: Thao túng tâm lý, đe dọa khóa tài khoản hoặc yêu cầu giữ bí mật.

### 4.4. ZeroLeak Command — Đồng bộ Chính sách & Nhật ký Zero-Knowledge

* Khi Extension chặn một vụ lộ dữ liệu, nó chỉ gửi siêu dữ liệu ẩn danh (Metadata) lên Firestore:
  ```json
  {
    "timestamp": "2026-11-10T09:30:00Z",
    "targetDomain": "chatgpt.com",
    "actionTaken": "AUTO_TOKENIZE",
    "detectedTypes": ["VN_CCCD", "CREDIT_CARD", "API_SECRET"],
    "matchCount": 3,
    "scanLatencyMs": 11
  }
  ```
* Admin chuyển đổi tức thì giữa `AUTO_TOKENIZE` (tự động ẩn danh) và `STRICT_BLOCK` (khóa cứng nút gửi) trên Dashboard.

---

## 5. Phân công Nhân sự (Đội hình 3–4 Thành viên)

| Vai trò | Chuyên môn phụ trách | Nhiệm vụ cốt lõi (Deliverables) |
| :--- | :--- | :--- |
| **Role 1: Extension & Vault Lead** | Frontend / TypeScript | Phụ trách `apps/extension`: Chặn sự kiện `paste`/`drop`, Reversible Tokenizer `[ZL_...]`, `MutationObserver`, Shadow DOM Toast, tích hợp `jsQR` và thu âm `MediaRecorder`. |
| **Role 2: Cloud Sandbox & AI Lead** | Backend / Cloud AI | Phụ trách `apps/sandbox-api`: Viết API Playwright chụp ảnh/bóc tách DOM, tích hợp `Google Safe Browsing API v4`, `Smart Model Router` (`Gemini 3.8 Flash` / `3.5 Flash Lite`) cho cả Vision và Voice. |
| **Role 3: DLP & Voice Engine Lead** | Security Engine / Audio AI | Phụ trách bộ lọc `deterministic-dlp.ts` (Regex, Luhn, Entropy), tích hợp `Gemini Nano (window.ai)` trong Web Worker và xử lý biểu đồ sóng âm FFT cho ZeroLeak Voice. |
| **Role 4: Dashboard & Demo Lead** | Fullstack / Dashboard UI | Phụ trách `apps/dashboard`: Xây dựng giao diện `ZeroLeak Command` với Shadcn UI + Recharts, đồng bộ Firebase Firestore `onSnapshot`, dựng trang `/demo-phishing` kèm mã QR và file âm thanh mẫu. |

---

## 6. Lộ trình Triển khai: 30% Vòng Loại & 70% Speedrun tại Hackathon

### Giai đoạn A: Gói 30% Hoàn thiện cho Vòng Loại (Pre-Hackathon — Đã hoàn thành)
* **[x] Khởi tạo Monorepo & Shared Types (`5%`):** Cấu hình `pnpm workspaces`, định nghĩa các Interfaces cốt lõi và tạo project Firebase Firestore.
* **[x] Hoàn thiện ZeroLeak Vault (`20%`):** Chặn sự kiện `paste` trên ChatGPT/Claude/Gemini, chạy bộ lọc Regex + Luhn + Entropy, mã hóa thành `[ZL_CCCD_01]`, `[ZL_PER_01]` và tự động khôi phục 2 chiều bằng `MutationObserver` kèm thông báo Shadow DOM Toast.
* **[x] Khung Giao diện Tĩnh (`5%`):** Dựng khung giao diện Popup Extension và layout cơ bản của Dashboard.

### Giai đoạn B: Gói 70% Code Trực tiếp tại Hackathon (Tối ưu cho 1 Buổi sáng 3.5–4 Giờ)
* **Khung giờ 1 (60 phút đầu — Dựng Core Backend & Realtime Sync):**
  * *Backend / Cloud AI:* Hoàn thiện endpoint `/api/v1/analyze-url` kết nối **Google Safe Browsing API v4** + **Playwright Headless** chụp ảnh màn hình WebP.
  * *Dashboard & Realtime:* Nối `onSnapshot` của Firebase Firestore giữa trang `ZeroLeak Command Dashboard` và `Extension Background` để đồng bộ nút gạt Policy trong $< 500\text{ ms}$.
* **Khung giờ 2 (60 phút tiếp theo — Ghép nối Gemini 3.8 Vision & Voice):**
  * *Backend / Cloud AI:* Nối ảnh chụp Playwright vào `gemini-analyzer.ts` và hoàn thiện endpoint `/api/v1/analyze-voice` (`voice-analyzer.ts`). Sử dụng `gemini-3.5-flash-lite` ($500\text{ RPD}$) trong lúc test liên tục.
  * *Extension:* Hoàn thiện luồng quét mã QR trên màn hình (`jsQR`) và nút bấm thu âm $5\text{ s}$ trên Popup gửi lên `sandbox-api`.
* **Khung giờ 3 (60 phút tiếp theo — Trang Demo Giả lập & Đánh bóng UI):**
  * *Cả đội:* Dựng trang `/demo-phishing` giả mạo giao diện ngân hàng + Email chứa mã QR & đoạn ghi âm cuộc gọi giả giọng sếp (CEO Fraud).
  * Kiểm tra 6 bài test nghiệm thu trong `TASK.md` và cài đặt `LRU Cache` + `localHeuristicFallback(url)`.
* **30 phút cuối (Code Freeze & Tập dượt Sân khấu):**
  * Đổi biến môi trường `GEMINI_MODEL_VISION="gemini-3.8-flash"` để sẵn sàng trình diễn, quay video backup 1080p và chạy thử kịch bản Pitching 3 lần.

---

## 7. Quản trị Rủi ro Kỹ thuật & Cơ chế Dự phòng (Resilience & Smart Routing)

1. **Rủi ro 1: Đụng trần giới hạn lượt gọi (Rate Limit $5\text{ RPM} / 20\text{ RPD}$) của `Gemini 3.8 Flash` trong lúc lập trình.**
   * *Giải pháp:* Cài đặt hàm `generateWithFallback()` trong `gemini-analyzer.ts`. Toàn bộ quá trình dev/test tự động dùng `gemini-3.5-flash-lite` ($15\text{ RPM} / 500\text{ RPD}$). Khi lên sân khấu, bật `gemini-3.8-flash` làm model chính và tự động chuyển mượt sang `gemini-3.5-flash-lite` trong $100\text{ ms}$ nếu gặp mã lỗi `429`.
2. **Rủi ro 2: Mạng Wi-Fi tại hội trường chập chờn khiến Playwright tải trang chậm.**
   * *Giải pháp:* Chạy trang `/demo-phishing` ngay trên mạng nội bộ/local kết hợp **In-Memory LRU Cache** và `AbortController` timeout cứng ở mức $3000\text{ ms}$. Nếu đứt mạng hoàn toàn, Extension tự kích hoạt `localHeuristicFallback(url)` để buổi Demo không bao giờ bị treo.
3. **Rủi ro 3: Xung đột sự kiện trên trình soạn thảo Rich-Text (ProseMirror của ChatGPT/Claude).**
   * *Giải pháp:* Bắt sự kiện ở pha `Capture` (`addEventListener('paste', handler, true)`) và chèn văn bản bằng `document.execCommand('insertText')` để đồng bộ hoàn toàn với Virtual DOM của trang đích.

---

## 8. Kịch bản Live Demo 3 Phút Chinh phục Ban Giám khảo

### Chuẩn bị trước khi bước lên sân khấu:
* Mở sẵn 3 tab trên trình duyệt:
  1. **Tab 1:** **ChatGPT / Gemini** (để demo **ZeroLeak Vault**).
  2. **Tab 2:** **Trang Email & Cuộc gọi Giả lập** có đính kèm **Mã QR xác thực ngân hàng** và **File âm thanh giả giọng lãnh đạo** (để demo **ZeroLeak Lens** & **ZeroLeak Voice**).
  3. **Tab 3:** **ZeroLeak Command Dashboard** (hiển thị biểu đồ thời gian thực và nút gạt Policy).

### Diễn biến 3 Phút Demo trên Sân khấu:
* **Phút 1 — Chiều dữ liệu đi ra: Demo ZeroLeak Vault (Reversible Tokenization):**
  * *Lời dẫn:* *"Mỗi ngày nhân viên doanh nghiệp dán hàng ngàn hợp đồng và mã nguồn lên AI. Làm sao tận dụng sức mạnh của AI mà không lộ một byte dữ liệu thật nào ra khỏi máy tính?"*
  * *Thao tác:* Copy đoạn hợp đồng chứa **Họ tên, số CCCD, thẻ Visa hợp lệ Luhn và khóa API** dán thẳng vào ChatGPT.
  * *Hiệu ứng:* Hộp cảnh báo **ZeroLeak Vault** bật lên báo thời gian quét `11ms`, tự động biến toàn bộ thông tin nhạy cảm thành `[ZL_PER_01]`, `[ZL_CCCD_01]`, `[ZL_CARD_01]`, `[ZL_KEY_01]`. Khi ChatGPT trả lời bản tóm tắt hợp đồng, ngay trên màn hình người dùng các mã `[ZL_...]` tự động khôi phục ngược lại thành tên và số CCCD thật màu xanh lá!
* **Phút 2 — Chiều mối đe dọa đi vào: Demo ZeroLeak Lens (QR Sandbox) & ZeroLeak Voice (Deepfake Scam):**
  * *Thao tác 1 (Lens):* Chuyển sang Tab 2, dùng công cụ quét của Extension khoanh vùng **Mã QR** trong email. Sau $2\text{ s}$, màn hình hiện ảnh chụp trang web từ **Playwright Sandbox** kèm cảnh báo đỏ của **Gemini 3.8 Flash**: *"Phát hiện giả mạo thương hiệu Vietcombank (Risk Score: 96/100) — Tên miền thực tế không khớp với giao diện thị giác"*.
  * *Thao tác 2 (Voice):* Bấm phát đoạn ghi âm cuộc gọi *"Anh đang họp kín, em chuyển gấp 50 triệu vào mã QR anh vừa gửi nhé, đừng gọi lại"*. Sóng âm trên **ZeroLeak Voice** lập tức chuyển sang màu đỏ kèm cảnh báo: *"Phát hiện dấu hiệu giọng nói tổng hợp AI + Kịch bản mạo danh lãnh đạo (CEO Fraud)"*.
* **Phút 3 — Quản trị Doanh nghiệp: Demo ZeroLeak Command (Realtime Policy Sync):**
  * Mở Tab 3 (`ZeroLeak Command Dashboard`), chỉ vào bảng nhật ký Zero-Knowledge vừa nhảy số liệu theo thời gian thực. Bấm nút gạt chuyển chính sách từ `AUTO_TOKENIZE` sang `STRICT_BLOCK` $\rightarrow$ Quay lại Tab 1 dán thử API Key, hệ thống khóa cứng ngay lập tức không cần tải lại trang.