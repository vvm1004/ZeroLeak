# Cải thiện Gemini 3.8 Live Extended Thinking — 2026-11-11

Đã giữ lại bản tối ưu **chính `gemini-3.8-live-extended-thinking`** sau A/B và một lượt kiểm tra mới.
Cải thiện được khả năng trả kết luận hợp lệ. Không đổi model âm học V3, ngưỡng cảnh báo hoặc ngân sách
3.100/15.000 ms, và không dùng kết quả fallback để tính thành tích của Extended.

## Thay đổi và lý do

Extended trả AUDIO cùng output transcription, không có structured-output schema được bảo đảm.
Bản cũ yêu cầu JSON sáu trường kèm chép lời và quote; đầu ra dài và có lỗi định dạng/timeout.
Bản mới yêu cầu JSON năm trường gọn `a,v,r,q,f`: speech act, verdict, risk, quality và findings.
Enum số chỉ là định dạng truyền; model vẫn tự quyết định nội dung/risk/tactic. Backend giải mã lại
`VoiceScamAnalysisResult` cũ nên Extension và hai model fallback không cần đổi hợp đồng.

Input ASR **cùng phiên Google** làm transcript và nguồn đối chiếu quote; không yêu cầu model lặp lại
transcript trong đầu ra. Audio/ASR luôn được đánh dấu dữ liệu không đáng tin, không phải chỉ dẫn.
Chỉ gửi yêu cầu đánh giá sau ACK audio và khi ASR có chữ; ACK đến trước ASR vẫn xử lý được.
ASR không phải kết luận, nhãn thật hay xác minh độc lập của audio; lỗi nhận dạng vẫn có thể làm bỏ sót.

Parser kiểm tra đủ năm trường, enum, khoảng điểm, độ dài và quote, rồi dùng lại toàn bộ guard:
lời khuyên/trích dẫn, quote không khớp, urgency thiếu hành động nhạy cảm, lời thoại không rõ và
kết quả mâu thuẫn đều không thành cảnh báo chắc chắn. Bí mật được che trước khi trả về UI.
Không có ASR thì hết deadline với lỗi, không tự tạo transcript/SAFE. Không suy giọng giả từ việc đòi OTP.

Vẫn đợi Thinking `IDLE`. Nếu một utterance hợp lệ còn `IN_PROGRESS`, có thể giữ tạm; nếu utterance
mới không rỗng bị lỗi thì xóa kết luận cũ để tránh trả lại SAFE cũ khi IDLE đến. Socket được đóng
khi hoàn tất/hủy/deadline. Không thêm retry, phiên dùng chung, dependency hoặc lưu audio/transcript vào log.

## Phương pháp đã cố định trước dự đoán

[Protocol](evaluations/voice-extended-2026-11-11-protocol.json) và
[hash đóng băng](evaluations/voice-extended-2026-11-11-frozen.json) được tạo trước khi chấm.
Baseline là adapter tại commit `d4c5937`; candidate gồm `voice-live.ts`, `voice-live-output.ts`,
`voice-result.ts`, `voice-input.ts`. Source production của bốn module khớp candidate đã chấm.

- Bốn WAV development đã biết: họp, đòi OTP, khuyên không chia sẻ OTP, giả danh sếp đòi tiền.
  Mỗi câu chấm cả nhanh/review trên hai adapter: **16 phiên**, đổi thứ tự trước/sau, cùng WAV/SHA.
- Sáu câu mới được viết, gán nhãn và tạo WAV trước khi xem dự đoán candidate: mật khẩu để mở khóa,
  sếp đòi tiền/ngăn gọi lại, mã xác thực để tránh phạt, lời khuyên giữ mã, deadline thiết kế, kể lời
  đòi tiền đã từ chối. **6 phiên review**, không dùng để sửa prompt/ngưỡng sau khi chấm.
- Cùng một giọng TTS tiếng Việt macOS Linh, mono PCM16/16 kHz, 0,5–5 giây, không cắt cụt câu.
  Đây là kiểm thử nội dung/giao thức, **không phải test phân biệt người thật với voice clone**.
- Primary-only, không fallback; không retry; cách lần bắt đầu ít nhất 6 giây. Nhãn/ID/file không gửi
  lên model. Lỗi/UNKNOWN nằm trong mẫu số. Tổng giới hạn 32 phiên; thực dùng 24, gồm hai ca Chrome.
- Gate định trước: không thêm false alert/confident miss, không giảm coverage từng mode và có lợi ích
  đo được. Fresh yêu cầu >=4/6 có kết luận, >=2 scam đúng, >=2 benign đúng, không FP/confident miss.
  Cả hai gate qua. Không tuyên bố có ý nghĩa thống kê từ số mẫu nhỏ này.

## Kết quả, gồm cả thất bại

[A/B từng lượt](evaluations/voice-extended-2026-11-11-comparison.json):

- Nhanh: baseline **0/4** có kết luận, candidate **2/4** (1 scam + 1 benign đúng).
  Candidate còn **2 timeout**; không tính chúng là phát hiện đúng hoặc chứng minh cuộc gọi an toàn.
- Review: baseline **0/4**, candidate **3/4** (1 scam + 2 benign đúng).
  Candidate còn **1 INVALID_RESULT**, không che bằng fallback/chạy lại.
- Gộp hai mode: **0/8 → 5/8** có kết luận đúng trong lượt này. Baseline có 4 lỗi định dạng và
  4 timeout; candidate 1 lỗi định dạng và 2 timeout. Không dùng lỗi định dạng nhanh của baseline
  làm bằng chứng candidate chậm hơn/nhanh hơn; chưa chứng minh giảm median latency.

[Sáu câu mới](evaluations/voice-extended-2026-11-11-fresh.json): **6/6 có kết luận**, 3/3 scam cảnh báo,
3/3 benign không báo nhầm; không UNKNOWN/lỗi trong lượt này. Round-trip adapter **2.562–3.088 ms**,
median **3.015,5 ms**. Mode review cho tối đa 15 giây, kết quả này không chứng nhận deadline 3 giây.
Những câu này nay đã được xem kết quả; chạy lại chỉ là hồi quy. Không gọi đây là accuracy thực tế 100%.

[Chrome thật](evaluations/voice-extended-2026-11-11-browser.json), không mock provider, hai file dev cố định:

- OTP review: **DEEPFAKE_SCAM/95**, đúng tactic OTP, HYBRID_AUDIO, HTTP 200, **3.251 ms**.
- Advice nhanh: **SAFE/0**, không tactic, HYBRID_AUDIO, HTTP 200, **2.918 ms**. Âm học vẫn báo
  synthetic vì đây là TTS; nội dung lời khuyên không bị coi là scam chỉ vì giọng AI.
- Cả hai thực sự dùng Extended qua LIVE_API, `fallbackUsed:false`, UI hiển thị đúng model.
  Thời gian gồm tải file/decode/request đến HTTP response, chưa gồm thu một cửa sổ audio 5 giây.

**70 test backend**, TypeScript typecheck và build qua. Bổ sung test codec, ASR đến trễ, không ASR,
quote/PII, UNKNOWN, output mâu thuẫn và candidate SAFE cũ. Test fixture không đo accuracy mô hình.
Screenshot nằm ngoài Git: `test-results/voice-extended-20261111/`.

## Chạy thử

Không sửa `.env`. Backend đang dùng mặc định Extended → Live → Flash-Lite; các override model trong
`.env` vẫn được ưu tiên. Nếu dịch vụ đã mở thì không mở thêm trùng port. Khi cần khởi động:

```bash
pnpm dev:voice-detector
pnpm dev:sandbox
```

Mỗi lệnh trong một terminal. Reload extension hiện tại, mở Voice, chọn file WAV/MP3/WebM và bật
**Phân tích kỹ file** để kiểm tra review. Bản này chỉ sửa backend, không cần build lại Extension.
Kỳ vọng yêu cầu cung cấp OTP/mật khẩu có tactic và quote; lời khuyên không chia sẻ không có tactic.
Nhìn `analysisModel`/fallback thực tế; UNKNOWN nghĩa là chưa đánh giá được, không phải SAFE.

Sáu file mới và bản sao nguồn/script cố định nằm ngoài Git:
`~/Library/Caches/ZeroLeak/voice-extended-20261111/`. Ví dụ dry-run chỉ kiểm tra dữ liệu, **0 API call**:

```bash
pnpm --filter @zeroleak/sandbox-api exec tsx scripts/evaluate-voice.ts \
  --manifest "$HOME/Library/Caches/ZeroLeak/voice-extended-20261111/fresh/cases.json" \
  --model gemini-3.8-live-extended-thinking --mode review --limit 6 --max-calls 6 \
  --output /private/tmp/voice-extended-regression-new.json --dry-run
```

Bỏ `--dry-run` sẽ dùng quota và tạo báo cáo mới; không ghi đè báo cáo cũ. `--model` giữ primary-only.
Các SHA trong báo cáo CLI bao gồm codec mới và input parser. Không đưa audio/embedding/key vào Git.

## Giới hạn và việc tiếp theo

Fast vẫn 2/4 timeout trong A/B; một ca Chrome nhanh thành công không đủ nghiệm thu Test 6.
Độ trễ trên tính từ lúc gửi clip, chưa tính thời gian thu. Mỗi clip có phiên riêng, chưa có ngữ cảnh
xuyên nhiều đoạn; câu trước/sau và ASR bị cắt/nhận sai có thể ảnh hưởng kết luận.
Chưa kiểm định người thật, nhiều giọng/vùng miền, codec cuộc gọi, noise hoặc prompt injection audio
trên tập ngoài. Giọng clone nhiễu vẫn là điểm yếu V3; không có thay đổi trọng số/ngưỡng âm học ở đây.
Ưu tiên tiếp là bộ test ngoài có người gán nhãn và đánh giá latency cuộc gọi liên tục. **Test 6 vẫn để trống**.
