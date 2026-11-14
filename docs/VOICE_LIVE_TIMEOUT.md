# Voice: sửa timeout tab/micro — 12/11/2026

**Tab/micro giữ đoạn âm thanh 5 giây, nhưng Gemini được chờ tối đa 8 giây xử lý.**
Trước đó file được chờ 15 giây, còn tab/micro bị cắt khoảng 3,1 giây. Với triệu chứng sóng âm chạy
rồi TIMEOUT, giới hạn này có thể hủy một lượt phân tích chưa kịp hoàn tất.

## Thay đổi

Giới hạn được khai báo chung trong `VOICE_ANALYSIS_TIMEOUTS` ở shared-types để tránh browser/server
lệch nhau: realtime Gemini 8.000 ms, route 8.300 ms, client 9.000 ms. File review giữ 15.000/15.300/16.000 ms.
`/health` công khai các giới hạn này, không có key. UI báo đang chờ tối đa 8 giây.
Không đổi model, prompt, ngưỡng hoặc thời lượng audio; Extended-only không gọi local/fallback.
Chế độ hybrid cũ vẫn có collection deadline riêng 3,1 giây, không thuộc luồng đang dùng.

Đây là tăng thời gian cho phép nhận kết quả, không phải làm model nhanh hơn. Phải cộng 5 giây thu
vào thời gian xử lý. Test 6 dưới 3 giây chưa đạt. Client vẫn chỉ có một request đang chạy và một
cửa sổ chờ mới nhất; không cam kết mọi đoạn của cuộc gọi dài đều được phân tích khi dịch vụ chậm.

## Tái hiện và hồi quy bằng Google thật

[Protocol cố định](evaluations/voice-live-timeout-2026-11-12-protocol.json),
[manifest audio](evaluations/voice-live-timeout-2026-11-12-cases.json),
[source trước](evaluations/voice-live-timeout-2026-11-12-baseline-frozen.json),
[source sau](evaluations/voice-live-timeout-2026-11-12-regression-frozen.json).
Audio tự soạn bằng TTS Linh, đã dùng trong development; không phải holdout accuracy.
Giữ mọi lỗi, không retry toàn request, không tune model theo kết quả. Tổng chín phiên, đúng cap chín.

[Trước sửa](evaluations/voice-live-timeout-2026-11-12-baseline.json): ba cửa sổ native Chrome tab
(OTP, CEO mở đầu, CEO yêu cầu) đều HTTP 504 TIMEOUT, quan sát lỗi sau khoảng 3,15–3,18 giây kể từ đủ cửa sổ.

[Sau sửa](evaluations/voice-live-timeout-2026-11-12-regression.json):

- OTP: cảnh báo OTP/90, một bằng chứng; UI sau 3.322 ms, server 3.253 ms.
- CEO cửa sổ mở đầu: UNKNOWN; UI 2.390 ms. Chưa có yêu cầu chuyển tiền nên không tính là bỏ sót.
- CEO cửa sổ yêu cầu: cảnh báo CEO_FRAUD/90, một bằng chứng; UI 3.886 ms, server 3.830 ms.
- Lời khuyên bổ sung: SAFE/0; UI 3.177 ms. Đây là ca benign bổ sung, không có cặp baseline ở lượt này.

Cả bốn HTTP 200, không lỗi JSON/fallback/local. Các mốc UI gồm overhead automation, tính sau khi
AudioWorklet đủ mẫu; không phải đo pixel trên màn hình hoặc toàn bộ thời gian từ lời đầu tiên.
Cùng file nguồn nhưng capture/resampling giữa hai lượt không byte-identical. Một lượt mỗi ca không
chứng minh tỉ lệ timeout dài hạn; latency dịch vụ giữa các phiên cũng biến động.

Nguồn tab xác minh browser surface, audio label TAB và deviceId prefix web-contents, không dùng
fake UI/device hoặc thay stream; getUserMedia bị chặn. Tất cả track đã dừng sau mỗi ca.

[Micro giả lập](evaluations/voice-live-timeout-2026-11-12-microphone.json): Chromium fake microphone
phát TTS qua getUserMedia/AudioWorklet, không mở microphone vật lý. OTP cảnh báo/90, UI 5.320 ms,
server 5.254 ms; lời khuyên SAFE/0, UI 3.458 ms. Đủ năm giây audio mỗi request.
Đây là kiểm tra đường thu micro với input có kiểm soát, chưa xác minh chất lượng micro của máy người dùng.
Harness chặn fetch vượt số cửa sổ đã định, không trả verdict giả để thay kết quả Gemini.

**Giới hạn detector:** ca lời khuyên native là TTS nhưng Gemini trả p=0,05; các ca khác p=null.
Giữ nguyên số này: không coi điểm thấp là bằng chứng giọng người thật, không tuyên bố tăng accuracy clone.

## Xác minh và cách thử lại

[Verification](evaluations/voice-live-timeout-2026-11-12-verification.json): 94 backend, 11 client,
18 Chrome pass; hai test chồng lấp opt-in skip. Shared/backend/extension build và typecheck extension qua.
Test bổ sung phản hồi 4,5 giây không bị cắt, model treo bị hủy ở 8 giây, client hủy ở 9 giây;
Chrome micro nhận kết quả bị trì hoãn 4,1 giây và vẫn dừng toàn bộ track khi bấm dừng.
Fixture test không đo accuracy Gemini; build/test nặng chạy trước các lượt regression thật.

Giữ API `pnpm dev:voice-extended` chạy, Reload extension trong chrome://extensions rồi mở lại Voice.
Chọn tab hoặc micro, bắt đầu thu và nói/phát nội dung trong cửa sổ 5 giây đầu. Tiếp tục chờ kết quả,
UI mới có hai cách thu: một đoạn 5 giây tự dừng, hoặc theo dõi liên tục.
**Dừng thu và phân tích** giữ request đang chờ và gửi phần audio cuối; chỉ **Hủy phân tích** mới hủy.
Nếu đã đổi source nhưng backend chưa nạp code mới, khởi động lại lệnh API một lần.
Khi không có sóng âm hoặc báo quyền/chia sẻ audio, đó là lỗi nguồn thu riêng, không được giải quyết bằng deadline.

Raw audio, script, source và ảnh lưu ngoài Git tại `~/Library/Caches/ZeroLeak/voice-live-timeout-20261112/`.
