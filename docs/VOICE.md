# ZeroLeak Voice

**Bản chạy tăng cường 2026-11-13:** [Voice Pro — một lệnh, Gemini + detector âm học và kết quả6/10 clip clone đối chiếu](VOICE_PRO.md). Đây là chế độ hybrid opt-in; Gemini-only vẫn giữ nguyên.

**Đối chiếu model 2026-11-13:** [80 clip, 71 lượt Google thật và quyết định giữ Extended](VOICE_MODEL_AB.md). Chưa có bằng chứng tăng phát hiện clone; xem riêng dữ liệu thiếu nhãn và các lượt Flash-Lite bị dừng.

**Cập nhật 2026-11-13:** [giảm cảnh báo CEO thiếu bằng chứng và kết quả 20 phiên Google](VOICE_EVIDENCE_GUARD.md). Không bật phương án thêm ASR đoạn trước vì chưa có lợi ích đo được.

**Sửa timeout tab/micro:** [budget realtime 8 giây và kiểm thử trước/sau](VOICE_LIVE_TIMEOUT.md). Giữ cửa sổ audio 5 giây; chưa đạt Test 6 dưới 3 giây.

**Demo mới nhất:** [lệnh kiểm tra trước demo và kịch bản](VOICE_DEMO.md); [đo native Chrome tab, sửa constraints và giới hạn timeout](VOICE_TAB_ACCEPTANCE.md). Test 6 dưới 3 giây vẫn chưa đạt.

**Review toàn bộ file:** [đọc đủ tối đa 15 giây audio, không bỏ lời yêu cầu/giải thích sau giây thứ 5](VOICE_FULL_FILE_REVIEW.md). Đây là cải thiện độ bao phủ ngữ cảnh, không phải bằng chứng tăng nhận diện clone.

**Bảo toàn tín hiệu:** [bỏ khoảng lặng số, hàng đợi giới hạn và thử nghiệm chồng lấp](VOICE_STREAM_IMPROVEMENTS.md). Chồng lấp mặc định tắt; không đổi deadline hoặc tuyên bố detector clone chính xác hơn.

**Chỉ Extended Thinking:** chạy `pnpm dev:voice-extended` trên macOS/Linux để khóa cả realtime/review vào `gemini-3.8-live-extended-thinking`, không chuyển model và không gọi worker local. [Kết quả kiểm tra mới](VOICE_GEMINI_ONLY.md): hai ứng viên bị loại ở development; chưa có bằng chứng tăng độ chính xác.

**Cập nhật chất lượng:** [review sửa định dạng tối đa một lần trong deadline và kết quả kiểm định](VOICE_QUALITY.md). Realtime không đổi; không coi đây là cải thiện độ chính xác giọng clone.

**Luồng mặc định theo task:** `VOICE_ANALYSIS_STRATEGY=gemini`, Gemini đánh giá cả nội dung và dấu hiệu giọng tổng hợp; không cần worker Python. `hybrid` giữ bản cũ để so sánh. Xem [kết quả và cách chuyển](VOICE_TASK_COMPARISON.md).

**Model hiện tại:** [Gemini 3.8 Live Extended Thinking theo TASK](VOICE_LIVE_API.md).

**Cập nhật tiếp theo 2026-11-11:** [backoff, readiness và kiểm thử theo nhịp live](VOICE_FOLLOWUP.md).

**Bản sửa trước đó 2026-11-11:** [sửa coordinator, warmup và kết quả test thật](VOICE_RELIABILITY.md).
Xem thêm [cách test bằng chứng, lỗi Gemini và review file](VOICE_TESTING.md).
Review cho phép file tối đa 15 giây audio, budget xử lý 15 giây; thu micro/tab giữ cửa sổ 5 giây, budget Gemini nay 8 giây.

Mục 2.4 của TASK.md: thu âm, phân tích âm thanh bằng Gemini, và cảnh báo trong extension.
Có [detector âm học V3 chạy local bằng PyTorch](VOICE_DETECTOR_V3.md) trong chế độ `hybrid`, kết hợp với Gemini phân tích
nội dung. Chế độ `gemini` không gọi detector này. Xem hướng dẫn V3 để chạy worker, kết quả benchmark và giới hạn; phần Gemini vẫn hoạt động
khi chưa bật worker. [Báo cáo đối chiếu ban đầu](VOICE_IMPROVEMENTS.md) lưu lại các bước trước V2.

## Chạy local

```bash
pnpm install --frozen-lockfile
pnpm dev:sandbox
```

Máy chủ đọc `.env` tại gốc monorepo, cần `GEMINI_API_KEY` thực của bạn. Không đưa key này vào extension.
Backend Voice dùng Node >=22. `GEMINI_MODEL_VOICE` mặc định là
`gemini-3.8-live-extended-thinking`, tiếp theo `GEMINI_MODEL_VOICE_LIVE_FALLBACK=gemini-3.8-live`,
rồi `GEMINI_MODEL_VOICE_FALLBACK=gemini-3.5-flash-lite`. Hai Live model dùng WebSocket;
chỉ Flash dùng `generateContent`. Review kế thừa primary hoặc ghi đè bằng `GEMINI_MODEL_VOICE_REVIEW`,
vẫn dùng chuỗi fallback trong ngân sách chung. API/CLI dùng chung router; model override được ưu tiên.
Giao diện báo model xử lý thực tế và cờ fallback, không coi Flash là kết quả của 3.8.
Xem tài liệu Live để biết kết quả test thật và hạn chế còn lại; các số đo Flash trước đây là lịch sử.

```bash
pnpm build:extension
```

Chrome → `chrome://extensions` → Developer mode → Load unpacked →
`apps/extension/.output/chrome-mv3`. Mở popup, bấm **Bảo vệ cuộc gọi — ZeroLeak Voice**.

Trong trang Voice:

1. Chọn **Âm thanh từ tab** hoặc **Micro của bạn**.
2. Chọn **Một đoạn 5 giây** (mặc định): thu đủ 5 giây, tự ngừng thu rồi chờ kết quả; hoặc **Theo dõi liên tục**: phân tích từng đoạn cho đến khi dừng.
3. Bấm **Bắt đầu kiểm tra**, cấp quyền. Với tab, chọn Thẻ Chrome và bật chia sẻ âm thanh.
4. Thanh thời lượng phản ánh audio thực đã nhận; giao diện tách bước nhận âm thanh, phân tích và kết quả.
5. **Dừng thu và phân tích** dừng mọi track, gửi cả phần cuối đủ từ 0,5 giây và tiếp tục chờ yêu cầu đang chạy. **Hủy phân tích** mới bỏ yêu cầu/kết quả đang chờ.
6. Đóng trang hủy phiên. Chế độ một đoạn giữ kết quả ổn định đến lần kiểm tra tiếp theo. Chế độ liên tục chỉ hiện kết quả gần nhất, không xác minh toàn bộ cuộc gọi.

**Chọn file thử** tự động phân tích toàn bộ file dài tối đa 15 giây, budget xử lý 15 giây;
không cần chọn chế độ. File được giải mã trên thiết bị và chuyển thành WAV mono 16 kHz trước khi gửi;
file dài hơn báo lỗi, không âm thầm cắt cuối. Không upload định dạng file gốc. File tối đa 10 MB; file không giải mã được sẽ báo lỗi.
Micro không tự nghe được mọi âm thanh hệ thống: dùng nguồn tab cho cuộc gọi/video phát trong Chrome.
Tính năng không thu âm nền khi trang Voice đã đóng, và không thu cuộc gọi điện thoại ngoài trình duyệt.

Địa chỉ API mặc định `http://localhost:8080`. Đổi trong **Kết nối dịch vụ** khi dùng máy chủ khác.
HTTPS bắt buộc cho máy chủ từ xa. Khi `NODE_ENV=production`, phải đặt `VOICE_API_TOKEN` trên server
và nhập cùng mã truy cập ở trang Voice. Không công khai một API không có giới hạn chi phí/quota bổ sung;
giới hạn đồng thời hiện tại chỉ áp dụng trên từng tiến trình, không thay thế gateway/rate limit khi triển khai diện rộng.

## Lịch sử và cảnh báo trong phiên

Lịch sử trong RAM giữ tối đa 20 lượt kết quả/lỗi/hủy, không giữ raw audio hoặc embedding.
Cảnh báo nội dung có bằng chứng khớp transcript và điểm cao nhất của một đoạn được giữ riêng;
SAFE/UNKNOWN hoặc lỗi ở lượt sau không xóa cảnh báo đã có. Đây là thông tin lịch sử, không phải
điểm tổng hợp hay kết luận toàn bộ cuộc gọi. Ước lượng giọng tổng hợp không tự tạo cờ lừa đảo.
Sóng âm phản ánh cảnh báo đã ghi nhận của phiên; phần kết quả gần nhất vẫn cập nhật độc lập.

Nếu một đoạn chờ bị thay bởi đoạn mới hơn do dịch vụ xử lý chậm, UI đếm đoạn chưa gửi.
Bắt đầu phiên mới/chọn file mới/đóng trang xóa lịch sử. Không ghi history vào chrome.storage,
localStorage hoặc gửi history trở lại API. Xem [cách trình diễn](VOICE_DEMO.md).

## API

`POST /api/v1/analyze-voice`, `Content-Type: application/json`:

```json
{ "audioBase64": "<PCM WAV encoded as Base64>", "mimeType": "audio/wav" }
```

Mặc định chấp nhận PCM16 mono 16 kHz dài 0,5–5 giây, tối đa 160.044 byte. Đặt `analysisMode:"review"`
để gửi toàn file 0,5–15 giây, tối đa 480.044 byte. JSON fast giới hạn 220.000 byte, review 650.000 byte.
Server kiểm tra header, khối dữ liệu,
số frame và tín hiệu im lặng. WAV được chọn để mỗi cửa sổ đều đọc độc lập, tránh gửi các fragment WebM
không có header. File WebM/MP3 có thể chọn trong giao diện nếu Chrome giải mã được; server nhận WAV đã chuyển.

Ở chế độ mặc định `gemini`, model đánh giá cả hai và trả `syntheticVoiceProbability` từ 0 đến 1 hoặc null khi chưa đủ bằng chứng. Đây là ước lượng chưa hiệu chuẩn; UNKNOWN nội dung không tự xóa ước lượng âm học. Không suy giọng giả từ lời đòi OTP.
Ở chế độ `hybrid`, Gemini chỉ đánh giá nội dung, trường này null; xem `acousticAnalysis` từ worker V3. Hợp đồng kết quả giữ nguyên, không cần thay client.

Kết quả có `riskScore`, `verdict`, `syntheticVoiceProbability`, `detectedTactics`, `transcriptSnippet`,
`warningMessageVi`, `audioQuality`, `assessmentSource`, `analysisModel`, `executionTimeMs`.
Khi chọn `hybrid` và cấu hình detector local, có thêm `acousticAnalysis`; nguồn đánh giá có thể là `HYBRID_AUDIO` hoặc
`LOCAL_ACOUSTIC`. Cảnh báo giọng tổng hợp và nội dung lừa đảo được hiển thị riêng.
`UNKNOWN` và giá trị `null` biểu diễn chưa đủ bằng chứng; không thay bằng kết luận an toàn.
Lỗi có dạng `{ "error": { "code": "...", "message": "..." } }` và HTTP 400/401/413/415/429/502/503/504.
Nguồn trình duyệt được giới hạn cho extension Chrome và localhost. Thêm origin web được phép vào
`VOICE_ALLOWED_ORIGINS` nếu tích hợp web client; nguồn không được phép nhận HTTP 403 trước khi gọi Gemini.

Với realtime Gemini-only, yêu cầu extension có hard timeout 9.000 ms, route 8.300 ms. Bộ phân tích có một ngân sách chung 8.000 ms cho cả
model chính và fallback; không cộng nhiều timeout liên tiếp. Hủy phía client không đảm bảo vendor hủy
phần tính toán đã nhận. Khi lỗi/timeout, hiển thị chưa đánh giá được. Không tạo kết quả an toàn giả lập.
Model chính được dùng hết thời gian còn lại; không cắt sớm ở 2.100 ms để chừa một giây cho fallback.
Fallback chỉ chạy nếu có lỗi sớm và ngân sách chung còn đủ, không gọi thêm sau khi hết deadline.
Review tự động khi chọn file có ngân sách Gemini 15.000 ms, local 5.000 ms, route 15.300 ms, client 16.000 ms,
xử lý toàn bộ file tối đa 15 giây audio; fast vẫn 5 giây. Không dùng review để công bố đã đạt <3 giây.
Riêng Flash fallback, SDK đặt deadline của dịch vụ Google tối thiểu 10 giây vì API từ chối giá trị thấp hơn; deadline này
không thay thế bộ hủy/timeout độc lập 8.000 ms của Gemini-only. Chế độ hybrid cũ có collection deadline riêng 3.100 ms.

## Giới hạn cần trình bày đúng khi demo

- Đây là phân tích bằng Gemini theo blueprint của đội. Ước lượng giọng tổng hợp **chưa hiệu chuẩn**,
  không phải xác suất pháp y hoặc bộ phát hiện deepfake đã được kiểm định.
- `SAFE` nghĩa là chưa thấy dấu hiệu trong đoạn ngắn, không xác minh danh tính hoặc bảo đảm an toàn.
- Nhận diện lời thoại lừa đảo và dấu hiệu giọng nhân tạo là hai kênh bằng chứng riêng. Prompt yêu cầu
  không suy ra giọng giả chỉ vì nội dung có OTP/chuyển tiền. Đầu ra vẫn có thể sai.
- `DEEPFAKE_SCAM` được giữ theo hợp đồng chung; giao diện mô tả là **Nguy cơ lừa đảo qua cuộc gọi**.
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
