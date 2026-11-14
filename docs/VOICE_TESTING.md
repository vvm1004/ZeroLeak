# Voice: kiểm tra nội dung, bằng chứng và lỗi — 2026-11-11

**Cập nhật model:** [Gemini 3.8 Live Extended Thinking](VOICE_LIVE_API.md).
Các phép đo/luồng Flash bên dưới được giữ làm lịch sử; head âm học V3 không thay đổi.

**Cập nhật tiếp theo:** [bản sửa độ ổn định và bộ 12 câu mới](VOICE_RELIABILITY.md).
Các kết quả 24 ca bên dưới được giữ làm lịch sử.

Bản này củng cố luồng Voice và bổ sung bộ kiểm thử nội dung Gemini. **Chưa có bằng chứng để công bố
accuracy tốt hơn hoặc nghiệm thu Test 6.** Detector âm học vẫn là [V3](VOICE_DETECTOR_V3.md).
Chế độ phân tích kỹ file là tùy chọn thử nghiệm, không thay deadline thu âm trực tiếp.

## Thay đổi đã triển khai

- Gemini phân loại hành vi lời nói trước: yêu cầu trực tiếp, lời khuyên an toàn, trích dẫn, bình thường,
  hoặc chưa rõ. Schema gọn trả `findings` gồm tactic và quote. Server suy ra `detectedTactics` và
  `tacticEvidence`, tự tạo khuyến nghị tiếng Việt để giảm output trùng lặp.
- Mỗi tactic cần một quote ít nhất ba từ khớp transcript. Quote ngoài transcript, tactic không khớp,
  bằng chứng trùng, cảnh báo không có tactic, hoặc hành vi lời nói mâu thuẫn đều giữ nội dung UNKNOWN.
  Transcript/quote được che thêm số và bí mật ở server. Việc khớp hai văn bản cùng do Gemini sinh
  **không phải đối chiếu độc lập với audio** và không bảo đảm loại hết báo nhầm.
- Gemini hiện tập trung phân tích nội dung; `syntheticVoiceProbability` vẫn giữ để tương thích nhưng
  ở schema mới trả null. Giọng tổng hợp được đánh giá riêng bởi `acousticAnalysis` của worker local.
- `contentAnalysis` phân biệt provider đã trả kết quả với provider không khả dụng. Khi không khả dụng,
  `reason` là `TIMEOUT`, `RATE_LIMITED`, `NOT_CONFIGURED`, `INVALID_RESULT` hoặc `PROVIDER_ERROR`.
  Không gửi lỗi nguyên văn/key của provider tới client. Không có kết quả Gemini thì nội dung UNKNOWN.
- Sóng âm đỏ khi nội dung là DEEPFAKE_SCAM, vàng khi SUSPICIOUS, xám khi UNKNOWN. Giọng AI đọc nội dung
  bình thường không tự làm kết luận nội dung thành scam. Cửa sổ sau lỗi sẽ bỏ kết quả SAFE cũ.
- File có thể chọn **Phân tích kỹ file (thử nghiệm, tối đa 15 giây)**. Live micro/tab vẫn dùng ngân sách
  Gemini 3.100 ms, local 2.800 ms, client 3.500 ms. Review dùng Gemini tối đa 15.000 ms,
  local tối đa 5.000 ms, route 15.300 ms, client 16.000 ms; audio vẫn chỉ 0,5–5 giây.
  Đã đo một lượt local lạnh 3.272 ms: deadline live loại kết quả này, nên review có ngân sách riêng.
- Live và review hiện mặc định dùng `gemini-3.1-flash-lite`; review kế thừa model chính, có thể
  ghi đè `GEMINI_MODEL_VOICE_REVIEW`. Chỉ một lần gọi model trong review, không cộng thêm fallback.
  API và CLI dùng chung lựa chọn model; xem cập nhật độ ổn định ở trên.
- `/health` báo các capability Voice và `localAcousticConfigured`. Đây là trạng thái cấu hình,
  không phải xác nhận Gemini có quota hoặc cam kết worker sẽ hoàn tất mọi request đúng hạn.

## Kết quả thử nghiệm cần trình bày đúng

Bộ nội dung có 8 câu development và 12 câu test do nhóm tự viết. Test có clean và Opus 16 kbps,
tổng 24 ca: 12 scam và 12 benign. Tất cả được tổng hợp bằng một giọng macOS Linh; chưa có người thật,
cuộc gọi vật lý, cân bằng vùng miền hoặc đánh giá nhãn độc lập. Hai codec cùng câu không độc lập.

Baseline cũ trên dev: 2 cảnh báo đúng, 2 benign đúng, 1 báo nhầm câu trích dẫn, 3 lỗi provider.
Prompt gọn phân loại hành vi đã xử lý đúng câu trích dẫn đó trong một lượt development;
không coi đây là chứng minh cải thiện trên test.

Trên đủ 24 ca test review:

- 10/12 ca scam được cảnh báo, 2 ca scam lỗi/chưa đánh giá được.
- 6/12 ca benign được nhận đúng, 2 báo nhầm, 4 lỗi/chưa đánh giá được.
- 18/24 phản hồi có đánh giá nội dung, coverage 75%; 6 lỗi/timeout được giữ trong mẫu số.
- Không báo accuracy 100% từ FN=0 trên phần được chấm; còn 2 báo nhầm và 6 ca không có kết quả.
- **Không đạt gate** ghi trước: cần ít nhất 20 phản hồi hợp lệ, >=10 scam đúng, >=10 benign đúng,
  và 0 báo nhầm. Không chỉnh prompt/ngưỡng theo đáp án của tập này.

Lượt đầu dừng sau 3 lỗi liên tiếp. Sau khi một smoke UI thật nhận được Gemini hợp lệ, chỉ gửi tiếp
21 ca chưa từng thử, không chạy lại ba ca lỗi. Hai phần có cùng request definition; không có dự đoán
ngữ nghĩa nào trong phần đầu. Hash code từng phần được giữ riêng vì có thêm guard bảo thủ/trạng thái lỗi.
Lỗi dịch vụ và UNKNOWN không được tính là đúng. Kết quả này là đánh giá chế độ review 15 giây,
**không chứng minh mục tiêu <3 giây cho cuộc gọi trực tiếp**.

Checkpoint âm học khác (MelodyMachine V2) được sàng lọc trên 48 ca calibration: 8/24 human bị cảnh báo
nhầm, chỉ 9/24 synthetic được cảnh báo; V3 tương ứng 2 và 21 trên cùng nhóm. Đã loại ứng viên này,
không đổi head V3 và không dùng các ca calibration làm holdout mới. Hạn chế clone có nhiễu của V3 còn nguyên.

## Chạy trên máy hiện tại

Ở `/Users/quangkimle/Documents/code/ZeroLeak`, nếu dịch vụ chưa chạy:

```bash
pnpm dev:voice-detector
pnpm dev:sandbox
```

Mỗi lệnh chạy ở một terminal riêng. Kiểm tra `/health` tại cổng 8080 và 8081, không mở trùng port.
Build và reload extension trong `chrome://extensions`:

```bash
pnpm build:extension
```

Load unpacked ở `apps/extension/.output/chrome-mv3`, mở ZeroLeak Voice. Micro/tab luôn chạy nhanh.
Với file, bật checkbox phân tích kỹ nếu chấp nhận chờ thêm. Tùy chọn này không tăng chất lượng detector
âm học hoặc bảo đảm Gemini đúng hơn. Khi Gemini lỗi, kiểm tra lý do hiển thị và kết quả local riêng.

Dữ liệu mẫu nằm ngoài Git:

```text
~/Library/Caches/ZeroLeak/voice-content-evaluation-v1/audio
```

- `dev_otp_request_clean.wav`: yêu cầu OTP, mong cảnh báo nội dung khi model phân tích được.
- `dev_warning_clean.wav`: khuyên không chia sẻ OTP, mong không bị gán yêu cầu cung cấp OTP.
- `dev_quote_clean.wav`: trích lời kẻ lừa đảo để cảnh báo, mong không báo nhầm.

Đây là các ca đối chiếu development, không được dùng làm số đo accuracy độc lập. Nếu provider không
khả dụng, kết quả mong muốn của phần mềm là UNKNOWN/lý do lỗi, không sinh SAFE hoặc điểm giả.

## Chạy kiểm thử phần mềm

```bash
pnpm --filter @zeroleak/sandbox-api test
pnpm --filter @zeroleak/extension test:voice
pnpm test:voice:e2e
```

E2E dùng fixture provider, được gắn nhãn rõ: kiểm tra Chrome/AudioWorklet, bằng chứng, màu cảnh báo,
thu/dừng, lỗi và timeout; không đo accuracy AI. Máy hiện tại đã tải browser ở cache riêng;
ếu Playwright tìm sai chỗ, dùng:

```bash
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/zeroleak-playwright-browsers pnpm test:voice:e2e
```

Trên máy khác, cài Chromium bằng `pnpm exec playwright install chromium`.

## Chạy đánh giá Gemini thật

Lệnh sau có gọi Gemini và dùng quota. Output phải là file mới. Bộ test này đã được xem, nên lần chạy
lại chỉ kiểm tra hồi quy/độ sẵn sàng, không phải holdout độc lập mới.

```bash
pnpm --filter @zeroleak/sandbox-api exec tsx scripts/evaluate-voice.ts \
  --manifest "$HOME/Library/Caches/ZeroLeak/voice-content-evaluation-v1/test-cases.json" \
  --mode review --model gemini-3.1-flash-lite --split test \
  --limit 24 --max-calls 24 --interval-ms 6000 \
  --output /private/tmp/voice-content-recheck-01.json
```

Dùng `--dry-run` để xác minh input mà không gọi Cloud. `--mode realtime` đo riêng ngân sách live;
`--mode quality` là chẩn đoán với timeout riêng, không đại diện SLA. Với nội dung, xem `summary.content`;
metrics `syntheticScore`/coverage ở phần screening cũ không đánh giá local detector trong CLI này.
CLI từ chối cắt bớt cohort do `--limit`, kiểm checksum/đường dẫn/WAV, không gửi nhãn cho model,
không ghi audio/transcript/quote vào báo cáo và dừng khi gặp ba lỗi liên tiếp.

Tạo bộ mới bằng `prepare-voice-content.py --output <thư-mục-mới>` trên macOS có giọng Linh và ffmpeg.
Cần thay các kịch bản và giữ test chưa dùng trước khi chỉnh model/prompt tiếp; không tận dụng đáp án
của bộ này để nâng chỉ số rồi gọi đó là holdout. Raw audio/cache không được commit.

Bằng chứng: [test gộp](evaluations/voice-content-v1-combined-test-report.json),
[freeze/gate](evaluations/voice-content-v1-freeze.json),
[kế hoạch tiếp tục ca chưa thử](evaluations/voice-content-v1-resume-plan.json),
[screening âm học](evaluations/voice-content-v1-acoustic-screening-report.json),
[smoke UI thật](evaluations/voice-content-v1-live-ui.json),
[route + worker thật khi không cấu hình Cloud](evaluations/voice-content-v1-local-route.json).
Tài liệu nền: [Google audio understanding](https://ai.google.dev/gemini-api/docs/audio).
