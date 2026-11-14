# Voice: thử cải thiện riêng Live Extended Thinking — 12/11/2026

**Chưa có ứng viên mới chứng minh được chất lượng tốt hơn.** Hai cách thử dưới đây bị loại ngay ở development;
không thay prompt phục vụ, không thay ngưỡng hoặc ép model tăng điểm. Vẫn dùng prompt tại `c555fff`, Thinking LOW.

Thay đổi sử dụng được trong lượt này là lệnh **`pnpm dev:voice-extended`**: khóa Voice vào đúng
`gemini-3.8-live-extended-thinking` cho cả realtime và review. Không chuyển sang Gemini Live thường/Flash,
không gọi worker local. Khi model này lỗi, trả lỗi thay vì đổi model. Lệnh dùng trên macOS/Linux, áp dụng
biến môi trường cho tiến trình đang chạy, không sửa `.env`. Lệnh `pnpm dev:sandbox` vẫn có router cũ theo task.

## Cách chạy và kiểm tra đúng model

Từ thư mục gốc project:

```bash
pnpm dev:voice-extended
```

Dừng máy chủ cũ đang chiếm cổng 8080 trước khi chạy lệnh này. Mở Voice trong extension như hướng dẫn
[VOICE.md](VOICE.md), chọn file và bật **Phân tích kỹ file** khi cần budget review 15 giây.
Micro/tab vẫn dùng budget nhanh 3,1 giây. Không cần chạy `dev:voice-detector`.

`GET http://localhost:8080/health` phải có `voice.analysisStrategy="gemini"` và
`voice.modelRoute=["gemini-3.8-live-extended-thinking"]`. Kiểm tra response Voice:
`analysisModel` đúng model trên, `fallbackUsed=false`, không có `acousticAnalysis`.
Một ước lượng `syntheticVoiceProbability=null` vẫn là kết quả hợp lệ khi thiếu bằng chứng.

Lệnh chỉ khóa phần Voice; các phân hệ khác của dự án có cấu hình riêng. Không thay thuật toán detector
bằng việc khóa model và không dùng thay đổi này để công bố accuracy tăng.

## Thử 1: hai audio tham chiếu đã biết nhãn

Giả thuyết: giúp Gemini so sánh đặc điểm âm học thay vì chỉ yêu cầu tự ước lượng giọng tổng hợp.
[Live API reference](https://aistudio.google.com/api-reference/live#HistoryConfig) cho phép nạp lịch sử
bằng `historyConfig.initialHistoryInClientContent` trước realtime input, không kích hoạt một lượt sinh
riêng cho lịch sử. Đây là khả năng của giao thức, không phải cam kết về độ chính xác deepfake.

- Hai mẫu huấn luyện cùng câu: người thật VIVOS và clone VieNeu-Turbo, speaker 03, có SHA cố định.
  Không trùng speaker 07/08 của development. Nhãn tham chiếu chỉ áp dụng cho audio tham chiếu;
  không gửi nhãn, ID hoặc tên file của clip mục tiêu cho Gemini.
- Hai phiên probe và 12 phiên so sánh development: bốn clip human/clone của hai nguồn 07/08,
  thêm một yêu cầu OTP và một lời từ chối. Luân phiên thứ tự baseline/ứng viên, cùng WAV/SHA,
  Thinking LOW, budget 15 giây, cách thời điểm bắt đầu tối thiểu 6,5 giây.
- Probe nhận kết quả; không thấy câu tham chiếu lẫn vào ASR mục tiêu. Các cặp development có hash ASR
  giống nhau giữa hai bản. Điều này chưa chứng minh Gemini đã sử dụng tham chiếu đúng về âm học.
- Cả hai bản cảnh báo **0/2 clip clone**. Không có cảnh báo nhầm trên hai human; số human có điểm thấp
  giảm **2 → 0**, chuyển UNKNOWN. Nội dung đúng **1/2 → 1/2**, không tính UNKNOWN là đúng.
- Median sáu lượt mỗi bản tăng **2.443 → 6.768 ms**. Không gặp lỗi API/JSON trong nhóm nhỏ này.

**Loại ứng viên:** không tăng phát hiện clone hoặc nội dung đúng, giảm độ bao phủ human và chậm hơn.
Không đưa audio tham chiếu vào production. Không chạy holdout để tìm một kết quả đẹp hơn.

[Protocol](evaluations/voice-gemini-only-2026-11-12-reference-protocol.json),
[nguồn/config đóng băng](evaluations/voice-gemini-only-2026-11-12-reference-frozen.json),
[từng lượt](evaluations/voice-gemini-only-2026-11-12-reference-development.json),
[gate](evaluations/voice-gemini-only-2026-11-12-reference-development-gate.json).

## Thử 2: ví dụ đối chiếu hành vi lời nói tiếng Việt

Chỉ bổ sung ví dụ về đòi mã PIN so với khuyên không chia sẻ, lời từ chối và cảnh báo kể lại.
Không thêm audio tham chiếu, không đổi phần đánh giá p, ngưỡng hoặc parser. Đây là một ứng viên
riêng đã đóng băng trước dự đoán, không chỉnh theo kết quả holdout.

- Sáu ca × hai bản = **12 phiên**: một cặp human/clone và bốn ca nội dung đã biết
  (OTP, mạo danh sếp, lời khuyên, lời từ chối). Cặp âm học dùng lại từ development thử 1;
  không tính nó là nguồn độc lập mới.
- Nội dung đúng **4/4 → 4/4**; cảnh báo đúng cả hai scam, không báo nhầm hai benign.
  Chưa có thêm ca đúng. Cả hai chưa cảnh báo clip clone; human điểm thấp chuyển UNKNOWN ở ứng viên.
- Median tăng **2.607 → 3.206,5 ms**. Không gặp lỗi API/JSON trong nhóm này.

**Loại ứng viên:** chưa có lợi ích đo được. Không triển khai prompt ví dụ. Bộ kiểm tra gồm một cặp
âm học speaker 16 và sáu câu TTS mới đã tạo trước dự đoán vẫn chưa được dùng cho phép so sánh này.

[Protocol](evaluations/voice-gemini-only-2026-11-12-content-protocol.json),
[nguồn/config đóng băng](evaluations/voice-gemini-only-2026-11-12-content-frozen.json),
[từng lượt](evaluations/voice-gemini-only-2026-11-12-content-development.json),
[gate](evaluations/voice-gemini-only-2026-11-12-content-development-gate.json).

## Kiểm tra lệnh Extended-only

Kiểm tra trên API thật ở cổng thử riêng 18082, mỗi ca chạy một lần:

- Yêu cầu OTP, review: **HTTP 200**, cảnh báo nội dung/100, đúng tactic OTP, p=null,
  khoảng **3.314 ms**, Extended, không fallback, không có kết quả local.
- Lời khuyên, realtime: **HTTP 200**, SAFE/0, không tactic, p=null, khoảng **2.113 ms**,
  Extended, không fallback, không có kết quả local.

[HTTP smoke](evaluations/voice-gemini-only-2026-11-12-http-smoke.json).
Hai ca là kiểm tra tích hợp, không phải accuracy benchmark và không chứng minh Test 6 luôn dưới 3 giây.
Không chạy lại ca lỗi đến khi pass.

[Kiểm tra lỗi 503 giả lập](evaluations/voice-gemini-only-2026-11-12-strict-routing.json): cấu hình được lấy
trực tiếp từ lệnh mới; route realtime/review đều có đúng một model. Khi Extended lỗi, một WebSocket,
không gọi `generateContent`, một attempt rồi trả PROVIDER_ERROR. **83/83 test backend** hiện có qua.
Không thay mã extension nên không build hoặc chạy lại browser fixture trong lượt này.

## Giới hạn và dữ liệu

28 phiên Google trong phần kiểm tra có artifact của lượt này: 14 thử tham chiếu, 12 thử ví dụ tiếng Việt,
2 HTTP smoke. Tất cả dùng đúng Extended Thinking; không fallback hoặc retry toàn request.
Cơ chế sửa JSON tối đa một lần trong cùng review vẫn được phép như production, nhưng không ca nào cần dùng.
Không gộp kết quả của các lượt khác không có artifact trong báo cáo này vào tổng trên.

Ngưỡng đánh giá được giữ trước dự đoán: >=0,8 là cảnh báo tổng hợp; <=0,2 là điểm thấp;
ở giữa, null hoặc lỗi là UNKNOWN. Đây là quy ước so sánh, không phải hiệu chuẩn xác suất.
Chỉ vài nguồn development, một lần mỗi bản; không có khoảng tin cậy hoặc kết luận tổng quát về người Việt,
giọng vùng miền, codec cuộc gọi, bộ sinh clone khác hay hiệu quả ngoài thực tế. TTS nội dung dùng một giọng Linh;
VIVOS có giấy phép CC-BY-NC-SA-4.0, chỉ dùng nghiên cứu phi thương mại trong lượt này.

Nguồn, script và dữ liệu thử ở `~/Library/Caches/ZeroLeak/voice-gemini-only-20261112/`.
Git chỉ có báo cáo đã lọc và metadata/SHA; không đưa audio, embedding, transcript thô hoặc key vào Git.
Cần tiếp tục kiểm định trên các cuộc gọi tiếng Việt có quyền sử dụng và nhiều nguồn clone độc lập.
**Gemini-only hiện hỗ trợ phát hiện kịch bản lừa đảo; chưa đủ bằng chứng để quảng bá là detector giọng clone đáng tin cậy.**
