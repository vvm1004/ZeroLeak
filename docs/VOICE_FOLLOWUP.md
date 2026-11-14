# Voice: backoff, readiness và kiểm thử theo nhịp live — 2026-11-11

**Cập nhật model:** [Gemini 3.8 Live Extended Thinking](VOICE_LIVE_API.md).
Các phép đo/luồng Flash bên dưới được giữ làm lịch sử; head âm học V3 không thay đổi.

Bản tiếp theo của [sửa độ ổn định](VOICE_RELIABILITY.md). Đã thêm backoff provider, sửa health
worker và công cụ đánh giá. **Không thay head V3; chưa có bằng chứng accuracy detector tăng.**
Sáu cấu hình head thử bị loại trên calibration. Ứng viên đổi luồng suy luận cũng không được giữ.

## Thay đổi đã giữ trong code

- **Backoff riêng từng model Gemini:** sau ba lỗi tạm thời liên tiếp (HTTP 429, 5xx hoặc deadline
  do chính analyzer hết hạn), nghỉ model đó 30 giây. Fallback khỏe vẫn có thể dùng trong deadline
  chung. Sau thời gian nghỉ chỉ một request thử phục hồi; thành công xóa trạng thái, thất bại mở
  lại thời gian nghỉ. Hủy từ người dùng/route không tính là provider lỗi; JSON sai và 4xx thông
  thường không mở cooldown quá tải. State nằm trong RAM từng process, không lưu audio/key;
  restart xóa state. Đây không sửa quota/503 bên Google và không đảm bảo mọi request có nội dung.
- **Readiness worker đúng khi suy luận lỗi:** lỗi engine bất ngờ trả HTTP 503 và làm `/health`
  báo `ready: false`; suy luận tiếp theo thành công phục hồi health. Input sai không giả thành lỗi
  engine. Không trả lỗi nguyên văn có thông tin nội bộ.
- **Đánh giá runtime phân biệt lỗi:** mỗi ca có `httpStatus` và `errorCode` (BUSY, TIMEOUT,
  UNAVAILABLE...). Báo thêm độ trễ chỉ trên request hoàn tất; số lỗi vẫn ở mẫu số. Median của toàn
  lượt vẫn giữ cho tương thích nhưng không được gọi là tốc độ suy luận khi nhiều request bị từ chối.
  `--interval-ms 5000` gửi theo nhịp cửa sổ live; mặc định 0 giữ chế độ tải tuần tự cũ.

Khi Gemini bị nghỉ/lỗi, coordinator vẫn giữ local và nội dung UNKNOWN, không tạo SAFE.
Không tăng deadline, đổi ngưỡng 0,2/0,8, thay encoder, key, `.env`, lockfile hoặc hợp đồng API.

## Kiểm thử phần mềm

45 test backend, 13 test Python, 4 test client/audio và 11 Chrome E2E đều qua: **73 test**.
Sáu ca backend mới kiểm tra backoff/probe, fallback, hủy, deadline và local khi provider nghỉ.
Test Python HTTP dùng engine fixture xác minh readiness lỗi/phục hồi, không phải đánh giá model AI.
Backend build, typecheck CLI đánh giá và kiểm tra cú pháp Python đều qua.
[CLI fixture](evaluations/voice-followup-2026-11-11-evaluator-fixture.json) kiểm tra riêng BUSY,
503, kết quả sai và thành công; không đưa fixture này vào số liệu accuracy AI.
[Bản xác minh](evaluations/voice-followup-2026-11-11-verification.json) lưu scope của từng phép thử.

## Runtime theo nhịp thu âm

[Protocol chốt trước lượt paced](evaluations/voice-followup-2026-11-11-paced-protocol.json):
chọn origin đầu/cuối theo thứ tự từ nhóm `v4-fresh` đã biết, lấy đủ hai lớp và ba kênh.
12 ca từ hai cặp gốc, gửi cách nhau 5 giây, deadline từng ca vẫn 2,8 giây.

[Kết quả](evaluations/voice-followup-2026-11-11-paced-runtime.json): **12/12 request hoàn tất**,
0 BUSY/timeout; median 634 ms, max 805 ms. Có 3/6 synthetic được cảnh báo, 3 UNKNOWN;
human không bị cảnh báo nhầm nhưng có 1 UNKNOWN. Không coi 12 request là 12 speaker độc lập,
không dùng kết quả này để công bố accuracy hoặc kiểm định cuộc gọi vật lý.

Lượt API thật cuối với file lịch họp có nội dung bình thường trả SAFE/0 và local có dấu hiệu tổng hợp,
nguồn HYBRID_AUDIO, 2.044 ms round trip. Hai kết quả không mâu thuẫn: một giọng TTS có thể nói
nội dung bình thường. Xem [API smoke cuối](evaluations/voice-followup-2026-11-11-api-after-worker.json).

[Lượt API trước đó](evaluations/voice-followup-2026-11-11-api-smoke.json) vẫn được giữ: câu lịch họp
realtime gặp HTTP 504, câu OTP review trả SUSPICIOUS/95 với cả hai nhánh trong 2.148 ms.
Không xóa lượt timeout, không gọi lại đến khi đạt. Lượt cuối sau thay đổi runtime là smoke hồi quy,
không chứng minh khả dụng hoặc accuracy tổng thể tốt hơn. Tổng upper bound của các smoke này là
5 call provider; có fallback nên không suy số call chỉ từ số HTTP request.

## Kết quả thử nghiệm bị loại

**Head cân bằng nhóm:** [protocol](evaluations/voice-followup-2026-11-11-policy.json) quy định
uniform và cân bằng label/family/condition, mỗi cách thử regularization 0,001 / 0,01 / 0,1.
Chỉ học trên 568 train và chọn bằng 256 calibration; không hạ ngưỡng hoặc xem test mới.
Điều kiện thử này nghiêm hơn V3: cần 0 human false alert và không tăng synthetic điểm thấp.

[Kết quả](evaluations/voice-followup-2026-11-11-selection.json): uniform có 16/8/3 false alert
trên 128 human; cân bằng nhóm có 19/16/6. V3 đối chứng trên cùng calibration có 3.
Cách cân bằng bắt thêm synthetic nhưng tăng báo nhầm; không ứng viên nào đạt điều kiện.
Không đổi tiêu chí sau để cứu ứng viên. Không có dự đoán test mới trong đợt này.

**Luồng suy luận cố định:** đã thử load/warmup/inference qua một executor và có probe idle hợp lệ,
nhưng kiểm thử deadline dồn dập không đạt. Đã bỏ mã ứng viên, giữ kiến trúc worker trước đó;
chỉ giữ bản vá health nhỏ. Các báo cáo đầy đủ:

- [Ứng viên khi hai worker cùng tồn tại](evaluations/voice-followup-2026-11-11-executor-regression.json):
  14/90 request hoàn tất, 76 lỗi/không nhận việc.
- [Ứng viên với một worker](evaluations/voice-followup-2026-11-11-single-worker-regression.json):
  63/90 hoàn tất, 27 lỗi/không nhận việc.
- [Đối chứng kiến trúc cũ với một worker](evaluations/voice-followup-2026-11-11-retained-worker-regression.json):
  3/90 hoàn tất, 87 lỗi/không nhận việc trong lượt tải tuần tự này.

Một request quá hạn không hủy tức thì tính toán Torch đã bắt đầu; các request gửi ngay sau đó có
thể nhận BUSY. Các lượt tải cũ chưa có trường phân loại HTTP riêng, không suy mọi ERROR là lỗi model.
Không dùng median rất thấp của phản hồi BUSY làm latency suy luận. Không quy toàn bộ lỗi cho RAM
hoặc khác biệt thread; điều kiện máy không phải benchmark cô lập. Lượt paced ở trên kiểm tra nhịp
khác, không phải phép chứng minh đã sửa hết khả năng chịu tải. Chưa đạt tiêu chí phục vụ tải dồn dập.

Head đang dùng vẫn là
`e6206d556dddca31b396dfc7d0f58c1af204dee502e11a98ec7e4dadc12a9f0f`.
V3 còn yếu với clone có nhiễu, chưa hiệu chuẩn xác suất và chưa nghiệm thu Test 6.

## Chạy kiểm tra

API ở 8080 và worker ở 8081. Kiểm tra `/health` trước, tránh mở trùng worker. Nếu chưa chạy:

```bash
pnpm dev:voice-detector
pnpm dev:sandbox
```

Mỗi lệnh trong một terminal riêng. Bộ 12 ca paced, script thử và protocol được giữ ngoài Git ở
`~/Library/Caches/ZeroLeak/voice-next-20261111`. Chạy lại chỉ là hồi quy đã biết, không là holdout mới:

```bash
python3 -B apps/sandbox-api/scripts/evaluate-voice-runtime.py \
  --manifest "$HOME/Library/Caches/ZeroLeak/voice-next-20261111/paced-dataset/cases.json" \
  --cohort v4-fresh --interval-ms 5000 --output /private/tmp/voice-paced-next.json
```

Output phải là file mới. File/metadata kiểm thử chứa audio public/TTS được phép dùng; raw audio,
reference và embeddings không đưa vào Git. Không commit/push trong đợt này.
