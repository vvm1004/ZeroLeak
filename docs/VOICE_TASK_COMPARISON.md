# Voice theo task và bản hybrid — cập nhật 12/11/2026

Đã triển khai **Gemini đánh giá cả nội dung và dấu hiệu giọng tổng hợp**, bám phần 2.4 trong TASK gốc.
Mặc định mới là `VOICE_ANALYSIS_STRATEGY=gemini`. Bản hybrid ở commit `41354a7` được giữ dưới
cấu hình `hybrid` để đối chiếu. Không xóa V3, không sửa `.env`, không thay trọng số/ngưỡng hoặc thêm dependency.

**Kết quả chính:** trên bộ nhỏ đã cố định, hybrid phát hiện được nhiều clip tổng hợp hơn. Gemini-only
đơn giản hơn để bàn giao đúng blueprint, nhưng chưa đủ bằng chứng để thay V3 cho mục tiêu phát hiện voice clone.
Nội dung lừa đảo có 5/6 kết luận đúng ở cả hai bản; một ca của mỗi bản chưa đánh giá được.

## Phạm vi task và cách thực hiện

TASK tại commit gốc `e948d4b` yêu cầu endpoint audio, `voice-analyzer.ts` gọi Gemini trả
`riskScore`, `syntheticVoiceProbability`, `detectedTactics`, `warningMessageVi` và UI thu âm/cảnh báo.
PLAN và code mẫu trong `.agents/rules/AGENTS.md` kỳ vọng Gemini nhận diện cả giọng nhân tạo và scam.
FFT/thu âm vẫn cục bộ. Python/XLS-R/AASIST là phần mở rộng của bản hybrid, không phải điều kiện task gốc.

Bản mới giữ các chức năng thu micro/tab, Web Audio waveform, chọn file, màu cảnh báo, kiểm tra đầu vào,
quote, redaction, cancel và model provenance. Server nhận WAV PCM16 mono 16 kHz 0,5–5 giây;
Extension giải mã WebM/MP3 trước khi gửi. File vẫn chỉ lấy tối đa 5 giây đầu.

`voice-service.ts` chọn một trong hai luồng ở server, không để request tự chọn prompt/model tùy ý:

- `gemini` (mặc định): Gemini Extended → Live → Flash-Lite, đánh giá cả hai mục tiêu. Không gọi worker
  local kể cả `VOICE_ACOUSTIC_URL` đã được cấu hình. Kết quả không có `acousticAnalysis`.
- `hybrid`: Gemini chỉ phân tích nội dung; V3 local phân tích giọng tổng hợp song song. Khi Gemini lỗi,
  vẫn có thể giữ kết quả local. Khi local lỗi, vẫn có thể giữ nội dung Gemini.

Extended dùng Live WebSocket, AUDIO + output transcription và Thinking LOW; JSON gọn thêm trường `p`
vào `a,v,r,q,f`. `p` được giải mã thành `syntheticVoiceProbability`. Standard Live và Flash fallback
cũng được yêu cầu trả trường này trong chế độ task. Giữ schema công khai cũ nên không cần sửa client/UI.
Các trường nội dung vẫn từ model; lời cảnh báo tiếng Việt được chuẩn hóa tại backend theo kết quả.

`p` là **ước lượng do model tự báo, chưa hiệu chuẩn**, không phải xác suất pháp y. Cho phép null khi
không đủ bằng chứng; không ép model bịa số để thỏa kiểu dữ liệu. Đây là cách xử lý thiếu bằng chứng
được giữ từ API hiện có, cần trình bày rõ khi nghiệm thu với đội. Không suy giọng giả từ việc đòi OTP,
không suy giọng thật từ lời nói bình thường. Giọng tổng hợp có thể có nội dung lành tính, người thật
có thể nói lời lừa đảo. UNKNOWN nội dung không tự xóa điểm âm học hợp lệ; audio không dùng được thì p=null.

## Cách so sánh, cố định trước dự đoán

Dữ liệu và tiêu chí: [protocol](evaluations/voice-task-2026-11-11-protocol.json).
Source/config được [đóng băng](evaluations/voice-task-2026-11-11-candidate-frozen.json) trước comparison.
[Development](evaluations/voice-task-2026-11-11-development.json) có bốn phiên, tách khỏi comparison;
không sửa candidate sau khi xem kết quả comparison.

- **12 clip âm học:** hai bản ghi gốc thuộc hai speaker VIVOS test, mỗi bản có human/voice clone
  VieNeu-Turbo và ba điều kiện clean, phone8k, room_noise15db. Chọn bằng seed 41111 trước dự đoán,
  không chọn theo điểm. Mỗi lớp có 6 clip; không coi đây là 12 người/nguồn độc lập.
- **6 clip nội dung:** ba scam, ba benign/khuyên bảo/kể lại, giọng TTS macOS Linh. Đây là sáu câu
  đã dùng ở lần trước, nên là hồi quy, không phải test mù mới. Các clip VIVOS không có nhãn scam;
  không tự gán nhãn nội dung cho chúng.
- Hai bản nhận đúng cùng WAV/SHA, cùng `gemini-3.8-live-extended-thinking`, Thinking LOW,
  phiên riêng từng clip, không fallback, không retry. Đổi thứ tự bản chạy trước/sau theo ca;
  cách thời điểm bắt đầu tối thiểu 6 giây. Không gửi nhãn/ID/file lên model.
- **18 ca review × 2 bản = 36 phiên**, budget 15.000 ms. Thêm hai câu nội dung lặp lại ở realtime
  **× 2 bản = 4 phiên**, budget 3.100 ms. Tổng comparison **40 phiên**, không bỏ lượt nào.
- V3 chạy qua HTTP loopback thật, pin head `e6206d55…c12a9f0f`. Ngưỡng đối chiếu cho cả hai loại điểm:
  >=0,8 cảnh báo tổng hợp; <=0,2 chưa thấy bằng chứng; khoảng giữa/null là UNKNOWN. Không chọn lại ngưỡng.
- Chỉ đo kết luận nội dung trên sáu ca có nhãn. Lỗi/UNKNOWN nằm trong mẫu số. Thời gian gồm cả các
  lượt lỗi, hai mode tách riêng. Đây không phải phép đo có ý nghĩa thống kê hoặc kiểm định triển khai thực tế.

## Kết quả giọng tổng hợp trên 12 clip theo cặp

Bằng chứng: [từng lượt](evaluations/voice-task-2026-11-11-comparison.json),
[tổng hợp và từng điều kiện](evaluations/voice-task-2026-11-11-summary.json).

**Hybrid/V3:**

- 6 human: 0 cảnh báo nhầm; cả 6 điểm thấp.
- 6 clone: **4 cảnh báo**, 2 UNKNOWN, 0 clone điểm thấp.
- Bắt cả hai clone clean và cả hai clone phone8k; hai clone nhiễu đều UNKNOWN.
- Có quyết định ở 10/12 clip. Không dùng UNKNOWN như một quyết định đúng.

**Gemini-only theo task:**

- 6 human: 0 cảnh báo nhầm; 1 điểm thấp, **5 UNKNOWN**.
- 6 clone: **0 cảnh báo**, **4 UNKNOWN**, **2 điểm thấp**.
- Hai clone điểm thấp là `VIVOSDEV02_1` phone8k (0,05) và room_noise15db (0,10).
- Có quyết định ở 3/12 clip. Việc không báo nhầm human khi phần lớn là UNKNOWN không chứng minh
  detector tốt. Điểm thấp ở hai clone cho thấy không được dùng p để xác minh người gọi là thật.

Trong cấu hình và tập này, hybrid có bằng chứng tốt hơn về phát hiện giọng tổng hợp. Kết quả không chứng minh
Gemini không bao giờ phát hiện được deepfake; cũng không chứng minh V3 đáng tin cậy ngoài thực tế.
V3 đã được phát triển với dữ liệu cùng họ generator; hai bản ghi gốc lặp qua nhiều điều kiện và tập
được xem ở các lượt trước, nên không phải đánh giá bên ngoài độc lập.

## Kết quả nội dung và độ trễ

Sáu ca review, **mỗi bản đều 3/3 scam cảnh báo, 2/3 benign đúng, một ca chưa đánh giá được**:

- Hybrid: `fresh_design_deadline` lỗi `INVALID_RESULT`; vẫn giữ được nhánh local.
- Gemini-only: `fresh_refused_quote` trả `UNKNOWN` ngữ nghĩa, không phải lỗi provider/JSON.
- Không gặp false alert hoặc confident miss trong sáu ca này; không đổi UNKNOWN thành đúng.

Hai câu lặp realtime (`fresh_password_unlock`, `fresh_code_advice`) đều đúng nội dung ở cả hai bản,
không timeout trong lượt này. Chỉ hai ca không đủ nghiệm thu Test 6; các timeout ở lần trước vẫn có giá trị.

Median round-trip trên **mọi ca review**: hybrid **2.836 ms**, task **2.713 ms**.
Max tương ứng **3.709 ms** và **6.651 ms**. Riêng hai ca realtime, median hybrid **2.953,5 ms**,
task **2.623 ms**. Không khẳng định task nhanh hơn một cách ổn định từ một lượt nhỏ; đuôi chậm của
task vẫn cao và số đo chưa bao gồm thu cửa sổ audio 5 giây. Review không đại diện cam kết <3 giây.

## Kiểm tra tích hợp và Chrome thật

**79 test backend + 5 client + 13 Chrome E2E fixture đều qua**, build backend và TypeScript backend/CLI qua.
Regression kiểm tra default route không gọi local dù có URL, chuyển hybrid, p độc lập với scam,
missing/invalid p, audio không rõ, IDLE, quote và cả fallback Standard Live/Flash.

[Hai ca Chrome với API thật](evaluations/voice-task-2026-11-11-browser.json):

- OTP review: HTTP 200, DEEPFAKE_SCAM/95, tactic OTP, p=null, **3.404 ms**.
- Advice realtime: HTTP 200, SAFE/0, không tactic, p=0, **2.429 ms**.
- Cả hai dùng đúng Extended qua LIVE_API, không fallback, source GEMINI_AUDIO, không có kết quả local;
  UI hiển thị đúng model và trường ước lượng. **Cả hai file là TTS**: p=0 ở ca advice là một kết quả
  âm học điểm thấp trên âm thanh tổng hợp, không phải xác nhận giọng thật. Nội dung đúng không đồng
  nghĩa nhánh phát hiện giọng giả đúng. Không chạy lại để chọn kết quả khác.

Tổng 46 phiên provider (4 dev + 40 comparison + 2 Chrome), dưới cap 54. Không dùng mic thật.
[Verification](evaluations/voice-task-2026-11-11-verification.json) xác nhận source production khớp
candidate đóng băng và V3 không thay đổi. Test fixture là kiểm tra phần mềm, không đo accuracy AI.
Screenshot local ở `test-results/voice-task-20261111/`.

## Chọn bản nào

**Để bàn giao đúng phần đồng đội giao:** dùng `gemini`, hiện đã là mặc định. Một backend Node,
không cần Python/model assets/worker 8081. Gemini trả cả hai đầu ra, nhưng p có thể null và chưa chứng
minh khả năng phát hiện clone. Không trình bày trường dữ liệu có mặt như bằng chứng detector đã tốt.

**Nếu tiêu chí quan trọng là phát hiện giọng tổng hợp có tác dụng trong bản hiện tại:** giữ `hybrid`
như phần bổ trợ. Lượt đo cho thấy 4/6 clone được cảnh báo so với 0/6 của Gemini-only. V3 cũng còn bỏ
qua clone nhiễu, tốn thêm model assets, RAM/CPU và một dịch vụ. Khi provider lỗi, ưu điểm của hybrid
là vẫn có thể có bằng chứng local; Gemini-only sẽ trả lỗi nếu không model cloud nào hoàn tất.

Khuyến nghị cho đội: bàn giao Gemini theo task và số liệu này trước; chỉ nhận thêm phần hybrid vào
phạm vi chính khi đội đồng ý kiến trúc và có thời gian kiểm định. Không tiếp tục huấn luyện V3 chỉ
để có thêm điểm demo trong khi Test 6 và dữ liệu cuộc gọi thực còn chưa nghiệm thu.

## Chạy và chuyển cấu hình

Giữ `.env` hiện có. Mỗi lần chỉ mở một API 8080; dừng API cũ trước khi chạy lệnh thay thế.
Gemini theo task, không cần bật detector:

```bash
cd /Users/quangkimle/Documents/code/ZeroLeak
VOICE_ANALYSIS_STRATEGY=gemini pnpm dev:sandbox
```

Hybrid, hai terminal:

```bash
pnpm dev:voice-detector
```

```bash
VOICE_ANALYSIS_STRATEGY=hybrid VOICE_ACOUSTIC_URL=http://127.0.0.1:8081 pnpm dev:sandbox
```

`/health` ở 8080 có `voice.analysisStrategy`. `localAcousticConfigured:true` chỉ nói URL có cấu hình;
ở strategy gemini URL đó không được gọi. Model override trong `.env` vẫn được ưu tiên; xem model thực
và fallback trên UI. Hai Live model gọi WebSocket; Flash gọi generateContent trong cùng ngân sách.
Nếu không cấu hình strategy, mặc định gemini. Biến môi trường ghi sai giá trị bị từ chối.

Extension hiện có đã hỗ trợ trường p, không cần rebuild lần này. Reload trang Voice; bật
**Phân tích kỹ file** để thử review. Khi Gemini p=null, UI hiện **Chưa đủ bằng chứng**. Các mức % là
ước lượng mô hình, không phải xác minh danh tính. Trong hybrid, xem phần **Kiểm tra tín hiệu giọng nói**.

Dry-run không gọi API:

```bash
pnpm --filter @zeroleak/sandbox-api exec tsx scripts/evaluate-voice.ts \
  --manifest "$HOME/Library/Caches/ZeroLeak/voice-extended-20261111/fresh/cases.json" \
  --strategy gemini --model gemini-3.8-live-extended-thinking --mode review \
  --limit 6 --max-calls 6 --threshold 0.8 \
  --output /private/tmp/voice-task-check-new.json --dry-run
```

Bỏ `--dry-run` sẽ dùng quota. Output phải mới. CLI cũng hỗ trợ `--strategy hybrid` để chạy worker
thật và lấy `syntheticScore` từ V3; phải cấu hình `VOICE_ACOUSTIC_URL`. Quality mode chỉ dành cho
Gemini đơn model, không dùng làm benchmark deadline production. Các số tổng hợp CLI tại một ngưỡng
chẩn đoán không thay cho báo cáo ba vùng >=0,8 / <=0,2 / UNKNOWN ở comparison này.

Nguồn baseline/candidate, runner và protocol gốc được giữ ngoài Git tại
`~/Library/Caches/ZeroLeak/voice-task-20261111/`. Không đưa raw audio, voice embeddings, API key hoặc
raw provider text vào Git. Bộ kiểm thử này chỉ dùng dữ liệu công khai/TTS được phép, không thu mic thật.

**Test 6 dưới 3 giây cho cuộc gọi thực tế vẫn chưa nghiệm thu.**
