# Đánh giá ZeroLeak Voice — 2026-11-10

**Chưa đạt căn cứ để công bố khả năng phát hiện giọng giả đáng tin cậy.** Đã gọi API Gemini thật,
không dùng fixture E2E để tính chất lượng AI. Kết quả là screening để phát hiện vấn đề; chưa phải
benchmark độc lập, chưa kiểm chứng voice clone hiện đại hoặc cuộc gọi thực tế.

## Dữ liệu đã chạy

- 4 bản ghi tiếng Việt của [Google FLEURS](https://huggingface.co/datasets/google/fleurs),
  cấu hình `vi_vn`, split `validation`, CC-BY-4.0. Không biết danh tính người nói nên không gọi là 4 speaker độc lập.
- 4 bản TTS bằng giọng macOS Linh đọc cùng toàn văn với 4 bản ghi trên. Mỗi bản có phiên bản
  clean và qua Opus 24 kbps: tổng cộng 16 ca theo cặp, thuộc 4 nhóm văn bản gốc.
- 2 mẫu tiếng Việt từ [Piper chính chủ](https://rhasspy.github.io/piper-samples/), khác bộ sinh,
  có nguồn/model card trong manifest. Đây là probe bổ sung, chưa cân bằng với giọng thật cùng nguồn.
- 4 tình huống TTS cục bộ: giả công an đòi OTP, giả sếp đòi chuyển tiền, khuyên không chia sẻ OTP,
  và thông báo lịch họp. Các tình huống này kiểm tra hiểu nội dung riêng với kiểm tra giọng tổng hợp.

Tổng cộng **22 ca: 8 human và 14 synthetic**, gồm các bản biến đổi cùng nguồn. Có 9 nhóm nguồn/văn bản,
không phải 22 quan sát độc lập. Mọi ca là `screening`; chưa dùng bộ này để chọn threshold hay báo kết quả test cuối.
Chỉ 0,5–5 giây đầu của mỗi bản được chuẩn hóa thành WAV PCM16 mono 16 kHz như production.

Nguồn human đang chọn có nhãn giới tính nam; chưa cân bằng giới tính/vùng miền. TTS theo cặp chỉ có
một giọng mặc định. Các cửa sổ 5 giây của người thật/TTS không khớp từng từ theo thời gian, dù toàn văn
giống nhau. Không có mẫu voice clone mới. Vì thế không suy rộng kết quả ra người dùng thực tế.

## Kết quả quan sát

Baseline `gemini-2.5-flash-lite`, cùng prompt/schema/parser với ứng dụng, deadline chẩn đoán 20 giây:

- 19/22 ca trả kết quả hợp lệ; 3/22 lỗi quota HTTP 429.
- Chỉ **1/22 ca có điểm giọng tổng hợp**, coverage 4,5%. 18 kết quả hợp lệ còn lại để điểm `null`.
- Riêng 16 ca theo cặp human/TTS, cả clean và Opus: **0/16 có điểm giọng tổng hợp**.
- Ca có điểm 0,9 là câu **“Không cung cấp mã OTP cho bất kỳ ai.”** Model đồng thời cảnh báo lừa đảo
  nhầm ở câu này. Nhãn TTS của ca đó là thật, nhưng một điểm trùng nhãn không chứng minh model đã dựa
  vào đặc trưng âm học. Không thể công bố accuracy 100% từ đúng một ca được chấm điểm.
- Kiểm tra nội dung: thông báo lịch họp được đánh giá không có tactic; câu khuyên giữ kín OTP bị báo
  có tactic. Hai câu lừa đảo chưa có kết quả vì quota, nên **chưa đo được khả năng bắt scam**.
- Thời gian toàn bộ lượt thử: median 2.964 ms, p95 5.245 ms, max 6.969 ms, gồm cả lỗi quota.
  Đây là thời gian phân tích sau khi có audio, dưới deadline chẩn đoán 20 giây; không chứng minh SLA realtime.

Probe `gemini-3.5-flash-lite` trên 4 ca theo cặp clean: 3 kết quả hợp lệ đều không có điểm giọng tổng hợp,
1 lỗi HTTP 503. Mẫu này quá nhỏ và điều kiện dịch vụ khác thời điểm; không xếp hạng hai model từ đây.

Đo riêng router dev thực tế (3.5 Flash-Lite → 2.5 Flash-Lite, ngân sách chung 3.100 ms):
3 ca liên tiếp lỗi provider, 6 provider calls, dừng theo giới hạn lỗi; ca thứ tư **chưa chạy**.
Thời gian 2.663–2.727 ms là thời gian nhận lỗi, không phải thời gian phát hiện thành công.
Không tiếp tục gọi lại model đang hết quota để tránh tiêu tốn vô ích.

Tổng 32 provider calls trong đợt đánh giá này; không gộp các lần chạy model/mode khác nhau thành một accuracy.
Điểm 0,5 chỉ là ngưỡng chẩn đoán định trước, không phải threshold đã tối ưu. `null`, lỗi và UNKNOWN
không được tính là dự đoán đúng. Chỉ số content dựa vào `detectedTactics`, không suy ra từ enum `DEEPFAKE_SCAM`.

## Thay đổi code từ đợt đánh giá

- Sửa parser: nội dung UNKNOWN không còn xóa điểm âm học độc lập khi audio vẫn dùng được.
  Audio UNUSABLE vẫn xóa cả hai kênh. Có test hồi quy.
- Dùng chung hàm tạo request giữa production và evaluation, không gửi tên file/nhãn đáp án cho Gemini.
- Có CLI kiểm SHA256/định dạng input, giới hạn số API calls, dừng sau 3 lỗi liên tiếp,
  lưu từng ca không chứa audio/transcript/key, tách coverage, confusion counts, lỗi và thời gian.
- 12 test backend qua; typecheck/build backend và typecheck riêng CLI qua. Dry-run xác thực đủ 22 ca,
  không gọi API. Chạy lại preparer với đường dẫn provenance tương đối tạo 20/20 ca có checksum trùng
  baseline (không gồm Piper); công cụ macOS `say` cần chạy ngoài sandbox hạn chế quyền hệ thống.
  Test phần mềm không thay thế kiểm định model.

Chưa sửa prompt theo đúng một câu bị báo nhầm và chưa ép model trả một con số khi thiếu bằng chứng.
Làm vậy rồi chạy lại cùng ca chỉ cho kết quả phát triển, không chứng minh cải thiện trên dữ liệu mới.

## Chạy lại

Các file dữ liệu hiện ở `/private/tmp/zeroleak-voice-eval/dataset/`; đây là thư mục tạm ngoài Git.
Kết quả và provenance không chứa audio được lưu bền trong repo:
[manifest](evaluations/voice-screening-v1-manifest.json),
[toàn bộ các lượt và chỉ số](evaluations/voice-screening-2026-11-10.json).
Manifest có SHA256, nguồn, row ID và revision của các bản ghi đã dùng. Raw audio không được commit.

Tạo bộ mới trên macOS có `ffmpeg` và giọng Linh đã cài:

```bash
curl --fail --location 'https://datasets-server.huggingface.co/first-rows?dataset=google%2Ffleurs&config=vi_vn&split=validation' \
  --output /private/tmp/zeroleak-fleurs-vi.json
python3 apps/sandbox-api/scripts/prepare-public-voice.py \
  --metadata /private/tmp/zeroleak-fleurs-vi.json \
  --output /private/tmp/zeroleak-voice-new-dataset
```

Mặc định tạo 20 ca, chưa gồm 2 mẫu Piper. Metadata công khai có thể thay đổi/hết hạn URL;
so sánh checksum với manifest đã lưu trước khi tuyên bố tái lập đúng bộ cũ. Lựa chọn `--sources`
nhận mảng nguồn human gồm `path`, `transcript_path`, `sha256`, `source`, `license`.
`--piper-samples` nhận mảng nguồn gồm `local`, `sha256`, `url`, `model_card`.
Đường dẫn nguồn phải nằm dưới thư mục chứa provenance JSON; giữ quy định sử dụng của từng nguồn/model card.

Kiểm tra offline, không gọi API:

```bash
pnpm --filter @zeroleak/sandbox-api eval:voice \
  --manifest /private/tmp/zeroleak-voice-new-dataset/cases.json \
  --output /private/tmp/voice-dry-run.json --dry-run
```

Đánh giá API thật có sử dụng quota, đọc key từ `.env` gốc. Dùng đường dẫn output mới cho mỗi lần chạy:

```bash
pnpm --filter @zeroleak/sandbox-api eval:voice \
  --manifest /private/tmp/zeroleak-voice-new-dataset/cases.json \
  --output /private/tmp/voice-quality-new.json \
  --mode quality --model gemini-3.5-flash-lite \
  --limit 4 --max-calls 4 --interval-ms 10000

pnpm --filter @zeroleak/sandbox-api eval:voice \
  --manifest /private/tmp/zeroleak-voice-new-dataset/cases.json \
  --output /private/tmp/voice-realtime-new.json \
  --mode realtime --limit 4 --max-calls 8 --interval-ms 10000
```

Chế độ `quality` cho tối đa 20 giây để tách hạn chế chất lượng khỏi timeout; không đổi timeout production.
Chế độ `realtime` dùng đúng router ứng dụng. Chỉ đọc output/score của bộ dữ liệu được phép dùng;
không đưa bản ghi cá nhân vào một lần đánh giá cloud khi chưa có phép.

## Điều cần giải quyết trước khi công bố chất lượng

Với thiết kế hiện tại, Gemini chưa chứng minh được kênh phát hiện giọng tổng hợp độc lập với nội dung.
Cần đánh giá một detector âm học chuyên dụng như một phương án riêng trước khi quyết định thay kiến trúc;
giữ Gemini cho phân tích kịch bản nếu kiểm thử nội dung tiếp theo đạt yêu cầu. Chưa tích hợp model mới trong đợt này.

Bộ đánh giá tiếp theo cần các speaker/generator chưa dùng khi phát triển, TTS/voice clone hiện đại,
human nói cùng nội dung lừa đảo, giọng AI nói nội dung vô hại, các vùng miền và audio qua codec/tiếng ồn.
Chia dev/test theo speaker và bản ghi gốc trước khi chọn threshold; mọi bản biến đổi của cùng nguồn ở cùng split.
Báo coverage và tỷ lệ lỗi cùng FPR/FNR, không chỉ accuracy trên ca có điểm.
[VSASV tiếng Việt](https://huggingface.co/datasets/hustep-lab/VSASV-Dataset) là nguồn cần xem tiếp,
nhưng hiện yêu cầu đăng nhập/chấp thuận điều kiện và có CC-BY-NC; chưa truy cập hay dùng dữ liệu đó trong kết quả trên.
