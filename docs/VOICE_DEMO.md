# Voice: hướng dẫn chạy và trình diễn

Bản hiện tại dùng **Gemini 3.8 Live Extended Thinking duy nhất** khi khởi động bằng lệnh dưới đây.
Có thể trình diễn phát hiện yêu cầu OTP, phân biệt lời khuyên và trả UNKNOWN cho âm thanh chưa đủ
bằng chứng. **Chưa đạt nghiệm thu realtime <3 giây, chưa chứng minh nhận diện clone đáng tin cậy.**
Xem [kết quả tab Chrome thật và giới hạn](VOICE_TAB_ACCEPTANCE.md).

## Chuẩn bị trên Mac

Từ `/Users/quangkimle/Documents/code/ZeroLeak`, dùng Node.js >=22 và dependencies đã cài.
`.env` ở gốc cần key Gemini có quyền sử dụng model. Không đưa key vào extension hoặc slide.

Terminal 1:

```bash
pnpm dev:voice-extended
```

Terminal 2:

```bash
pnpm build:extension
pnpm check:voice-demo
```

Lệnh kiểm tra cần `passed: true` cho cả tám mục. Nó kiểm tra bundle, API, route đúng một model,
Gemini-only và việc chặn input lỗi; **không gọi Google, không xác minh key/quota hay chất lượng AI**.
Nếu API dùng cổng khác, truyền `--api-base http://127.0.0.1:18082` và nhập cùng địa chỉ ở trang Voice.
Không mở hai API cùng cổng. `pnpm dev:sandbox` có thể dùng chuỗi fallback theo cấu hình;
`pnpm dev:voice-extended` khóa đường gọi theo lựa chọn của đội, không cần detector local cổng 8081.

Chrome → `chrome://extensions` → Developer mode → Load unpacked →
`apps/extension/.output/chrome-mv3`. Nếu đã cài, bấm Reload sau mỗi lần build.
Mở popup → **Bảo vệ cuộc gọi — ZeroLeak Voice**. Kiểm tra **Kết nối dịch vụ**:
API mặc định `http://localhost:8080`; nhập mã truy cập nếu server có `VOICE_API_TOKEN`.
Giữ trang Voice mở suốt phiên, dừng thu giữa các tình huống.

**Hai cách thu tab/micro:**

- **Một đoạn 5 giây** (mặc định cho demo): thu đủ audio rồi tự dừng, hiện đang phân tích và giữ kết quả. Đọc/phát tình huống ngay sau khi được cấp quyền; thao tác chuyển tab quá chậm có thể khiến đầu đoạn chỉ có im lặng.
- **Theo dõi liên tục:** chia audio thành từng đoạn 5 giây và tiếp tục thu trong lúc chờ kết quả. Phù hợp nếu cần chuẩn bị nguồn trước rồi phát sau. Chỉ hiển thị kết quả đoạn gần nhất; không bảo đảm bao phủ toàn bộ hội thoại khi dịch vụ chậm.

Thanh thời lượng là lượng audio thực đã thu, không phải phần trăm tiến độ Gemini.
**Dừng thu và phân tích** giữ audio đã thu và đợi kết quả; **Hủy phân tích** mới hủy yêu cầu đang chờ.
Khi dừng, phần cuối từ 0,5 giây được gửi thêm; phần ngắn hơn không gửi. Có thể còn đoạn chờ nên giới hạn 8 giây áp dụng cho từng yêu cầu, không phải tổng thời gian xử lý cả hàng đợi.


**Khi chọn file:** chỉ cần bấm **Chọn file thử** rồi chọn audio. Hệ thống tự phân tích toàn bộ
file dài tối đa 15 giây, dung lượng tối đa 10 MB; có thể cần đến 15 giây xử lý.
Đã bỏ checkbox chọn chế độ để tránh thao tác nhầm. Nếu đang mở trang cũ, reload extension rồi mở lại Voice.
Tab/micro vẫn phân tích từng đoạn 5 giây; Gemini được chờ tối đa 8 giây xử lý (trình duyệt 9 giây).
[Sửa timeout và kết quả trước/sau](VOICE_LIVE_TIMEOUT.md). Đây chưa phải realtime dưới 3 giây.

Ngay khi chọn file, nút và khung kết quả báo **Đang đọc file** rồi **Đang phân tích âm thanh**,
kèm tên file và chỉ báo xử lý. Có thể bấm **Hủy phân tích** ở cả hai bước.
Khi thành công/lỗi/hủy, trạng thái chờ được dọn; không hiển thị phần trăm tiến độ giả.

## Phát audio mẫu qua tab Chrome

Các file thử TTS/noise, trang phát và script đo được lưu ngoài Git tại:
`~/Library/Caches/ZeroLeak/voice-tab-20261112/`.
Đây là bộ kiểm tra có kiểm soát, không phải cuộc gọi người thật hoặc bộ dữ liệu đánh giá độc lập.
Để tránh khác biệt trình phát WAV tích hợp của Chrome, dùng trang phát cục bộ đã kiểm tra:

```bash
python3 -m http.server 18083 --bind 127.0.0.1 --directory "$HOME/Library/Caches/ZeroLeak/voice-tab-20261112/audio"
```

1. Mở `http://127.0.0.1:18083/` trong Chrome. Chỉ phát một bản ghi mỗi lần, đưa về giây 0 trước khi thử.
2. Ở Voice, chọn **Âm thanh từ tab**. Với trang phát mẫu, chọn **Theo dõi liên tục** để có thời gian chuyển sang nguồn phát; với micro có thể dùng **Một đoạn 5 giây**. Bấm **Bắt đầu kiểm tra**.
3. Chọn đúng thẻ **ZeroLeak Local Demo Audio**, bật **Chia sẻ âm thanh** rồi xác nhận.
4. Qua thẻ audio, bấm phát file cần thử; quay lại Voice để người xem nhìn thấy kết quả.
5. Chờ đủ cửa sổ 5 giây và thời gian xử lý. Có thể bấm **Dừng thu và phân tích** khi bản ghi hết tiếng để ngừng thu nhưng vẫn nhận kết quả. Không mô tả thời gian xử lý là toàn bộ thời gian từ lúc người gọi bắt đầu nói.
6. Nếu còn thu, bấm **Dừng thu và phân tích**, đợi hết đoạn chờ rồi đặt lại bản ghi trước ca tiếp theo. Chế độ một đoạn đã tự dừng nên không cần bấm dừng nữa.

Một nguồn được chọn nhầm thành cửa sổ/màn hình sẽ bị từ chối và dừng track trước khi gọi API.
Không bật micro thật trong phép thử này. Nếu máy dùng cổng 18083 cho dịch vụ khác, chọn cổng trống và đổi URL tương ứng.
Trang nguồn tĩnh không gọi Google; Voice mới là bên gửi từng WAV tới API.

## Ba tình huống ngắn để trình bày

- **Yêu cầu OTP (`otp.wav`):** mong đợi cảnh báo nội dung, tactic yêu cầu OTP/mật khẩu và trích dẫn
  làm bằng chứng. Lượt hồi quy thật trả 95 điểm, quan sát UI sau khoảng 3,14 giây tính từ lúc đủ cửa sổ.
  Đây không phải cam kết mọi lần đều có kết quả hoặc dưới 3 giây.
- **Lời khuyên phòng tránh (`advice.wav`):** mong đợi không bị gán là kịch bản lừa đảo chỉ vì nhắc tới OTP.
  Lượt đã đo trả SAFE/0. SAFE ở đây chỉ là chưa thấy kịch bản trong đoạn âm thanh, không xác nhận danh tính người gọi.
- **Nhiễu không có lời nói (`no_speech.wav`):** mong đợi UNKNOWN/chưa đủ bằng chứng, không bịa lời thoại,
  không hiển thị như một cuộc gọi đã được xác minh an toàn. Lượt đã đo trả UNKNOWN, p=null.

Với cả ba ca, chỉ rõ **phát hiện nội dung lừa đảo** khác với **ước lượng dấu hiệu giọng tổng hợp**.
Tên enum `DEEPFAKE_SCAM` không chứng minh âm thanh là deepfake; trường giọng tổng hợp trong các lượt
này đều null. Không dùng riskScore làm phần trăm chắc chắn giọng giả.

## Tình huống dài và phương án khi dịch vụ chậm

`late_ceo.wav` dài 12 giây, yêu cầu chuyển tiền bắt đầu sau giây 6. Cửa sổ đầu chưa có yêu cầu;
ở lượt đo với deadline cũ, cửa sổ thứ hai TIMEOUT. Lượt sửa deadline mới đã cảnh báo CEO_FRAUD/90;
xem VOICE_LIVE_TIMEOUT.md. Mỗi ca mới một lượt, không tuyên bố mọi yêu cầu đều bị chặn.
Khi lỗi, UI phải nói đoạn này **chưa được đánh giá**, không giữ kết quả SAFE của đoạn trước.

Để kiểm tra đủ ngữ cảnh, dừng thu, bấm **Chọn file thử** và chọn file dài tối đa 15 giây.
Ví dụ đã đo ở lượt trước: `voice-full-review-20261112/audio/late_ceo_full.wav` và
`delayed_quoted_warning_full.wav`, cùng nằm dưới `~/Library/Caches/ZeroLeak/`.
Chế độ này gửi toàn file, budget xử lý 15 giây; kết quả trước khoảng 4–6 giây ở hai ca Chrome 12 giây.
Đây là review file, không được trình bày như luồng cuộc gọi realtime đã đạt dưới 3 giây.

Nếu mạng/quota lỗi, hiện trạng thái lỗi thật. Có ảnh chụp lượt hồi quy trong thư mục cache
`screenshots/`, dùng để giải thích **kết quả ghi nhận trước đó**, ghi rõ không phải live.
Không thay kết quả thật bằng fixture hay phát đi phát lại đến khi thành công rồi chỉ báo lượt đẹp.

## Kiểm tra trước buổi trình diễn

Chạy preflight, thử một ca audio thật và ghi lại cả lỗi; việc này có sử dụng quota.
Xác nhận model xử lý thực tế trên UI, nguồn tab đúng, trích dẫn phù hợp và nút dừng giải phóng chia sẻ.
Tắt các audio còn lại; đóng thông báo cá nhân trước khi trình chiếu. Không cần thu microphone thật.
Sau demo dừng thu và dùng Ctrl+C để dừng API/server audio do mình khởi động.

Thông điệp trình bày phù hợp: **Google Gemini giúp nhận diện kịch bản lừa đảo từ audio; extension
hiển thị bằng chứng và hành động nên làm, đồng thời báo rõ khi chưa đánh giá được.**
Điểm mạnh hiện tại là luồng chạy thật và giới hạn được đo; thứ hạng cuộc thi phụ thuộc cả sản phẩm,
chất lượng toàn đội và cách trình bày, không thể bảo đảm giải nhất.

## Lỗi khi chọn otp.wav và cách xử lý — 12/11

Phần dưới lưu lịch sử trước khi bỏ checkbox; cách dùng hiện tại là chọn file và hệ thống tự phân tích toàn bộ.

Ảnh người dùng báo TIMEOUT ở chế độ nhanh (ô Phân tích kỹ file đang tắt), dù preflight qua.
Đã tái hiện qua Chrome + API + Gemini thật: cùng WAV 2,81525 giây, fast HTTP 504 sau ~3.337 ms
quan sát UI; review HTTP 200, cảnh báo OTP/95, có bằng chứng, ~3.268 ms. Lời khuyên review SAFE/0
~2.474 ms; fast SAFE/0 ~3.042 ms. Tất cả là thời gian quan sát từ upload, không phải thu âm tab.

[Protocol cố định](evaluations/voice-file-timeout-2026-11-12-protocol.json),
[kết quả bốn lượt, giữ cả timeout](evaluations/voice-file-timeout-2026-11-12-browser-real.json),
[source đóng băng](evaluations/voice-file-timeout-2026-11-12-source-frozen.json),
[kiểm chứng](evaluations/voice-file-timeout-2026-11-12-verification.json).
Không retry toàn request; cùng byte WAV trong từng cặp, Extended-only, không fallback/local,
p đều null. Mỗi chế độ chỉ một lượt: không suy ra tỉ lệ timeout hoặc mức cải thiện thống kê.
Riêng lượt review OTP xử lý server 3.022 ms, vẫn trong budget nhanh danh nghĩa ở một phiên khác;
biến động giữa các phiên có thể góp phần vào khác biệt, không quy toàn bộ thành công cho việc tăng budget.

Sửa cho người dùng: mặc định bật review khi chọn file; UI nói rõ toàn file tối đa 15 giây và
có thể chờ đến 15 giây xử lý. Tắt checkbox vẫn thử nhanh 5 giây đầu; tab/micro vẫn giữ deadline cũ.
Thông báo timeout phân biệt fast/review. Reload extension và mở lại trang Voice để nhận mặc định mới.
Build/typecheck qua; 92 backend, 10 client, 18 Chrome qua (hai test chồng lấp skip).
Fixture 4,1 giây xác nhận file mặc định không bị client cắt ở deadline nhanh;
ca micro xác nhận checkbox review không chuyển thu trực tiếp sang chế độ file.
Không đánh dấu Test 6 đạt hoặc tuyên bố tăng accuracy deepfake.

## Rút gọn chọn file

Đã bỏ checkbox và lựa chọn thử nhanh khỏi trang Voice. Người dùng chỉ chọn file; frontend luôn gửi
analysisMode=review, nghe đủ tối đa 15 giây, không âm thầm bỏ phần cuối. Tab/micro giữ chế độ realtime.
API vẫn hỗ trợ hai chế độ để phục vụ các nguồn này; người dùng không phải quyết định budget xử lý.
Không đổi model, prompt hoặc điểm số detector; đây là thay đổi thao tác và cách chọn chế độ.
