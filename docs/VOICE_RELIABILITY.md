# Voice: sửa độ ổn định và kiểm thử lại — 2026-11-11

Đã sửa các lỗi điều phối và khởi động của Voice, giữ nguyên head V3 và ngưỡng âm học.
**66 kiểm thử phần mềm qua; bộ kiểm định nội dung mới chưa đạt gate.** Chưa nghiệm thu Test 6
về cuộc gọi giả giọng thực tế trong <3 giây. Kết quả này không chứng minh detector deepfake chính xác hơn.

## Các lỗi đã xử lý

- **Mất kết quả khi một nhánh treo:** coordinator chạy Gemini và local song song, thu kết quả đến
  deadline chung 3.100 ms live / 15.000 ms review, rồi hủy phần chưa xong. Giữ nhánh đã hoàn tất;
  ngay cả khi adapter còn lại không tuân thủ AbortSignal. Người dùng bấm dừng vẫn hủy toàn bộ,
  không trả kết quả cũ. Cả hai nhánh lỗi thì trả lỗi, không tạo SAFE.
- **Worker nguội và tranh chấp warmup:** trước readiness, nạp mô hình và warmup các độ dài
  0,5 / 3 / 5 giây cùng VAD. Khi rảnh 60 giây, refresh bằng tensor zero, không dùng bản thu người dùng.
  Warmup và inference dùng chung khóa nên không chạy chồng. Request chỉ đợi khóa tối đa 300 ms
  nếu đang refresh nền; API thử lại BUSY đúng một lần sau 200 ms trong ngân sách local hiện có.
  `/health` thể hiện readiness, đã warmup và số lượt idle refresh; lỗi refresh làm readiness false.
- **Cấu hình model lệch giữa phục vụ và đánh giá:** dùng chung `voiceModelRoute` cho API và CLI.
  Mặc định `gemini-3.1-flash-lite` cho live lẫn review, fallback live `gemini-3.5-flash-lite` khi
  lỗi sớm và còn ngân sách. Review kế thừa model chính trừ khi đặt `GEMINI_MODEL_VOICE_REVIEW`.
  Các biến môi trường được ưu tiên; không sửa key hoặc `.env` của người dùng.
- **Gán lừa đảo chỉ vì giục việc:** `URGENCY_PRESSURE` cần ngữ cảnh hành động nhạy cảm như tiền,
  OTP, mật khẩu hoặc điều khiển từ xa trong transcript. Chỉ có lời giục họp/nộp báo cáo thì giữ
  UNKNOWN nếu model gán tactic này. SAFE mâu thuẫn với findings cũng về UNKNOWN. Đây là điều kiện
  cần để từ chối cảnh báo thiếu cơ sở, không phải quy tắc từ khóa tự kết luận SAFE.
- **E2E bỏ qua coordinator:** server fixture hiện đi qua coordinator thật; chỉ phần trả lời Gemini
  được giả lập. Fixture không gọi nhầm worker local đang chạy và không dùng để đo accuracy AI.

Deadline thu micro/tab, giới hạn input, hợp đồng API và head V3 không tăng/thay đổi. Không thêm
phụ thuộc. Việc đổi model mặc định giúp cấu hình nhất quán, không phải bằng chứng model này tốt hơn.

## Kiểm thử phần mềm

39 test backend, 12 test Python, 4 test client/audio và 11 kịch bản Chrome E2E đều qua.
Có test deadline giữ từng nhánh, adapter bỏ qua abort, hủy từ caller, giới hạn BUSY retry,
chọn model, lời giục việc vô hại và yêu cầu chuyển tiền/OTP thực sự. Backend build,
client typecheck và typecheck CLI đánh giá đều qua.

[Bản xác minh](evaluations/voice-reliability-2026-11-11-verification.json) phân biệt test fixture
với các lượt gọi dịch vụ thật dưới đây.

## Worker âm học thật

[90 ca hồi quy qua HTTP](evaluations/voice-reliability-2026-11-11-acoustic-regression.json),
45 human và 45 synthetic, đều xử lý được, median 595 ms, tối đa 935 ms trong lượt đo tuần tự.
Cả 90 score/verdict khớp V3 đã đóng băng (sai số score <=1e-6). **90 ca xử lý không lỗi không có
nghĩa 90 ca nhận diện đúng:** chỉ 15/45 synthetic được cảnh báo, 24 UNKNOWN và 6 có điểm thấp;
human có 0 cảnh báo nhầm, 5 UNKNOWN. Khả năng clone có nhiễu vẫn là hạn chế của V3.

[Probe nghỉ rồi gọi lại](evaluations/voice-reliability-2026-11-11-idle-probe.json) quan sát được
idle refresh ở cấu hình thử 30 giây: request đầu 736 ms, sau refresh 558 ms, cùng score/head.
Runtime hiện dùng mặc định 60 giây. Đây không phải kiểm định tải hoặc cam kết độ trễ mọi điều kiện.

## Gemini thật trên bộ nội dung mới

[Protocol](evaluations/voice-reliability-2026-11-11-protocol.json) chốt trước dự đoán:
12 câu mới, 6 scam / 6 benign; một giọng macOS Linh, clean, tối đa 5 giây mỗi câu.
Hai ca báo nhầm họp gấp của bộ cũ được chuyển thành hồi quy development, không gọi là test mới nữa.
Không gửi nhãn cho Gemini; không sửa prompt/ngưỡng theo kết quả của 12 câu này.

[Kết quả](evaluations/voice-reliability-2026-11-11-content.json): 3 TP, 5 TN, 0 FP, 0 FN,
**4 chưa đánh giá được**, coverage 8/12 (66,7%). Ba ca gặp lỗi provider; một câu giục nộp báo cáo
về UNKNOWN theo guard bảo thủ. UNKNOWN/lỗi không tính là đúng. `summary.content` là chỉ số cần đọc;
nhóm chỉ số synthetic ở cấp trên không đo nội dung, vì nhánh Gemini không đo giọng giả.

[Gate không đạt](evaluations/voice-reliability-2026-11-11-gate.json): cần 0 FP, >=5 scam được
cảnh báo và >=10 ca được đánh giá; chỉ đạt điều kiện đầu. Không công bố accuracy 100% từ 8 ca có kết quả.
Đây chưa phải tập cuộc gọi thật, nhiều giọng/vùng miền hoặc đánh giá nhãn độc lập.

## Chrome, API, Gemini và worker thật

[Lượt thử giao diện](evaluations/voice-reliability-2026-11-11-browser.json) dự kiến 10 ca trên
5 file TTS đã dùng, mỗi file chế độ live và review. Đã chạy 4 ca: cả 4 HTTP 200, đúng mode,
hiển thị được kết quả và có local đúng head. Gemini chỉ sẵn sàng 1/4 ca; ba ca còn lại giữ nội dung
UNKNOWN với TIMEOUT/PROVIDER_ERROR và vẫn hiển thị kết quả âm học. Sau 3 lỗi provider liên tiếp,
**dừng và ghi 6 ca SKIPPED**, không gọi lại đến khi ra kết quả đẹp. SKIPPED không tính là pass.

Đây là smoke hồi quy bằng upload file, không phải thu cuộc gọi vật lý. Không so tỷ lệ đúng trực tiếp
với lượt trước vì dịch vụ/điều kiện và số ca khác nhau. Screenshot local ở
`test-results/voice-fixes-20261111/`, không chứa audio hoặc key.

## Chạy và kiểm tra

Tại thư mục repo, mỗi lệnh trong một terminal, chỉ mở dịch vụ nếu port tương ứng chưa chạy:

```bash
pnpm dev:voice-detector
pnpm dev:sandbox
```

Worker sẵn sàng khi `http://127.0.0.1:8081/health` báo `ready: true`, `warmupComplete: true`.
API ở `http://127.0.0.1:8080/health`. API báo configured không bảo đảm Gemini có quota/đang sẵn sàng.
Build/reload extension theo [VOICE.md](VOICE.md). Khi Gemini lỗi, mong nội dung UNKNOWN cùng lý do lỗi
và kết quả local độc lập; không mong một kết luận SAFE thay thế.

Warmup idle dùng thêm CPU định kỳ. Có thể thêm `--keep-warm-seconds 0` khi chạy trực tiếp
`scripts/voice_acoustic.py` để tắt; mặc định 60, giá trị bật hợp lệ 30..600 giây.
Audio cho 12 câu mới được lưu ngoài Git tại
`~/Library/Caches/ZeroLeak/voice-reliability-20261111/content/audio` cùng manifest và protocol.
Đây đã là dữ liệu được xem kết quả; lần chạy lại chỉ là hồi quy. Không dùng làm holdout mới.

Các lệnh kiểm thử phần mềm:

```bash
pnpm --filter @zeroleak/sandbox-api test
pnpm --filter @zeroleak/extension test:voice
"$HOME/Library/Caches/ZeroLeak/voice/venv/bin/python" -B -m unittest discover \
  -s apps/sandbox-api/test -p 'test_*.py'
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/zeroleak-playwright-browsers pnpm test:voice:e2e
```

Đường dẫn venv/browser ở trên dành cho máy hiện tại; cài theo hướng dẫn V3 trên máy khác.
Chạy đánh giá Gemini thật có dùng quota; xem [VOICE_TESTING.md](VOICE_TESTING.md).

## Những việc chưa được giải quyết bằng bản vá này

Gemini vẫn có lỗi/timeout; chưa bảo đảm cảnh báo nội dung <3 giây. V3 chưa bắt tốt voice clone
qua nhiễu, chưa hiệu chuẩn xác suất, và chưa có kiểm định cuộc gọi thực tế nhiều người nói.
Cần đánh giá dữ liệu người thật/clone được phép dùng, codec và môi trường thực trước khi nghiệm thu
Test 6. Bản vá cải thiện độ tin cậy của phần mềm và tránh kết luận quá mức; chưa đủ để xác nhận
mọi issue về chất lượng AI đã hết.
