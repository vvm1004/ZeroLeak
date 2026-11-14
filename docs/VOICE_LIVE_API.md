# ZeroLeak Voice với Gemini 3.8 Live — 2026-11-11

Đã sửa khác biệt với TASK: model mặc định thực sự là **`gemini-3.8-live-extended-thinking`**,
gọi Live API bằng WebSocket. Không gửi tên Live model vào `generateContent`.
**63 test backend, 5 test client và 12 Chrome E2E qua; chưa nghiệm thu Test 6 dưới 3 giây.**
Các kết quả Flash-Lite trong tài liệu trước không phải benchmark của 3.8.

## Luồng hiện tại

Extension → WAV PCM16 mono 16 kHz, 0,5–5 giây → `/api/v1/analyze-voice` → hai nhánh song song:

- Nội dung: **3.8 Live Extended Thinking → 3.8 Live → 3.5 Flash-Lite**.
- Dấu hiệu giọng tổng hợp: worker local XLSR/AASIST + head V3, giữ nguyên trọng số/ngưỡng.

Hai model Live dùng `bidiGenerateContent` qua WebSocket phía backend. Chỉ Flash-Lite dùng
`@google/genai.models.generateContent`. Mỗi clip có phiên WebSocket riêng, không trộn audio
hai người dùng và không giữ lịch sử qua các cửa sổ 5 giây. Đây là truyền clip qua Live API,
**chưa phải phiên Live liên tục bao trọn cuộc gọi**.

`voice-input.ts` lấy đúng chunk `data` kể cả WAV có metadata; Live nhận raw PCM, không nhận header WAV.
Chỉ gửi audio sau `setupComplete`, chia frame <=100 ms. Đợi server xác nhận kết thúc hoạt động
hoặc transcription hoàn tất rồi mới yêu cầu đánh giá, tránh text prompt ngắt audio chưa được xử lý.
Raw Google gửi `voiceActivity.type`; SDK đổi thành `voiceActivityType`. Cả hai cách đặt tên được xử lý;
không giả định `inputTranscription.finished` luôn có mặt.

Live không có bảo đảm `responseSchema` như Flash. Extended dùng cấu hình AUDIO, thinking LOW và
`outputAudioTranscription`: chỉ JSON **do model tạo** được parse/kiểm tra. Không dùng transcription
đầu vào hoặc thought summary làm kết quả. Đợi `interactionStatus: IDLE`; `turnComplete` với
`IN_PROGRESS` chưa hoàn tất. Giữ một JSON hợp lệ đã phát để đợi IDLE, bỏ lời đệm. Standard Live
còn hỗ trợ hàm báo cáo `NON_BLOCKING`; ACK rồi đóng sau khi nhận báo cáo cuối hợp lệ.
Đã thử TEXT modality nhưng dịch vụ từ chối; không dùng cách đó trong bản giữ lại.

Parser chung giữ kiểm tra quote/tactic, lời khuyên/trích dẫn, yêu cầu nhạy cảm và redaction như trước.
JSON sai/thiếu bằng chứng không trở thành SAFE. `syntheticVoiceProbability` vẫn null ở schema mới;
điểm âm học độc lập nằm trong `acousticAnalysis`, không suy giọng giả chỉ vì có yêu cầu OTP.

Backend cần **Node >=22** cho WebSocket có sẵn. Không thêm dependency hoặc đổi lockfile.
Native WebSocket cho phép đóng ngay cả khi còn chờ setup; SDK 2.32 hiện chờ `setupComplete`
trước khi trả session nên không cung cấp socket sớm cho nhánh hủy này. API key ở server, không vào bundle.

## Deadline, fallback và thông tin trên giao diện

Giữ ngân sách phân tích live 3.100 ms, review 15.000 ms **cho toàn chuỗi**, không nhân ba theo model.
Fallback chỉ thử khi model trước lỗi sớm và còn thời gian. Nếu model chính dùng hết thời gian,
không gọi thêm model sau deadline. Backoff từng model sau 3 lỗi tạm thời; có thể bỏ qua model đang nghỉ.
Caller bấm dừng không bị tính là provider lỗi. Khi collection deadline hủy một model còn treo,
cho tối đa 20 ms để ghi nhận lỗi/trace rồi trả nhánh local; hard limit route vẫn 3.200/15.300 ms.

Kết quả mới có `analysisTransport`, `fallbackUsed`, `providerAttempts`. UI hiển thị model thành công
thực tế, cờ dự phòng và các model thất bại/tạm nghỉ. Không ghi Flash fallback là thành công của 3.8.
Khi Gemini không khả dụng chỉ hiển thị local riêng, nội dung UNKNOWN cùng lý do, không tạo điểm giả.
`/health` báo route/capability cấu hình, không chứng nhận quota hoặc độ chính xác của provider.

## Kiểm chứng với dịch vụ thật

[Model access](evaluations/voice-live-2026-11-11-model-access.json) xác nhận API key nhận được hai model
3.8 với `bidiGenerateContent`, còn Flash-Lite với `generateContent`. Đây chỉ là kiểm tra khả dụng cấu hình.

[Adapter thật](evaluations/voice-live-2026-11-11-primary-adapter.json) gọi Extended Thinking trên file
TTS OTP development: SUSPICIOUS/100, tactic OTP_OR_CREDENTIAL_ASK, khoảng **2.353 ms**.
Model thực sự là 3.8 Extended Thinking, không fallback; một mẫu không chứng minh accuracy tổng thể.

[Lượt Chrome đầu](evaluations/voice-live-2026-11-11-browser.json), ba file development đã biết:
meeting realtime, OTP realtime, warning review. Cả ba HTTP 200 và giữ local, nhưng **cả ba không có
kết quả nội dung** vì INVALID_RESULT/TIMEOUT. Hai ca nhanh lần lượt khoảng 3.494/3.133 ms;
ca review khoảng 15.069 ms. Không tính UNKNOWN/lỗi là đúng và không xóa các ca này khỏi báo cáo.

[Ca review bổ sung](evaluations/voice-live-2026-11-11-browser-review.json) đối chiếu cùng file OTP với
adapter trực tiếp, khác mode so với ca OTP realtime trước: Chrome → API → Extended Thinking → worker
trả HYBRID_AUDIO, SUSPICIOUS/90, `fallbackUsed: false`, **3.880 ms**. UI hiển thị đúng model.
Đây là kiểm tra mode review riêng, không chạy lại chế độ nhanh đến khi pass, và không đại diện mục tiêu <3s.

Mọi audio ở trên là TTS đã dùng trong development, không phải người gọi thật, test mù hay tập giọng mới.
[Các trial giao thức thất bại cũng được giữ](evaluations/voice-live-2026-11-11-protocol-trials.json):
frame binary, lifecycle, tool-only, TEXT modality và cách lấy JSON qua SDK. Không cộng các thử nghiệm
trên cùng câu thành nhiều bằng chứng độc lập; không công bố tỷ lệ đúng cao hơn từ những ca được chọn.

## Chạy thử trên máy hiện tại

`node --version` cần >=22. Backend tự đọc key trong `.env`; file này không bị sửa/đẩy lên Git.
Model defaults đã đổi trong code, nên `.env` không có override sẽ dùng ngay chuỗi 3.8.
Nếu từng đặt các biến model cũ, chúng vẫn được ưu tiên: kiểm tra `GEMINI_MODEL_VOICE`,
`GEMINI_MODEL_VOICE_LIVE_FALLBACK`, `GEMINI_MODEL_VOICE_FALLBACK`, `GEMINI_MODEL_VOICE_REVIEW`.
Review trống thì kế thừa primary, cùng chuỗi fallback. `.env.example` có giá trị đúng.

Chỉ mở dịch vụ nếu port chưa chạy, mỗi lệnh trong một terminal:

```bash
pnpm dev:voice-detector
pnpm dev:sandbox
pnpm build:extension
```

Reload unpacked extension trong `chrome://extensions`, mở Voice. Kiểm tra `/health` ở 8080 và 8081.
Với file, chọn **Phân tích kỹ file** để thử mode đã nhận kết quả qua UI. Fast mode có thể vẫn UNKNOWN;
không có cam kết rằng bật review sẽ làm model đúng hơn. Khi thấy model dự phòng, kết quả thuộc model đó.

File mẫu: `~/Library/Caches/ZeroLeak/voice-content-evaluation-v1/audio/dev_otp_request_clean.wav`.
Screenshot local: `test-results/voice-live-20261111/` và `test-results/voice-live-review-parity-20261111/`.
Báo cáo và script phát triển được giữ ngoài Git ở `~/Library/Caches/ZeroLeak/voice-live-20261111`.
Raw audio/voice embeddings không đưa vào Git.

CLI hiện dispatch đúng từng transport và đếm cả phiên WebSocket vào giới hạn call. Dry-run không gọi API:

```bash
pnpm --filter @zeroleak/sandbox-api exec tsx scripts/evaluate-voice.ts \
  --manifest "$HOME/Library/Caches/ZeroLeak/voice-content-evaluation-v1/cases.json" \
  --ids dev_otp_request_clean --mode review --max-calls 3 \
  --output /private/tmp/voice-live-check-new.json --dry-run
```

Bỏ `--dry-run` sẽ dùng quota Gemini. Output phải là file mới. Bộ này đã được xem kết quả;
chạy lại chỉ là hồi quy. Không dùng kết quả fixture 63/5/12 test làm accuracy AI.

## Giới hạn còn nguyên

Giọng clone có nhiễu vẫn là điểm yếu của V3; đổi model nội dung không chứng minh sửa được điều đó.
Fast mode chưa bảo đảm kết quả nội dung đúng trong deadline, dù một smoke adapter hoàn tất <3 giây.
Test 6 cần cuộc gọi giả giọng thực tế, chỉ số báo nhầm/bỏ sót và đo độ trễ độc lập, nên vẫn chưa nghiệm thu.

Tài liệu chính thức đã đối chiếu:
[Thinking in Live API](https://ai.google.dev/gemini-api/docs/live-api/thinking),
[Live API capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities),
[Extended Thinking model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live-extended-thinking),
[WebSocket reference](https://ai.google.dev/api/live).
