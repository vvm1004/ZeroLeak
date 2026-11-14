# Voice detector V2 — 2026-11-10

Hồ sơ kết quả V2 được giữ nguyên để đối chiếu. Worker mặc định hiện dùng
[V3](VOICE_DETECTOR_V3.md); các lệnh đo kết quả V2 cần khởi chạy riêng worker với head V2.

Đã tích hợp detector âm học local vào API và extension trên nhánh `feat/zeroleak-voice`.
Gemini tiếp tục phân tích lời thoại; detector local đánh giá tín hiệu giọng tổng hợp độc lập.
Đây là bản nghiên cứu chạy trên Mac M2 Pro 16 GB, chưa kiểm định cuộc gọi giả giọng ngoài thực tế.

## Kết quả đo được

Bộ mới có **448 ca từ 112 cặp bản ghi human/TTS**, mỗi cặp có bản clean và bản qua Opus.
208 ca train, 112 ca calibration và 128 ca test. Với VIVOS, 10 speaker ID ở train,
4 ở calibration, 5 ở test. FLEURS không có speaker ID, nên không công bố toàn bộ test là speaker-disjoint.
VieNeu Nano chỉ xuất hiện trong test; Piper VIVOS là giọng/model khác nhưng cùng họ Piper với phần train.

So sánh trên cùng 128 ca test, gồm 64 ca human và 64 ca synthetic:

- XLS-R cũ ở ngưỡng 0,5: bắt 42/64 ca synthetic; 22 ca bỏ sót; không báo nhầm 64 ca human.
- AASIST ở ngưỡng 0,5: bắt 63/64 ca synthetic nhưng báo nhầm 6/64 ca human.
- Lớp kết hợp mới ở ngưỡng chẩn đoán 0,5: bắt 63/64 ca synthetic, 1 ca bỏ sót, không báo nhầm human.
- **Chế độ thực tế thận trọng:** cảnh báo 58/64 ca synthetic, 6 ca synthetic UNKNOWN;
  human có 58 ca chưa thấy bằng chứng tổng hợp và 6 ca UNKNOWN, không có cảnh báo nhầm trong bộ này.
  Coverage là 116/128 = 90,6%; không diễn giải độ đúng trên phần được chấm thành accuracy 100% ngoài thực tế.

Lớp mới dùng 416 đặc trưng từ encoder XLS-R và AASIST đã đóng băng, chỉ học một bộ phân loại tuyến tính
nhỏ. Mean/scale chỉ tính từ train. Chọn regularization trong `{0.01, 0.1, 1}` bằng calibration;
các cấu hình bằng điểm nên chọn mức regularization mạnh nhất. Head đã được ghi/freeze trước khi đánh giá
test. Ngưỡng thấp/cao `0.2 / 0.8` đã định trước, không đổi theo kết quả test. Đây là vùng từ chối kết luận,
không phải khoảng tin cậy hay xác suất đã hiệu chuẩn.

Đã chạy lại script huấn luyện từ cache đặc trưng và tạo được file head **giống hệt từng byte**:
`f5cb4184c76c1ee33f695d35ac3f77f343a57a5c281d97cf6f353bceebae08e1`.

## Kiểm tra runtime

Đã gửi đủ 128 ca test qua HTTP detector thật, gồm kiểm tra speech bằng Silero VAD:

- Kết quả vẫn là 58 cảnh báo synthetic, 12 ca UNKNOWN tổng cộng, 0 lỗi HTTP và 0 human bị cảnh báo nhầm.
- Median round trip khoảng **481 ms**, max khoảng **1.934 ms** trong lượt benchmark local sau startup.
- Tone 220 Hz, tone 1.000 Hz và hai mức white noise đều trả UNKNOWN với `score: null`.
  Silence bị từ chối bằng HTTP 400. Đây là probe giới hạn, chưa bao phủ mọi loại nhạc/tiếng ồn.
- Detector nạp và warmup trước khi báo ready. Một lượt đầu trên worker mới vẫn mất khoảng 2,2 giây;
  timeout HTTP nội bộ là 2,8 giây. Chưa đo hiệu năng nhiều người dùng; worker chỉ xử lý một inference đồng thời.

API chạy local đã thử hai mẫu công khai qua Gemini và detector thật: cả hai trả HTTP 200,
`HYBRID_AUDIO`, khoảng 2,0–2,6 giây sau khi đủ audio. Một lần thử qua extension gặp timeout Gemini;
kết quả âm học vẫn hiển thị, nội dung giữ UNKNOWN. Không tính smoke test này vào accuracy.
Ứng dụng vẫn có deadline chung; chưa bảo đảm mục tiêu <3 giây trong mọi điều kiện.

20 test backend, 6 test Python, 3 test WAV/client và 8 Chrome E2E đã qua. Typecheck toàn workspace,
build extension/backend và typecheck CLI đều qua. Đã kiểm tra desktop/mobile với extension/API thật.
Fixture trong E2E kiểm tra luồng phần mềm, không dùng để đo chất lượng mô hình.

## Cách hoạt động

Audio PCM16 mono 16 kHz → hai nhánh chạy song song:

- Gemini: lời thoại, tactic, điểm rủi ro nội dung; không tự coi giọng AI là scam.
- Local: VAD → XLS-R + AASIST → head tuyến tính. Cần ít nhất 256 ms được VAD nhận là speech.
  Điểm >=0,8 là `SYNTHETIC_SUSPECTED`; <=0,2 là `NO_SYNTHETIC_EVIDENCE`; khoảng giữa là UNKNOWN.
  Không đủ speech thì UNKNOWN/null. Điểm thấp không xác minh giọng thật hoặc danh tính.

Kết quả API bổ sung `acousticAnalysis` và `assessmentSource`:

- `HYBRID_AUDIO`: có kết quả Gemini và âm học.
- `LOCAL_ACOUSTIC`: Gemini lỗi/quota/timeout, vẫn trả kết quả âm học; nội dung UNKNOWN/null.
- `GEMINI_AUDIO`: nhánh Gemini hoạt động; nếu detector local lỗi, `acousticAnalysis.status` là UNAVAILABLE.
  Khi chưa cấu hình detector local, client cũ vẫn nhận hợp đồng Gemini như trước.

Không ghi audio/transcript/embedding của phiên sử dụng vào storage hay log. Worker chỉ nhận JSON từ
numeric loopback, không chấp nhận Origin trình duyệt, không theo redirect tới máy chủ khác. API chính
giữ cơ chế origin/token đã có. Audio vẫn được gửi cho Gemini khi bật chức năng như disclosure trên UI.

## Chạy trên máy hiện tại

Đã bật `VOICE_ACOUSTIC_URL=http://127.0.0.1:8081` trong `.env` local; API key được giữ nguyên.
Model nằm ở `~/Library/Caches/ZeroLeak/voice`, benchmark/cache đặc trưng nằm ở
`~/Library/Caches/ZeroLeak/voice-evaluation-v2`, ngoài Git. Hai dịch vụ đang chạy local khi hoàn tất đợt này.

Nếu khởi động lại, dùng hai terminal ở gốc repo:

```bash
pnpm dev:voice-detector
pnpm dev:sandbox
```

Chờ dòng `ready: true` của detector rồi dùng extension. Bundle mới ở
`apps/extension/.output/chrome-mv3`; reload extension trong `chrome://extensions` để nhận UI mới.
Health: `http://127.0.0.1:8081/health` và `http://127.0.0.1:8080/health`.
Nếu dịch vụ vẫn đang chạy thì không mở thêm bản trùng port.

Trên máy mới, cài venv runtime và tải các asset cố định trước:

```bash
python3 -m venv "$HOME/Library/Caches/ZeroLeak/voice/venv"
"$HOME/Library/Caches/ZeroLeak/voice/venv/bin/python" -m pip install \
  -r apps/sandbox-api/scripts/requirements-voice-eval.txt
python3 apps/sandbox-api/scripts/prepare-voice-models.py \
  --cache "$HOME/Library/Caches/ZeroLeak/voice"
```

Đặt `VOICE_ACOUSTIC_URL` trong `.env`. Có thể đổi cache/interpreter bằng `VOICE_MODEL_CACHE` và
`VOICE_PYTHON`. Downloader kiểm revision/SHA256 cho encoder, source AASIST và VAD; tổng trọng số
chủ yếu là XLS-R khoảng 1,26 GB. Không cần GPU, torchaudio, Piper hoặc VieNeu để chạy detector.
Venv/data-generation tách riêng khỏi dependencies pnpm và runtime.

## Đánh giá và tái huấn luyện

Đo lại detector đang chạy, không gọi Gemini:

```bash
python3 apps/sandbox-api/scripts/evaluate-voice-runtime.py \
  --manifest "$HOME/Library/Caches/ZeroLeak/voice-evaluation-v2/dataset/cases.json" \
  --head apps/sandbox-api/models/voice-linear-v2.json \
  --output /private/tmp/voice-v2-runtime-new.json
```

Tái tạo head từ cache đã lưu, output phải là file mới:

```bash
"$HOME/Library/Caches/ZeroLeak/voice/venv/bin/python" apps/sandbox-api/scripts/train-voice-head.py \
  --manifest "$HOME/Library/Caches/ZeroLeak/voice-evaluation-v2/dataset/cases.json" \
  --cache "$HOME/Library/Caches/ZeroLeak/voice-evaluation-v2" \
  --head-output /private/tmp/voice-head-new.json \
  --report-output /private/tmp/voice-head-new-report.json
```

Nếu cache đặc trưng chưa có, thêm `--xlsr-assets` và `--aasist-assets` trỏ tới hai thư mục model.
Script kiểm checksum audio, origin/speaker đã biết không trùng split, dùng train/calibration để fit
và ghi head trước khi xuất kết quả test. `eval:voice` cũ vẫn dành riêng cho chẩn đoán Gemini;
dùng script HTTP mới để đo detector local.

Để tạo bộ dữ liệu mới: dùng một venv riêng với `requirements-voice-data.txt`, có `ffmpeg` và giọng macOS
Linh. `prepare-voice-v2.py --help` liệt kê đầu vào ba shard public và thư mục các generator đã tải.
URL/revision/checksum shard và generator nằm trong provenance bên dưới. Dùng thư mục output mới.
Piper có tính ngẫu nhiên nên waveform tái sinh có thể khác checksum: đó là bộ mới, cần fit/đánh giá lại;
không coi là bản sao chính xác của kết quả đã lưu. Raw audio và cache embedding không được commit.

## Giới hạn phải giữ khi trình bày

- 128 ca test là các bản clean/Opus của **32 cặp**, không phải 128 thử nghiệm độc lập.
  Không suy ra FPR ngoài thực tế bằng 0 từ việc chưa gặp cảnh báo nhầm trong bộ này.
- Human gender và FLEURS speaker ID chưa biết; không tuyên bố đã cân bằng giới tính/vùng miền.
- Đây là read speech/preset TTS. Chưa có cuộc gọi thật hoặc voice clone mạo danh người cụ thể;
  chưa có nhiễu nền đa dạng, replay/loa–micro, codec điện thoại hay kiểm định độc lập bên ngoài.
- Piper VIVOS 1.8 có warning thiếu một số phoneme; phát âm tổng hợp có thể kém và dễ bị nhận diện hơn.
  VieNeu Nano cũng là model preview. Cần thêm bộ sinh chất lượng cao trước khi suy rộng kết quả.
- VAD được thêm và kiểm tra trên cùng holdout sau khi head đã freeze; đây là kiểm tra pipeline,
  chưa phải một đợt đánh giá độc lập mới. Không tiếp tục chỉnh ngưỡng bằng bộ test này.
- Dữ liệu [VIVOS](https://huggingface.co/datasets/AILAB-VNUHCM/vivos) có CC-BY-NC-SA-4.0;
  [FLEURS](https://huggingface.co/datasets/google/fleurs) có CC-BY-4.0. Head hiện được đánh dấu
  experimental/noncommercial research trong metadata; chưa xác nhận phù hợp để phát hành thương mại.

Bằng chứng: [manifest](evaluations/voice-v2-manifest.json),
[provenance](evaluations/voice-v2-provenance.json),
[lựa chọn trên calibration](evaluations/voice-v2-selection.json),
[so sánh holdout](evaluations/voice-v2-holdout-2026-11-10.json),
[HTTP/VAD](evaluations/voice-v2-http-2026-11-10.json),
[smoke test API thật](evaluations/voice-v2-live-api-smoke.json).
