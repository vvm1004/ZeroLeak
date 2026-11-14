# Voice: đọc đủ ngữ cảnh của file — 12/11/2026

**Chế độ Phân tích kỹ file gửi trọn file dài 0,5–15 giây tới Gemini trong một phiên riêng.**
**Cập nhật sau báo cáo:** trang Voice đã bỏ checkbox; chọn file luôn phân tích toàn bộ tối đa 15 giây.
Các phép đo trước/sau dưới đây giữ nguyên cấu hình đã đóng băng, không được chạy lại để thay số liệu.
Những thao tác bật/tắt review bên dưới là mô tả phiên bản trước. Micro/tab vẫn dùng cửa sổ 5 giây; deadline được cập nhật trong [bản sửa timeout](VOICE_LIVE_TIMEOUT.md). Không sửa prompt, model, ngưỡng hoặc trọng số detector. Khởi động bằng
`pnpm dev:voice-extended` để dùng đúng Live Extended Thinking và không chuyển model/local detector.

## Lý do nâng cấp

Bản trước chỉ nghe 5 giây đầu, kể cả khi bật Phân tích kỹ file. Nếu người gọi mở đầu bình thường rồi
mới yêu cầu chuyển tiền, phần quyết định không tới Gemini. Ngược lại, cắt trước câu giải thích
“đây là ví dụ cảnh báo, đừng làm theo” có thể biến bài cảnh báo thành một yêu cầu lừa đảo.

Bản mới thay đổi **độ bao phủ audio**, không tuyên bố mô hình tự nhiên chính xác hơn trên cùng input.
Một file tối đa 15 giây được giải mã/resample trên thiết bị, gửi PCM16 mono 16 kHz qua endpoint cũ,
và xử lý trong cùng phiên Extended. Không chia thành nhiều request, không chọn kết quả đẹp nhất,
không cộng điểm giữa các đoạn. Vẫn tối đa một lần sửa JSON trong cùng review/deadline nếu cần.

## Cách chạy và thử

Terminal thứ nhất, từ thư mục gốc:

```bash
pnpm dev:voice-extended
```

Terminal thứ hai:

```bash
pnpm build:extension
```

Reload extension trong `chrome://extensions`, mở Voice, bấm **Chọn file thử** rồi chọn WAV/MP3
mà Chrome giải mã được. File tối đa 10 MB và 15 giây âm thanh; dài hơn sẽ báo lỗi trước khi gửi API,
không âm thầm bỏ phần cuối. Sau khi có kết quả, trạng thái ghi thời lượng toàn bộ file đã gửi.
Trang Voice không còn tùy chọn chỉ gửi 5 giây đầu của file. Không dùng review để công bố đã đạt realtime <3 giây.

Các file TTS có thể dùng để kiểm tra luồng mới, nằm ngoài Git:

- `~/Library/Caches/ZeroLeak/voice-full-review-20261112/audio/late_ceo_full.wav`: câu yêu cầu sau giây thứ 5;
  mong đợi cảnh báo nội dung mạo danh sếp/chuyển tiền hoặc UNKNOWN nếu dịch vụ chưa đủ chắc chắn.
- `~/Library/Caches/ZeroLeak/voice-full-review-20261112/audio/delayed_quoted_warning_full.wav`: có câu đòi mã
  rồi giải thích đó là ví dụ, không được làm theo; mong đợi không có cảnh báo lừa đảo cho toàn file.

Đây là audio TTS do nhóm kiểm thử tự soạn, không phải cuộc gọi người thật hoặc bằng chứng xác minh
clone. Kết quả Google có thể thay đổi; không chạy lại nhiều lần chỉ để chọn một lượt pass khi báo cáo.

## Giới hạn được kiểm tra bằng byte/mẫu thực

- Không đặt `analysisMode`, hoặc `realtime`: WAV 0,5–5 giây, tối đa 160.044 byte; JSON tối đa 220.000 byte.
- Đặt `analysisMode:"review"`: WAV 0,5–15 giây, tối đa 480.044 byte; JSON tối đa 650.000 byte.
- Server kiểm tra RIFF/header, sample rate, số kênh, PCM16, số frame, năng lượng và Base64;
  không tin nhãn thời lượng từ client. Giữ giới hạn hai request đồng thời và kiểm tra token/origin.
- Deadline giữ nguyên: fast Gemini 3.100 ms; review Gemini 15.000 ms, route 15.300 ms,
  client 16.000 ms. Thời lượng audio 15 giây và thời gian xử lý 15 giây là hai giới hạn khác nhau.
- CLI `evaluate-voice.ts --mode review` chấp nhận file dài tới 15 giây; fast/quality giữ giới hạn cũ.
  V3 local vẫn có giới hạn riêng, nên kiểm tra long review bằng luồng Gemini-only ở trên.

## Không bỏ bằng chứng ở cuối ASR

Review giữ tối đa 1.500 ký tự ASR để cung cấp nguyên văn cho Gemini và đối chiếu quote; fast giữ
300 ký tự như trước. Nếu ASR review vượt 1.500 ký tự, trả INVALID_RESULT thay vì đánh giá âm thầm
một phần đầu. Những quote không có trong nguồn vẫn bị loại và không tự tạo điểm/SAFE.
Giữ redaction số/khóa/email hiện có; không coi đó là bộ che PII hoàn chỉnh.

Với review dài hơn 5 giây, đợi ASR báo finished hoặc chờ 200 ms không có chunk ASR mới sau ACK audio
rồi mới yêu cầu đánh giá. Chunk đến sau sẽ khởi động lại khoảng chờ, trong deadline ban đầu.
Timer được hủy khi dừng/kết thúc/lỗi; không có request muộn sau khi đóng phiên. Đây là biện pháp hạn
chế transcript bị ngắt sớm, không phải chứng minh ASR luôn đúng hoặc hoàn chỉnh.
Trong các lượt API đã đo dưới đây, độ dài ASR đưa vào yêu cầu đánh giá bằng độ dài ASR cuối quan sát được.

[Live API capabilities](https://aistudio.google.com/docs/live-api/capabilities) mô tả PCM streaming,
manual activity và lifecycle; backend vẫn đợi IDLE của Extended, không coi thought/input ASR là verdict.

## Phép thử trước/sau có protocol cố định

[Protocol](evaluations/voice-full-review-2026-11-12-protocol.json),
[source/config đóng băng](evaluations/voice-full-review-2026-11-12-frozen.json),
[manifest/SHA](evaluations/voice-full-review-2026-11-12-cases.json).

Tám file 12 giây, cùng giọng macOS Linh, soạn/tạo trước khi dự đoán. Hai development và sáu test.
Cả hai bản dùng Extended Thinking LOW, cùng system prompt và budget review 15 giây, thứ tự luân
phiên giữa prefix/full. Baseline nhận 5 giây đầu; bản mới nhận toàn file. Nhãn tính cho **toàn file**,
không coi baseline là phân loại sai nội dung mà nó chưa được nghe. Nhiều prefix là cùng câu mở đầu,
được chạy lặp theo lịch paired cố định; không coi các prefix đó là quan sát độc lập.

Không gửi nhãn/ID/tên file cho model. Không fallback hoặc retry toàn request. UNKNOWN và lỗi ở trong
mẫu số, không tune prompt/ngưỡng theo test. Mỗi pha có gate trước khi chạy pha tiếp theo.

- [Development](evaluations/voice-full-review-2026-11-12-development.json): hai file × hai bản = 4 phiên.
  Bản cũ UNKNOWN 2/2; bản mới cảnh báo đúng một scam và trả SAFE cho một lời khuyên.
  [Gate development](evaluations/voice-full-review-2026-11-12-development-gate.json) qua.
- [Test](evaluations/voice-full-review-2026-11-12-test.json): sáu file × hai bản = 12 phiên.
  Bản mới đúng **6/6 nhãn nội dung toàn file**: cảnh báo ba scam sau giây thứ 5, không báo nhầm ba benign.
  Baseline đúng 1/6 theo mục tiêu bao phủ toàn file, bỏ sót ba yêu cầu muộn và báo nhầm hai lời trích dẫn
  do chưa nghe phần giải thích sau đó; một prefix UNKNOWN.
- Không có lỗi API/JSON trong 16 phiên, không dùng format repair. Gate yêu cầu >=5/6 ở test,
  không thêm false alert/lỗi và có thêm kết luận toàn file đúng. [Gate test](evaluations/voice-full-review-2026-11-12-test-gate.json) qua.
- Median test: prefix **2.487,5 ms**, full **4.982,5 ms**; full có ca **10.356 ms**. Đọc thêm ngữ cảnh
  tốn thời gian hơn, không trình bày thành tối ưu latency hoặc đạt Test 6 dưới 3 giây.
- p đều null. Không có số đo cải thiện nhận diện giọng clone. Không chấm accuracy cho từng tactic;
  ca password threat còn có nhãn AUTHORITY_IMPERSONATION bổ sung, nên không coi mọi subtype đã đúng.

Đây là kiểm tra **độ bao phủ/ngữ cảnh của pipeline** trên bộ TTS thiết kế riêng cho giới hạn 5 giây,
không phải benchmark độc lập người thật/AI hoặc bằng chứng chính xác 100% ngoài thực tế.
Cần thêm giọng người, ngôn ngữ/vùng miền, codec, nhiễu và hội thoại không được thiết kế theo hệ thống.

## Hai ca qua Chrome và API thật

[Browser report](evaluations/voice-full-review-2026-11-12-browser-real.json):

- File 12 giây có yêu cầu chuyển tiền muộn: HTTP 200, cảnh báo/90, CEO_FRAUD, khoảng **5.297 ms**
  từ thao tác upload. UI hiển thị model đúng và trạng thái đã gửi toàn bộ 12 giây.
- File 12 giây trích lời đòi mã rồi giải thích cảnh báo: HTTP 200, SAFE/0, không tactic,
  khoảng **4.348 ms**; UI xác nhận đủ 12 giây.

Cả hai dùng Extended, không fallback/local, p=null. Đây là hồi quy trên hai file đã dùng trong test,
không phải thêm hai mẫu accuracy độc lập. Không thu microphone thật. Đã xem ảnh desktop/mobile.

## Biên 15 giây và kiểm chứng phần mềm

Một [ca biên](evaluations/voice-full-review-2026-11-12-boundary-protocol.json) được cố định trước khi chạy:
file CEO đã biết, thêm noise nền số nguyên [-100,100], seed 41024, kéo dài đúng 15 giây. Đây là hồi quy
của cùng TTS, không phải mẫu accuracy độc lập. [Chrome/API thật](evaluations/voice-full-review-2026-11-12-browser-boundary.json)
nhận đủ 15 giây, HTTP 200, cảnh báo CEO_FRAUD/90, ~5.678 ms, Extended không fallback.

**Điểm giới hạn đáng chú ý:** file này được tổng hợp bằng TTS nhưng Gemini trả p=0,1.
Không dùng điểm đó để khẳng định giọng thật; ca này cho thấy nhận diện tổng hợp vẫn có thể bỏ sót.
Cảnh báo nội dung vẫn hoạt động độc lập với p. Không ép p tăng hoặc loại ca này khỏi báo cáo.

[Xác minh cuối](evaluations/voice-full-review-2026-11-12-verification.json): **92/92 backend**, **10/10 client**,
Chrome mặc định **16/16** (hai test chồng lấp opt-in skip). Typecheck extension và build backend/extension qua.
Đã kiểm tra upload đủ 12 giây, fast vẫn 5 giây, file 16 giây bị từ chối locally không gọi API,
quote sau ký tự 300, hủy timer ASR, trường hợp ASR quá dài và byte PCM gửi sau giây thứ 5.
Fixture là kiểm tra phần mềm, không phải accuracy AI.

[CLI dry-run](evaluations/voice-full-review-2026-11-12-cli-dryrun.json) nhận file 12 giây ở review,
từ chối ở realtime trước khi gọi model, providerCalls=0. Tổng các phép đo thật là **19 phiên Google**:
4 dev, 12 test, 2 browser 12 giây, 1 browser biên 15 giây; dưới cap 24, không fallback/retry toàn request.

## Kịch bản demo và điều còn thiếu

Một minh họa hữu ích là cho thấy cùng loại yêu cầu nhạy cảm có thể là lừa đảo trực tiếp hoặc chỉ là
trích dẫn trong bài cảnh báo; đọc đủ ngữ cảnh giúp phân biệt. Trình bày đây là phát hiện **kịch bản
lừa đảo**, giữ riêng phần ước lượng giọng tổng hợp chưa đủ bằng chứng. Không dùng kết quả này để
xác nhận danh tính người gọi hoặc cam kết dự án sẽ đạt giải.

[Trang Hackathon chính thức](https://gdg.community.dev/events/details/google-gdg-mientrung-presents-hackathon_gdg-devfest-mientrung-2026/)
ghi lịch sáng 14/11/2026 theo giờ Việt Nam; trang đã đọc chưa có bảng tiêu chí chấm chi tiết.
Không tự gán trọng số chấm điểm khi chưa có thể lệ của vòng đội tham dự.

Test 6 cuộc gọi thực tế <3 giây, nhận diện clone đáng tin cậy và dữ liệu đánh giá độc lập vẫn chưa
nghiệm thu. Muốn tranh giải, cần dựa vào sản phẩm hoàn chỉnh và bằng chứng kiểm chứng, không coi
một bộ test nhỏ hoặc nhiều unit test là bảo đảm thứ hạng.

Source, script và raw audio lưu ngoài Git tại `~/Library/Caches/ZeroLeak/voice-full-review-20261112/`.
Git chỉ có metadata/SHA và kết quả đã lọc; không chứa audio, transcript thô, embedding hoặc API key.
