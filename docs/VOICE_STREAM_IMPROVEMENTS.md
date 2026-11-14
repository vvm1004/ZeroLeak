# Voice: bảo toàn tín hiệu và kiểm tra ngữ cảnh qua ranh giới — 12/11/2026

**Đã giữ tối ưu PCM và hàng đợi có giới hạn. Chồng lấp cửa sổ chỉ là thử nghiệm, mặc định tắt.**
Model/prompt/điểm số và ngân sách giữ nguyên. Dùng `pnpm dev:voice-extended` để khóa Voice vào
Gemini 3.8 Live Extended Thinking, không gọi model local hoặc Flash.

## Bản sửa đang dùng

Backend bỏ **chỉ các mẫu PCM bằng 0 liên tiếp ở hai đầu**, giữ 200 ms đệm và tối thiểu 0,5 giây.
Giữ nguyên từng byte của mọi mẫu khác 0, kể cả mẫu rất nhỏ 1/-1 và mọi khoảng nghỉ bên trong.
Không dùng ngưỡng năng lượng để cắt lời, không làm sạch giọng hoặc suy kết luận từ tín hiệu này.
WAV vẫn được kiểm tra định dạng, dung lượng, thời lượng và RMS trước khi xử lý.

Mục đích là tránh gửi khoảng lặng số thừa vào Live API. Với âm nền liên tục khác 0, có thể không
bỏ được byte nào. Dung lượng extension gửi lên backend vẫn như trước; phần giảm là PCM từ backend
sang Gemini. Không suy ra phần trăm giảm chi phí/token từ phần trăm byte này.

Client giữ tối đa **một cửa sổ live đang chờ**, ưu tiên cửa sổ mới nhất khi request trước chưa xong.
Không mở nhiều request đồng thời hoặc tích lũy audio thành hàng dài. Dừng, đóng trang hoặc bắt đầu
phiên mới sẽ bỏ cửa sổ chờ, hủy request và giải phóng track. Cửa sổ cũ không được gửi lại ở phiên mới.
Điều này giới hạn độ cũ của backlog; không bảo đảm phân tích mọi mẫu khi dịch vụ chậm.

## Phép so sánh review: cải thiện lượng PCM, chưa chứng minh accuracy tăng

Bốn tình huống TTS tiếng Việt trước đó chưa dự đoán: đòi mã xác nhận, giả sếp đòi tiền, lời kể/cảnh báo
và lời từ chối. Mỗi câu đặt trong clip 5 giây có khoảng lặng số ở hai đầu. Cùng WAV/SHA đưa vào hai bản:
source `c555fff` không cắt khoảng lặng và source mới. Không thay prompt/setup, Thinking LOW, review
15 giây, thứ tự hai bản luân phiên; không fallback/retry toàn request. Tổng **8 phiên**.

[Protocol đã đóng băng](evaluations/voice-stream-2026-11-12-trim-review-protocol.json),
[từng lượt](evaluations/voice-stream-2026-11-12-trim-review.json),
[gate](evaluations/voice-stream-2026-11-12-trim-review-gate.json):

- Cả hai bản đúng **4/4 nội dung**, gồm hai scam và hai benign; không có false alert nội dung hoặc lỗi.
- PCM thực gửi qua WebSocket: **640.000 → 479.700 byte**, giảm khoảng **25,05%**.
- Median: **3.504 → 2.888,5 ms**. Có một ca bản mới chậm hơn (**3.048 → 3.773 ms**), nên không hứa
  luôn nhanh hơn hoặc luôn dưới 3 giây. Đây là review, không dùng để nghiệm thu realtime.
- Mọi ước lượng giọng tổng hợp đều null. Không có bằng chứng tăng phát hiện clone/deepfake.

Đây là bộ kiểm tra có kiểm soát nhỏ, cùng một giọng TTS; chưa đại diện cuộc gọi thật, tiếng ồn, codec,
người nói hoặc bộ sinh khác. Phân loại đúng vẫn 4/4 ở cả hai, không gọi đây là accuracy tăng.

## Vì sao chồng lấp chưa được bật mặc định

Cửa sổ 5 giây liền nhau có thể chia một câu yêu cầu hoặc ngữ cảnh mạo danh thành hai phần.
Đã triển khai bộ đệm cho cửa sổ 5 giây, bước 2,5 giây, giữ nguyên từng mẫu ở vùng chồng lấp.
Request vẫn độc lập; không phải Gemini Live liên tục giữ lịch sử cả cuộc gọi.

[Protocol](evaluations/voice-stream-2026-11-12-protocol.json) cố định trước dự đoán: speech onset 3,7 giây,
so sánh cửa sổ 0–5/5–10 với 0–5/2,5–7,5/5–10. Clip giống nhau chỉ dự đoán một lần rồi dùng chung,
tránh chênh lệch do gọi lặp. Lượt đầu mở **3 phiên realtime**, cả ba TIMEOUT ở 3,1 giây. Dừng đúng
quy tắc ba lỗi liên tiếp; ba clip development còn lại không chạy. [Gate](evaluations/voice-stream-2026-11-12-development-gate.json)
không qua, không công bố lợi ích cảnh báo sớm. Phép kiểm tra test theo protocol này không chạy.

Ba [probe chẩn đoán](evaluations/voice-stream-2026-11-12-trim-probe.json), cố định trước khi gọi:

- Clip giữa đã bỏ khoảng lặng, realtime: TIMEOUT ~3.104 ms.
- Câu OTP ngắn đã biết làm đối chứng, realtime: TIMEOUT ~3.112 ms.
- Clip giữa nguyên bản, review: cảnh báo đúng CEO_FRAUD/90 sau ~3.874 ms.

Không đủ cơ sở quy các timeout cho riêng cách chia cửa sổ. Không tăng deadline để tuyên bố đạt Test 6.
Bốn trong sáu câu test đã chuẩn bị được dùng sau đó cho phép so sánh **PCM review riêng** ở trên;
không tính chúng thành kết quả realtime/chồng lấp.

## Dùng bản ổn định và thử bản chồng lấp

Mặc định giữ nhịp gửi mỗi 5 giây. Chạy API từ thư mục gốc ở terminal thứ nhất:

```bash
pnpm dev:voice-extended
```

Build extension ở terminal thứ hai:

```bash
pnpm build:extension
```

Reload unpacked extension trong `chrome://extensions`. Với file, bật **Phân tích kỹ file** để sử dụng
budget review. Thu micro/tab vẫn có deadline nhanh cũ, có thể timeout khi cloud chậm.

Muốn thử chồng lấp trên macOS/Linux, build riêng rồi reload extension:

```bash
VITE_VOICE_OVERLAP=1 pnpm build:extension
```

Bản này báo rõ trạng thái thử nghiệm trong lúc thu. Cửa sổ đầu vẫn cần 5 giây, sau đó có thể gửi mỗi
2,5 giây; số lượt phân tích/âm thanh lặp có thể gần gấp đôi. Khi bận chỉ giữ một cửa sổ mới nhất;
không gửi lại toàn bộ backlog. Chỉ dùng audio có quyền thử nghiệm, chưa coi là chế độ đã được đo tốt hơn.
Build lại `pnpm build:extension` không đặt cờ và reload để trở về nhịp mặc định.

## Kiểm chứng phần mềm và giới hạn

Bộ test kiểm tra byte PCM sau khi gửi qua socket, bảo toàn mẫu tiếng rất nhỏ, độ dài tối thiểu,
không cắt khoảng nghỉ nội bộ, không sửa mảng đã phát, cùng kết quả với packet nhỏ/lớn và ranh giới
cửa sổ. Chrome fixture kiểm tra request chồng lấp kế tiếp khi request đầu còn bận, tối đa một request,
dừng trước khi phản hồi cũ về và giải phóng track. Fixture không đo accuracy Gemini.

[Xác minh cuối](evaluations/voice-stream-2026-11-12-verification.json): **86/86 backend**, **8/8 client**,
Chrome fixture **15/15** ở bản chồng lấp, **13/13** ở bản mặc định (hai test opt-in được skip có chủ đích).
Typecheck extension, build backend và cả hai build extension qua; bundle bàn giao là bản mặc định.
Đã xem screenshot desktop/mobile của kết quả thật.

[Hai ca qua Chrome/API thật](evaluations/voice-stream-2026-11-12-browser-real.json), chế độ review:

- Đòi mã xác nhận: HTTP 200, cảnh báo/90, đúng tactic OTP, UI hiển thị model đúng; ~2.603 ms từ thao tác upload.
- Lời từ chối mật khẩu: HTTP 200, SAFE/0, không tactic; ~3.125 ms.

Cả hai dùng Extended, không fallback/local, p=null. Đây là hồi quy tích hợp trên hai file đã dùng trong
phép so sánh PCM, không phải thêm hai ca test accuracy độc lập. Không thu microphone thật.

Tổng **16 phiên Google** có artifact: 3 development bị timeout, 3 chẩn đoán, 8 paired review và 2 Chrome
review; dưới cap 40. Không chạy lại toàn request để lựa kết quả. Lượt 3,1 giây lỗi vẫn giữ trong báo cáo. Test 6 cuộc gọi thực tế
<3 giây và nhận diện clone đáng tin cậy **vẫn chưa nghiệm thu**. Không bảo đảm thứ hạng cuộc thi từ
những phép thử này. Ưu tiên tiếp là kiểm định trên cuộc gọi tiếng Việt có quyền dùng, giữ báo cáo
false alert/miss/UNKNOWN và đo thời gian từ lúc đủ audio tới cảnh báo trên giao diện.

Audio, source thử nghiệm và script nằm ngoài Git tại
`~/Library/Caches/ZeroLeak/voice-stream-20261112/`. Git chỉ có metadata/SHA và báo cáo đã lọc;
không đưa bản thu, transcript thô, embedding hoặc API key vào Git.
