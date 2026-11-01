# 🛡️ PLAN.md — ZeroLeak & PhishGuard

**Cuộc thi:** GDG DevFest Miền Trung 2026  
**Chủ đề:** An ninh mạng (Cybersecurity)  
**Định hướng chấm điểm:** Chiều sâu kỹ thuật (Technical Depth) & Mức độ hoàn thiện (Completeness)

---

## 1. Tổng quan Dự án (Executive Summary)

**ZeroLeak & PhishGuard** là nền tảng bảo mật lai (Hybrid Edge-Cloud Security) bảo vệ người dùng cá nhân và doanh nghiệp trước 2 rủi ro lớn nhất trong môi trường số hiện nay:

1. **ZeroLeak (On-Device DLP):** Chặn rò rỉ dữ liệu nhạy cảm (CCCD, thẻ ngân hàng, API Key, mã nguồn, tên khách hàng) ngay trên trình duyệt bằng cơ chế **Reversible Tokenization** (mã hóa hai chiều cục bộ) trước khi dữ liệu được gửi lên các công cụ AI (ChatGPT, Claude, Gemini) hoặc biểu mẫu web.
2. **PhishGuard (Isolated Cloud Sandbox):** Phát hiện lừa đảo qua đường dẫn (URL) và mã QR theo thời gian thực bằng cách mở trang đích trong trình duyệt ảo cô lập (**Playwright trên Google Cloud Run**) và dùng **Gemini 3.5 Flash Lite Multimodal** đối chiếu giao diện giả mạo thương hiệu (Visual Brand Impersonation).

### Các chỉ số kỹ thuật mục tiêu (System Benchmarks để trình chiếu)

* **Độ trễ quét DLP cục bộ (Edge Latency):** $< 30\text{ ms}$ (chạy 100% trên trình duyệt, dữ liệu thô không bao giờ rời khỏi máy người dùng).
* **Độ chính xác nhận diện PII/Secrets có cấu trúc:** $99.5\%$ (kết hợp Regex + Luhn Checksum + Shannon Entropy).
* **Thời gian phân tích Sandbox & Visual Phishing:** $< 2.5\text{ s}$ cho mỗi URL/QR mới (bắt được các trang Zero-day Phishing chưa có trong danh sách đen).

---

## 2. Kiến trúc Hệ thống & Tech Stack

### 2.1. Luồng Dữ liệu Cốt lõi

1. **Luồng On-Device DLP (Chạy 100% tại Client):**
   $$\text{User Paste/Submit} \rightarrow \text{Content Script Interceptor} \rightarrow \text{Web Worker (Regex/Luhn + ONNX NER)} \rightarrow \text{Reversible Tokenizer } (\text{Lưu SessionStorage}) \rightarrow \text{Web/AI nhận dữ liệu ẩn danh} \rightarrow \text{DOM Observer khôi phục dữ liệu thật trên màn hình}$$

2. **Luồng Cloud Phishing Sandbox (Cô lập trên Đám mây):**
   $$\text{Click Link / Quét QR} \rightarrow \text{Cloud Run (Playwright Headless)} \rightarrow \text{Chụp Screenshot + Bóc tách DOM/SSL} \rightarrow \text{Gemini 3.5 Flash Lite + Google Web Risk API} \rightarrow \text{Trả về Risk Score \& Chặn truy cập}$$

3. **Luồng Đồng bộ Chính sách (Realtime Policy Engine):**
   $$\text{Admin bật/tắt quy tắc trên Dashboard} \rightarrow \text{Firebase Firestore / Supabase Realtime} \rightarrow \text{Đẩy WebSocket xuống toàn bộ Browser Extension trong } < 500\text{ ms}$$

### 2.2. Danh mục Công nghệ (Tech Stack)

| Phân hệ | Công nghệ lựa chọn | Lý do chọn cho Hackathon |
| :--- | :--- | :--- |
| **Browser Extension** | **WXT Framework** (hoặc **Plasmo**), React 19, TypeScript, TailwindCSS (Manifest V3) | Hỗ trợ Hot-Reload cực nhanh, cấu hình sẵn Content Script UI (Shadow DOM không bị vỡ CSS trên trang đích). |
| **On-Device DLP Engine** | **RegExp + Luhn + Entropy**, **Transformers.js (ONNX Web)** hoặc **Gemini Nano (`window.ai`)**, **jsQR** | Xử lý cực nhanh trong Web Worker, không làm đơ giao diện trình duyệt. |
| **Cloud Sandbox API** | **Node.js (Hono/Fastify)** + **Playwright Chromium** đóng gói **Docker** trên **Google Cloud Run** | Cô lập hoàn toàn mã độc, chụp ảnh trang web thực tế và trích xuất cây DOM chuẩn xác. |
| **AI & Threat Intel** | **Gemini 3.5 Flash Lite API** (Structured Outputs) + **Google Web Risk API** | Gemini 3.5 Flash Lite có tốc độ phản hồi cực nhanh, hỗ trợ nhìn ảnh chụp màn hình để bắt các trang giả mạo ngân hàng/cổng dịch vụ công. |
| **Admin Dashboard & DB** | **Next.js (App Router)**, **Shadcn UI**, **Recharts**, **Firebase Firestore** (hoặc **Supabase**) | Dựng giao diện quản trị đẹp trong 3 giờ, hỗ trợ lắng nghe thay đổi dữ liệu theo thời gian thực (Realtime Listener). |

---

## 3. Cấu trúc Thư mục Dự án (Monorepo Structure)

Sử dụng `pnpm workspaces` hoặc `Turborepo` để dùng chung kiểu dữ liệu TypeScript giữa Extension, Backend và Dashboard:

```text
zeroleak-phishguard/
├── apps/
│   ├── extension/                 # WXT / Plasmo Browser Extension (Manifest V3)
│   │   ├── entrypoints/
│   │   │   ├── background.ts      # Service Worker: Quản lý Policy & Gọi Cloud Sandbox
│   │   │   ├── content.ts         # Chặn sự kiện Paste/Drop, tiêm UI cảnh báo & Khôi phục Token
│   │   │   └── popup/             # Giao diện bật/tắt nhanh và hiển thị Metrics
│   │   ├── workers/
│   │   │   └── dlp.worker.ts      # Chạy Regex, Luhn, Entropy & ONNX NER tách biệt luồng UI
│   │   └── utils/
│   │       ├── tokenizer.ts       # Lưu/Đọc ánh xạ [PER_01] <-> "Nguyễn Văn A"
│   │       └── qr-scanner.ts      # Chụp vùng màn hình và giải mã QR bằng jsQR
│   │
│   ├── sandbox-api/               # Dịch vụ cô lập URL chạy trên Google Cloud Run
│   │   ├── src/
│   │   │   ├── index.ts           # API Server (Hono / Fastify)
│   │   │   ├── playwright.ts      # Mở trang trong Headless Browser, chụp ảnh & lấy DOM
│   │   │   ├── gemini-analyzer.ts # Gửi ảnh + DOM sang Gemini 3.5 Flash Lite chấm điểm rủi ro
│   │   │   └── webrisk.ts         # Tích hợp Google Web Risk API
│   │   └── Dockerfile             # Image mcr.microsoft.com/playwright:v1.50.0-noble
│   │
│   ├── dashboard/                 # Next.js Web Admin & Trang Demo Phishing Giả lập
│   │   ├── src/app/
│   │   │   ├── (admin)/           # Giao diện quản lý Policy, Biểu đồ Telemetry, Audit Logs
│   │   │   └── demo-phishing/     # Trang giả lập đăng nhập Ngân hàng để test trực tiếp trên sân khấu
│   │   └── components/            # Shadcn UI + Biểu đồ Recharts
│
├── packages/
│   └── shared-types/              # Định nghĩa JSON Schema cho Policy, DLP Match, Scan Result
└── PLAN.md
```

---

## 4. Đặc tả Kỹ thuật 3 Tính năng Cốt lõi (Killer Features)

### 4.1. Bộ lọc DLP Đa tầng & Reversible Tokenization

1. **Tầng 1 (Deterministic - Độ trễ $\approx 2\text{ ms}$):**
   * **CCCD Việt Nam:** Regex `/(?:\b0\d{2}[0-3]\d{2}\d{6}\b)/g` (kiểm tra mã tỉnh hợp lệ từ `001` đến `096`).
   * **Thẻ Tín dụng/Ngân hàng:** Regex 13–19 chữ số kết hợp thuật toán kiểm tra **Luhn Checksum** ($\sum \text{digits} \pmod{10} = 0$) để loại bỏ hoàn toàn cảnh báo giả (False Positives).
   * **API Keys & Secrets:** Bắt tiền tố (`AIza...`, `sk-...`, `ghp_...`, `AKIA...`) kết hợp đo độ hỗn loạn **Shannon Entropy**:
     $$H(X) = -\sum_{i=1}^{n} P(x_i) \log_2 P(x_i) > 4.5$$

2. **Tầng 2 (Contextual AI - Độ trễ $\approx 20\text{ ms}$):**
   * Nhận diện Tên người (`PER`), Tổ chức (`ORG`), Địa chỉ (`LOC`), Số tiền hợp đồng (`MONEY`) bằng mô hình NER lượng tử hóa hoặc Gemini Nano.

3. **Cơ chế Khôi phục Hai chiều (Reversible Vault):**
   * Lưu vào bộ nhớ phiên cục bộ: `{"[PER_01]": "Nguyễn Văn A", "[CCCD_01]": "048099001234"}`.
   * Dùng `MutationObserver` theo dõi khung chat của ChatGPT/Gemini: Ngay khi luồng văn bản trả về xuất hiện chuỗi `[PER_01]`, lập tức thay thế bằng thẻ `<span class="zeroleak-restored" title="Khôi phục cục bộ từ [PER_01]">Nguyễn Văn A</span>` nổi bật màu xanh lá.

### 4.2. Cloud Sandbox & Visual Brand Spoofing

Khi người dùng bấm chuột phải chọn **"Kiểm tra an toàn bằng PhishGuard"** hoặc quét mã QR trên màn hình:

1. **Playwright** mở URL trong môi trường cô lập, chặn tải file thực thi, đợi `domcontentloaded` (tối đa $2000\text{ ms}$), thu thập:
   * Ảnh chụp màn hình định dạng WebP nén nhẹ (Base64).
   * Tiêu đề trang, danh sách các thẻ `<form>`, `<input type="password">`, chứng chỉ SSL và chuỗi chuyển hướng (Redirect chain).
2. **Gemini 3.5 Flash Lite Structured Prompt:**
   * Yêu cầu trả về JSON nghiêm ngặt theo Schema:
     ```json
     {
       "riskScore": 95,
       "verdict": "MALICIOUS",
       "impersonatedBrand": "Vietcombank DigiBank",
       "actualDomain": "vcb-digibank-confirm.top",
       "indicators": [
         "Giao diện sử dụng logo và màu sắc nhận diện của Vietcombank",
         "Tên miền .top mới đăng ký không thuộc sở hữu chính thức",
         "Có biểu mẫu yêu cầu nhập Mật khẩu và Mã OTP trên cùng một màn hình"
       ]
     }
     ```

### 4.3. Đồng bộ Chính sách Thời gian thực & Nhật ký Ẩn danh (Zero-Knowledge Telemetry)

* Khi Extension chặn một vụ lộ dữ liệu, nó **không gửi dữ liệu nhạy cảm** lên Server mà chỉ gửi siêu dữ liệu ẩn danh (Metadata):
  ```json
  {
    "timestamp": "2026-10-31T08:30:00Z",
    "targetDomain": "chatgpt.com",
    "action": "TOKENIZED",
    "detectedTypes": ["VN_CCCD", "AWS_SECRET_KEY"],
    "latencyMs": 14
  }
  ```
* Admin có thể bật/tắt chế độ `STRICT_BLOCK` (chặn hoàn toàn không cho gửi) hoặc `AUTO_TOKENIZE` (tự động thay thế bằng mã giả) ngay trên Dashboard.

---

## 5. Phân công Nhân sự (Đội hình 3–4 Thành viên)

| Vai trò | Thành viên phụ trách | Nhiệm vụ cốt lõi (Deliverables) |
| :--- | :--- | :--- |
| **Role 1: Extension & Edge DLP Lead** | Dev 1 (Frontend/TS mạnh) | Khởi tạo WXT Extension, viết DOM Interceptor bắt sự kiện `paste`/`submit` trên ChatGPT/Gmail, cài đặt Reversible Tokenizer và `MutationObserver` khôi phục dữ liệu. |
| **Role 2: AI & Cloud Sandbox Lead** | Dev 2 (Backend/Cloud) | Viết API Playwright chụp ảnh/bóc tách DOM, tích hợp Gemini 3.5 Flash Lite Structured Output & Google Web Risk API, đóng gói Docker đẩy lên Google Cloud Run. |
| **Role 3: Security Engine & QR Lead** | Dev 3 (Thuật toán/AI) | Viết bộ lọc Regex + Luhn + Shannon Entropy + ONNX NER trong Web Worker, tích hợp `jsQR` quét mã QR trực tiếp trên màn hình trình duyệt. |
| **Role 4: Dashboard, Demo & Pitch** | Dev 4 (Fullstack/UI) *(Nếu nhóm 3 người thì gộp vào Dev 1 & 2)* | Dựng Next.js Admin Dashboard với Shadcn UI + Firebase Realtime, tạo **trang web giả mạo ngân hàng (Demo Phishing Page)** để test trực tiếp trên sân khấu, chuẩn bị Slide. |

---

## 6. Lộ trình Triển khai 36 Giờ (Hackathon Timeline)

### Giai đoạn 1: Khởi tạo & Luồng Cốt lõi (Giờ 01 – Giờ 12)
* **Giờ 01–03:** Dựng Monorepo, thống nhất JSON Schema trong `packages/shared-types`. Tạo Firebase/Supabase project.
* **Giờ 04–08:**
  * *Extension:* Chặn thành công sự kiện `paste` trên khung nhập liệu web, chạy bộ lọc Regex + Luhn + Entropy thay thế CCCD/API Key thành `[ID_01]`, `[KEY_01]`.
  * *Backend:* Playwright mở được URL bất kỳ, trả về ảnh chụp màn hình Base64 và danh sách thẻ `<input>`.
* **Giờ 09–12 (Mốc kiểm tra MVP 1):** Tích hợp Gemini 3.5 Flash Lite chấm điểm ảnh chụp màn hình. Hoàn thành tính năng khôi phục hai chiều (`[PER_01]` $\rightarrow$ Tên thật) trên giao diện ChatGPT.

### Giai đoạn 2: Tính năng Nâng cao & Đồng bộ Realtime (Giờ 13 – Giờ 24)
* **Giờ 13–18:**
  * Tích hợp tính năng quét vùng màn hình chứa mã QR (`jsQR`) trong Extension và gửi URL giải mã được lên Cloud Sandbox.
  * Xây dựng trang Next.js Admin Dashboard hiển thị biểu đồ thống kê thời gian thực và nút gạt bật/tắt Policy.
* **Giờ 19–24 (Mốc kiểm tra MVP 2):**
  * Dựng 1 trang web giả mạo ngân hàng/cổng dịch vụ công (chạy trên một tên miền phụ test) có kèm mã QR để phục vụ kịch bản Live Demo.
  * Kết nối WebSocket/Firestore đồng bộ Policy từ Dashboard xuống Extension.

### Giai đoạn 3: Chống Lỗi, Đánh bóng UI & Tập dượt Pitching (Giờ 25 – Giờ 36)
* **Giờ 25–30 (Feature Freeze - Ngừng thêm tính năng mới):**
  * Thêm **Developer Telemetry Panel** ngay góc màn hình Extension hiển thị thông số kỹ thuật trực tiếp: *Edge Scan Latency (ms)*, *Entropy Score*, *Sandbox Execution Time*.
  * Cài đặt cơ chế dự phòng (Fallback) khi mạng hội trường chập chờn.
* **Giờ 31–36:** Quay video backup 1080p, hoàn thiện Slide thuyết trình và chạy thử (Dry-run) kịch bản Live Demo 5 lần để khớp thời gian 3–5 phút.

---

## 7. Quản trị Rủi ro Kỹ thuật & Cơ chế Dự phòng (Resilience & Fallbacks)

Giám khảo đánh giá rất cao các đội có thiết kế hệ thống chống chịu lỗi (Fault-Tolerant):

1. **Rủi ro 1: ChatGPT/Gemini thay đổi cấu trúc DOM làm hỏng bộ chặn `paste`.**
   * *Giải pháp:* Bắt sự kiện ở tầng `window.addEventListener('paste', handler, true)` (Capture Phase) trước khi React/ProseMirror của trang web kịp nhận sự kiện, đồng thời hỗ trợ cả thẻ `<textarea>`, `<input>` và vùng `[contenteditable="true"]`.
2. **Rủi ro 2: Mạng Wi-Fi tại hội trường yếu khiến Playwright hoặc Gemini API phản hồi chậm quá 5 giây.**
   * *Giải pháp:* Thiết lập `AbortController` với timeout cứng ở mức $3000\text{ ms}$ và lưu **LRU Cache** kết quả phân tích URL trên Backend. Nếu mạng đứt hoàn toàn, kích hoạt bộ phân tích tĩnh cục bộ (Local URL Heuristic + Danh sách thương hiệu mẫu) để giao diện cảnh báo vẫn hoạt động mượt mà.
3. **Rủi ro 3: Mô hình ONNX NER tải nặng lần đầu.**
   * *Giải pháp:* Tầng 1 (Regex + Luhn + Entropy) luôn chạy tức thì trong $2\text{ ms}$ mà không cần tải model. Tầng 2 (NER/Gemini Nano) nạp bất đồng bộ trong Background Service Worker ngay khi cài Extension.

---

## 8. Kịch bản Live Demo 3 Phút Chinh phục Ban Giám khảo

### Chuẩn bị trước khi bước lên sân khấu:
* Mở sẵn 3 tab trên trình duyệt:
  1. Tab 1: **ChatGPT / Gemini** (để demo chống lộ dữ liệu nhạy cảm).
  2. Tab 2: **Email giả lập có đính kèm Mã QR nhận thưởng / Xác thực tài khoản ngân hàng**.
  3. Tab 3: **ZeroLeak & PhishGuard Admin Dashboard** (hiển thị biểu đồ thời gian thực).

### Diễn biến 3 Phút Demo:
* **Phút 1 – Vấn đề & Demo ZeroLeak (Reversible Tokenization):**
  * Mở đầu: *"Mỗi ngày nhân viên văn phòng dán hàng ngàn đoạn hợp đồng, mã nguồn và thông tin khách hàng lên AI. Làm sao để tận dụng sức mạnh của AI mà không làm lộ một byte dữ liệu nhạy cảm nào?"*
  * Thao tác: Copy một đoạn hợp đồng thực tế có chứa **Tên thật, số CCCD, số thẻ Visa và AWS Secret Key** dán thẳng vào ChatGPT.
  * Hiệu ứng: Ngay lập tức, khung cảnh báo của **ZeroLeak** bật lên hiển thị thời gian quét `12ms`, tự động biến toàn bộ thông tin nhạy cảm thành `[PER_01]`, `[CCCD_01]`, `[SECRET_01]` rồi gửi đi. Khi ChatGPT trả lời lại bản tóm tắt hợp đồng, trên màn hình người dùng các nhãn `[PER_01]` tự động biến đổi ngược lại thành tên thật màu xanh lá!
* **Phút 2 – Demo PhishGuard (QR & Visual Phishing Sandbox):**
  * Chuyển sang Tab 2 (Email lừa đảo chứa mã QR): Dùng công cụ quét của Extension khoanh vùng mã QR ngay trên màn hình.
  * Hệ thống gửi URL ẩn trong QR lên **Playwright Cloud Sandbox**. Sau 2 giây, màn hình hiện lên ảnh chụp trang web bên trong Sandbox (giao diện giống hệt trang đăng nhập ngân hàng) kèm cảnh báo đỏ từ **Gemini 3.5 Flash Lite**: *"Phát hiện giả mạo thương hiệu Vietcombank (Risk Score: 96/100) – Tên miền thực tế không khớp với nhận diện thị giác"*.
* **Phút 3 – Demo Realtime Policy & Chốt Điểm Kỹ thuật:**
  * Mở Tab 3 (Admin Dashboard), chỉ vào nhật ký vừa nhảy lên theo thời gian thực (chỉ lưu loại vi phạm, không lưu dữ liệu thô). Bấm nút gạt chuyển chính sách sang **Chặn Nghiêm ngặt (Strict Block)** $\rightarrow$ Quay lại Tab 1 dán thử API Key, hệ thống khóa cứng nút gửi ngay lập tức.