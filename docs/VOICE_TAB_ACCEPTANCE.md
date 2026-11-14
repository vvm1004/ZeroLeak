# Voice: kiểm thử tab Chrome thật — 12/11/2026

Báo cáo này giữ số đo với deadline cũ 3,1 giây. Xem [bản sửa timeout 8 giây và hồi quy mới](VOICE_LIVE_TIMEOUT.md); không thay số liệu lịch sử bên dưới.

**Đã sửa nguồn thu và kiểm tra toàn luồng native tab → API → Extended → UI.**
Kết quả mới có cảnh báo OTP, lời khuyên không bị báo nhầm, noise UNKNOWN; ca yêu cầu chuyển tiền
ở cửa sổ thứ hai vẫn TIMEOUT. **Test 6 dưới 3 giây chưa đạt.**
[Hướng dẫn demo](VOICE_DEMO.md) có lệnh kiểm tra sẵn sàng và các tình huống có thể tái hiện.

## Sửa lỗi có bằng chứng

Chrome cấp `getDisplayMedia({audio:true,...})` với AGC, khử nhiễu và khử vọng bật trong phép đo này.
Yêu cầu tắt ba xử lý **ngay khi xin stream** trả settings đều false; đổi constraints sau khi cấp
stream bị OverconstrainedError trong phép thử. Extension áp dụng constraints ban đầu cho tab/micro,
vẫn resample về PCM16 mono 16 kHz. Không thêm model, không đổi prompt/ngưỡng/deadline hoặc fallback.

Hai file TTS ngắn, xét cả khoảng lặng còn lại của cửa sổ 5 giây:

- OTP: RMS nguồn dự kiến 0,10176; trước sửa 0,15923 (×1,565), sau sửa 0,10175 (×0,99991).
- Lời khuyên: RMS nguồn 0,09873; trước 0,16476 (×1,669), sau 0,09872 (×0,99994).

Đây là bằng chứng biên độ gần nguồn hơn ở hai file; không phải waveform byte-identical hoặc
bằng chứng tăng khả năng phân biệt giọng thật/giả. [Settings](evaluations/voice-tab-2026-11-12-native-audio-settings.json)
và [đo RMS](evaluations/voice-tab-2026-11-12-signal-amplitude.json).

Thêm guard từ chối nguồn monitor/window, giải phóng mọi track trước khi gửi audio.
Guard này được thêm sau lượt đo Google; test Chrome cuối kiểm tra riêng cả hai nguồn sai.
Thông báo TIMEOUT chỉ rõ đoạn chưa được đánh giá, đề nghị kiểm tra nguồn/thử review file.

## Sửa sai trong thiết bị kiểm thử

Lượt ban đầu dùng `--use-fake-ui-for-media-stream`. Chromium có nhánh đưa display capture qua
FakeMediaStreamUIProxy với thiết bị “Fake audio”; `displaySurface:browser` một mình chưa chứng minh
nguồn audio đúng. Vì vậy **loại số đo 2,91/2,72 giây đã báo trước đó khỏi bằng chứng native tab**.
Các báo cáo gốc, cả lỗi, được giữ ngoài Git; raw capture tạm chưa xác minh nguồn đã xóa.
[Correction](evaluations/voice-tab-2026-11-12-capture-provenance-correction.json).
Xem [mã nguồn Chromium](https://chromium.googlesource.com/chromium/src/+/lkgr/content/browser/renderer_host/media/media_stream_manager.cc).

Hai pha được chấp nhận dưới đây không dùng fake UI/device và không thay stream:
video surface browser, nhãn audio phân loại TAB, deviceId có prefix web-contents;
`getUserMedia` bị chặn trong harness. Không lưu deviceId/nhãn đầy đủ trong report.
[Native protocol](evaluations/voice-tab-2026-11-12-native-protocol.json),
[probe nguồn](evaluations/voice-tab-2026-11-12-native-source-probe.json).

Fixture E2E dùng fake mic cho test microphone riêng; auto-accept chỉ áp dụng camera/mic.
Test tab xác nhận nhãn/device tab thật, ba constraints false và tần số 220 Hz từ trang nguồn,
phân biệt với chirp 220–420 Hz của fake mic. Fixture kiểm tra phần mềm, không đo chất lượng Gemini.

## Protocol và số đo đầy đủ

[Protocol gốc](evaluations/voice-tab-2026-11-12-protocol.json),
[case manifest/SHA](evaluations/voice-tab-2026-11-12-cases.json),
[source trước sửa](evaluations/voice-tab-2026-11-12-baseline-frozen.json),
[source đóng băng trước hồi quy](evaluations/voice-tab-2026-11-12-regression-frozen.json).
Bốn audio tự soạn, TTS Linh/noise, có nhãn/thứ tự trước dự đoán; tái sử dụng các clip development.
Đây là hồi quy có kiểm soát, không phải holdout độc lập hay cuộc gọi điện thoại/WebRTC thực tế.
Không gửi nhãn/tên file tới model, không retry toàn request để tìm lần pass.

Model duy nhất `gemini-3.8-live-extended-thinking`, strategy gemini; model budget 3.100 ms,
route 3.200 ms, client 3.500 ms. Mỗi pha dự kiến năm HTTP request, giữ cả lỗi/UNKNOWN.
Thời gian dưới đây từ lúc AudioWorklet đủ 80.000 mẫu tới lúc automation quan sát UI,
**chưa gồm 5 giây thu audio**. Gói worklet có thể thêm tới 128 ms trước mốc đủ mẫu;
UI observation có overhead automation, không đo thời điểm pixel thật sự hiện trên màn hình khi tab ẩn.
Khi demo phải đưa Voice ra trước người xem.

[Baseline native](evaluations/voice-tab-2026-11-12-verified_baseline.json), trước sửa:

- OTP: HTTP 504 TIMEOUT, UI lỗi 3.254 ms.
- Lời khuyên: SAFE/0, 2.591 ms.
- Noise: UNKNOWN, 2.952 ms.
- CEO cửa sổ 0: SAFE/0, 2.576 ms, chưa có yêu cầu chuyển tiền.
- CEO cửa sổ 1: HTTP 504 TIMEOUT, 3.152 ms.

[Hồi quy native](evaluations/voice-tab-2026-11-12-regression.json), sau constraints và thông báo lỗi:

- OTP: DEEPFAKE_SCAM/95, OTP_OR_CREDENTIAL_ASK, một bằng chứng, 3.135 ms.
- Lời khuyên: SAFE/0, không tactic, 2.768 ms.
- Noise: UNKNOWN, không tactic, 2.858 ms.
- CEO cửa sổ 0: UNKNOWN, 2.337 ms, chưa có yêu cầu chuyển tiền.
- CEO cửa sổ 1: HTTP 504 TIMEOUT, 3.151 ms.

Baseline trả kết quả HTTP 200 ở 3/5 cửa sổ; hồi quy 4/5. Mỗi ca chỉ một lượt mỗi phiên bản,
không kết luận khác biệt này do sửa AGC hay có ý nghĩa thống kê. UNKNOWN không tính là phát hiện
thành công; cửa sổ CEO đầu không có yêu cầu không phải một lần bỏ sót nội dung chưa được nghe.
Cả hai pha đều dừng mọi track sau mỗi ca, không gọi local detector/fallback.
Mọi p giọng tổng hợp trong kết quả đều null; vẫn giữ ca TTS p=0,1 ở
[kiểm thử review trước](VOICE_FULL_FILE_REVIEW.md), không che giấu giới hạn nhận diện tổng hợp.

Tổng pha này có upper bound **16 phiên Google**: năm lượt dùng fake UI bị loại, một lượt chẩn đoán
trên audio chưa xác minh nguồn (không dùng nghiệm thu), năm baseline native và năm hồi quy native.
Dưới cap 24; setup/preflight/probe settings/fixture không gọi Google.
Không dùng mẫu số 16 để tính accuracy. Raw audio, script và ảnh ở cache ngoài Git.

## Kiểm chứng phần mềm và demo

[Verification](evaluations/voice-tab-2026-11-12-verification.json): 92/92 backend, 10/10 client,
Chrome 18 pass và hai test chồng lấp opt-in skip; typecheck extension, build backend/extension qua.
Kiểm tra tab thật, stop/cancel, quyền lỗi, kết quả lỗi không giữ SAFE cũ, upload full 12 giây,
biên 16 giây, bằng chứng và từ chối nguồn monitor/window. Số lượng test không đại diện accuracy AI.

`pnpm check:voice-demo` qua tám kiểm tra trên API strict Extended cục bộ.
Ba fault fixture (route sai model, API offline, URL sai scheme) đều exit 1 đúng mong đợi.
[Preflight](evaluations/voice-tab-2026-11-12-preflight.json),
[negative cases](evaluations/voice-tab-2026-11-12-preflight-negative.json).
Lệnh không gọi Google và ghi rõ providerVerified=false; không phải kiểm tra quota/key/model availability.
[Trang audio tĩnh](evaluations/voice-tab-2026-11-12-demo-source-probe.json) qua Chrome native: đủ 5 giây PCM, RMS 0,10210, đúng nguồn tab và dừng mọi track. HTTP dùng fixture TIMEOUT, không dùng kết quả giả làm kết quả model. Mở WAV trực tiếp qua file:// không qua bước tìm audio trong harness (TimeoutError); không dùng cách đó trong runbook.

## Phần cần tiếp tục sau lượt này

Cần giảm timeout và đo nhiều cuộc gọi/giọng/codec thực tế, bổ sung dữ liệu độc lập và đánh giá riêng
nhận diện giọng tổng hợp. Hiện cảnh báo nội dung có bằng chứng là phần có thể trình diễn;
không được gọi đây là detector deepfake đã hiệu chuẩn, realtime đã đạt Test 6 hoặc bảo đảm giải nhất.
