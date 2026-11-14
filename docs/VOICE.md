# ZeroLeak Voice

**Cập nhật tiếp theo 2026-11-11:** [backoff, readiness và kiểm thử theo nhịp live](VOICE_FOLLOWUP.md).

**Bản sửa trước đó 2026-11-11:** [sửa coordinator, warmup và kết quả test thật](VOICE_RELIABILITY.md).
Xem thêm [cách test bằng chứng, lỗi Gemini và review file](VOICE_TESTING.md).
Review là tùy chọn thử nghiệm tối đa 15 giây; thu micro/tab giữ deadline cũ.

Mục 2.4 của TASK.md: thu âm, phân tích âm thanh bằng Gemini, và cảnh báo trong extension.
Đã có [detector âm học V3 chạy local bằng PyTorch](VOICE_DETECTOR_V3.md), kết hợp với Gemini phân tích
nội dung. Xem hướng dẫn V3 để chạy worker, kết quả benchmark và giới hạn; phần Gemini vẫn hoạt động
khi chưa bật worker. [Báo cáo đối chiếu ban đầu](VOICE_IMPROVEMENTS.md) lưu lại các bước trước V2.

## Chạy local

```bash
pnpm install --frozen-lockfile
pnpm dev:sandbox
```

Máy chủ đọc `.env` tại gốc monorepo, cần `GEMINI_API_KEY` thực của bạn. Không đưa key này vào extension.
`GEMINI_MODEL_VOICE` chọn model Flash hỗ trợ âm thanh và structured output; mặc định là
`gemini-3.1-flash-lite` ở cả dev và production. Live có fallback `gemini-3.5-flash-lite`,
được ghi đè bằng `GEMINI_MODEL_VOICE_FALLBACK`; chỉ gọi model khác khi lỗi sớm và còn thời gian.
Model review kế thừa model chính trừ khi cấu hình `GEMINI_MODEL_VOICE_REVIEW`, và chỉ gọi một model.
API và công cụ đánh giá dùng chung router. Tên model/quota phụ thuộc tài khoản API thực tế.
Các model Live sử dụng giao thức streaming khác; không điền ID Live vào endpoint generateContent này.

```bash
pnpm build:extension
```

Chrome → `chrome://extensions` → Developer mode → Load unpacked →
`apps/extension/.output/chrome-mv3`. Mở popup, bấm **Bảo vệ cuộc gọi — ZeroLeak Voice**.

Trong trang Voice:

1. Chọn **Âm thanh từ tab** hoặc **Micro của bạn**.
2. Bấm **Bắt đầu kiểm tra**. Với tab, chọn Thẻ Chrome và bật chia sẻ âm thanh.
3. Giữ trang Voice mở; có thể chuyển sang tab cuộc gọi. Popup đóng không làm dừng phiên này.
4. Mỗi 5 giây, một đoạn PCM WAV độc lập được gửi. Sóng âm và thời lượng phản ánh nguồn đang thu.
5. Bấm **Dừng thu âm** để dừng mọi track và hủy yêu cầu đang chờ. Đóng trang cũng dừng thu.

**Chọn file thử** giải mã file ngay trên thiết bị, chuyển thành WAV mono 16 kHz và chỉ gửi tối đa
5 giây đầu. Không upload toàn bộ file gốc. File tối đa 10 MB; file không giải mã được sẽ báo lỗi.
Micro không tự nghe được mọi âm thanh hệ thống: dùng nguồn tab cho cuộc gọi/video phát trong Chrome.
Tính năng không thu âm nền khi trang Voice đã đóng, và không thu cuộc gọi điện thoại ngoài trình duyệt.

Địa chỉ API mặc định `http://localhost:8080`. Đổi trong **Kết nối dịch vụ** khi dùng máy chủ khác.
HTTPS bắt buộc cho máy chủ từ xa. Khi `NODE_ENV=production`, phải đặt `VOICE_API_TOKEN` trên server
và nhập cùng mã truy cập ở trang Voice. Không công khai một API không có giới hạn chi phí/quota bổ sung;
giới hạn đồng thời hiện tại chỉ áp dụng trên từng tiến trình, không thay thế gateway/rate limit khi triển khai diện rộng.

## API

`POST /api/v1/analyze-voice`, `Content-Type: application/json`:

```json
{ "audioBase64": "<PCM WAV encoded as Base64>", "mimeType": "audio/wav" }
```

Chấp nhận PCM16 mono 16 kHz dài 0,5–5 giây, tối đa 160.044 byte. Server kiểm tra header, khối dữ liệu,
số frame và tín hiệu im lặng. WAV được chọn để mỗi cửa sổ đều đọc độc lập, tránh gửi các fragment WebM
không có header. File WebM/MP3 có thể chọn trong giao diện nếu Chrome giải mã được; server nhận WAV đã chuyển.

Schema Gemini mới chỉ đánh giá nội dung; trường `syntheticVoiceProbability` giữ để tương thích nhưng
được trả null. Xem `acousticAnalysis` để đánh giá giọng tổng hợp từ worker local.

Kết quả có `riskScore`, `verdict`, `syntheticVoiceProbability`, `detectedTactics`, `transcriptSnippet`,
`warningMessageVi`, `audioQuality`, `assessmentSource`, `analysisModel`, `executionTimeMs`.
Khi bật detector local, có thêm `acousticAnalysis`; nguồn đánh giá có thể là `HYBRID_AUDIO` hoặc
`LOCAL_ACOUSTIC`. Cảnh báo giọng tổng hợp và nội dung lừa đảo được hiển thị riêng.
`UNKNOWN` và giá trị `null` biểu diễn chưa đủ bằng chứng; không thay bằng kết luận an toàn.
Lỗi có dạng `{ "error": { "code": "...", "message": "..." } }` và HTTP 400/401/413/415/429/502/503/504.
Nguồn trình duyệt được giới hạn cho extension Chrome và localhost. Thêm origin web được phép vào
`VOICE_ALLOWED_ORIGINS` nếu tích hợp web client; nguồn không được phép nhận HTTP 403 trước khi gọi Gemini.

Với chế độ nhanh, yêu cầu extension có hard timeout 3.500 ms. Bộ phân tích có một ngân sách chung 3.100 ms cho cả
model chính và fallback; không cộng nhiều timeout liên tiếp. Hủy phía client không đảm bảo vendor hủy
phần tính toán đã nhận. Khi lỗi/timeout, hiển thị chưa đánh giá được. Không tạo kết quả an toàn giả lập.
Model chính được dùng hết thời gian còn lại; không cắt sớm ở 2.100 ms để chừa một giây cho fallback.
Fallback chỉ chạy nếu có lỗi sớm và ngân sách chung còn đủ, không gọi thêm sau khi hết deadline.
Review opt-in có ngân sách Gemini 15.000 ms, local 5.000 ms, route 15.300 ms, client 16.000 ms,
chỉ xử lý tối đa 5 giây audio. Không dùng review để công bố đã đạt <3 giây.
SDK đặt deadline của dịch vụ Google tối thiểu 10 giây vì API từ chối giá trị thấp hơn; deadline này
không thay thế bộ hủy/timeout độc lập 3.100 ms của ứng dụng.

## Giới hạn cần trình bày đúng khi demo

- Đây là phân tích bằng Gemini theo blueprint của đội. Ước lượng giọng tổng hợp **chưa hiệu chuẩn**,
  không phải xác suất pháp y hoặc bộ phát hiện deepfake đã được kiểm định.
- `SAFE` nghĩa là chưa thấy dấu hiệu trong đoạn ngắn, không xác minh danh tính hoặc bảo đảm an toàn.
- Nhận diện lời thoại lừa đảo và dấu hiệu giọng nhân tạo là hai kênh bằng chứng riêng. Prompt yêu cầu
  không suy ra giọng giả chỉ vì nội dung có OTP/chuyển tiền. Đầu ra vẫn có thể sai.
- `DEEPFAKE_SCAM` được giữ theo hợp đồng chung; giao diện mô tả là **Nguy cơ giả giọng / lừa đảo**.
- 5 giây thu âm và thời gian phân tích là hai phần khác nhau. Mục tiêu <3 giây cần đo sau khi đủ audio,
  không thể diễn giải là cảnh báo trong 3 giây đầu của một cửa sổ thu dài 5 giây.
- Không lưu bản thu, transcript hoặc kết quả vào Chrome storage/database/telemetry. Chỉ địa chỉ dịch vụ
  được lưu trong storage; mã truy cập chỉ ở bộ nhớ của trang, cần nhập lại khi mở trang mới. Audio vẫn được chia sẻ
  với backend và Google khi người dùng bật chức năng; chính sách xử lý của Google phụ thuộc tài khoản.
- Transcript được yêu cầu che dữ liệu nhạy cảm và lọc thêm một số mẫu phổ biến ở server. Không coi đây
  là bộ redaction hoàn chỉnh cho mọi dạng PII. Xóa kết quả khỏi màn hình khi bắt đầu phiên mới.

## Kiểm thử

Đã có [báo cáo đánh giá trên audio công khai và TTS tiếng Việt](VOICE_EVALUATION.md),
cùng công cụ chuẩn bị dữ liệu và chạy API thật. Screening hiện tại **chưa xác nhận khả năng phát hiện
giọng giả**; không dùng smoke test dưới đây làm số đo accuracy. Parser giữ độc lập điểm giọng tổng hợp
và độ chắc chắn về nội dung; nội dung UNKNOWN không tự xóa điểm âm học khi audio dùng được.

```bash
pnpm --filter @zeroleak/sandbox-api test
pnpm --filter @zeroleak/extension test:voice
pnpm typecheck
pnpm build:extension
pnpm --filter @zeroleak/sandbox-api build
pnpm exec playwright install chromium
pnpm test:voice:e2e
```

E2E dùng server Gemini giả lập chỉ nằm trong test, ghi rõ kết quả fixture; không phải phép đo độ chính xác AI.
Kiểm thử API thật cần key/model khả dụng, âm thanh được phép sử dụng, và đo riêng với giọng thật/giọng tổng hợp
đọc cùng nội dung, các vùng miền, tiếng ồn và âm thanh truyền qua cuộc gọi. Không dùng kết quả fixture để báo accuracy.

### Xác minh ngày 2026-11-10

- 8 test backend, 3 test định dạng/client, 6 kịch bản E2E đều qua; hai luồng thu micro và tab
  được lặp thêm 5 lần mỗi luồng, đóng toàn bộ track khi dừng.
- Test hồi quy DLP, Vault và phishing hiện có đều qua. Typecheck toàn workspace, build extension,
  build/start backend và kiểm tra HTTP `/health` / từ chối input không hợp lệ đều qua.
- Đã kiểm tra bundle extension không chứa Gemini API key từ `.env`.
- Với một mẫu tổng hợp tiếng Việt bình thường, Gemini 3.5 Flash-Lite trả JSON hợp lệ trong 2.585 ms,
  kết quả `UNKNOWN`. Một mẫu tổng hợp có câu yêu cầu OTP được Gemini 2.5 Flash-Lite đánh giá
  `DEEPFAKE_SCAM` trong 3.033 ms. Đây chỉ là smoke test tích hợp, không đủ đo accuracy hoặc kết luận
  mô hình phát hiện được giọng giả độc lập với nội dung.
- Các lần gọi khác đã gặp timeout và `503` quá tải. Vì vậy chưa bảo đảm mục tiêu <3 giây trong mọi
  điều kiện; fallback cũng phải dùng chung ngân sách ngắn và có thể hết thời gian.

### Dependencies có sẵn trong repo

Không thêm dependency mới và không thay đổi lockfile. `pnpm audit --prod` trên lockfile hiện có
báo 2 high và 3 moderate (2026-11-10):

- PostCSS 8.4.31 nằm trong Next.js của dashboard. Các advisory liên quan stringify/source map;
  luồng Voice không dùng compiler này ở runtime. Chưa nâng Next/PostCSS trong nhánh Voice để tránh
  thay đổi dependency của phần dashboard do đồng đội phụ trách.
- `@hono/node-server` 1.19.17 có advisory moderate về `serveStatic`; API Voice chỉ dùng `serve`, không
  có đường gọi `serveStatic`. Bản vá yêu cầu >=2.1.3, vượt major version đang khai báo, nên hoãn nâng
  để kiểm tra tương thích riêng.

Rà soát lại các hoãn nâng cấp trước khi triển khai công khai, chậm nhất 2026-11-17. Không coi bản
hackathon local này là một xác nhận an toàn cho mọi tính năng hoặc môi trường triển khai.
