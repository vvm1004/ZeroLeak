# Voice: kiểm định chất lượng và phục hồi JSON — 12/11/2026

Mặc định vẫn là **Gemini 3.8 Live Extended Thinking đánh giá cả nội dung và dấu hiệu giọng tổng hợp**, theo task.
Không thay ngưỡng, không ép model tăng điểm, không đổi V3 thành nguồn chính. Repo remote hiện là
`https://github.com/vvm1004/MirageSec.git`; thư mục máy hiện tại vẫn là `Documents/code/ZeroLeak`.

## Kết quả được giữ và không được giữ

**Không giữ ứng viên đổi prompt.** Nó giảm một số điểm thấp sai trên audio tổng hợp, nhưng làm giảm
khả năng có kết luận đúng về nội dung và thêm timeout realtime. Giữ lại prompt tại commit `03c7b9a`.

**Giữ bản sửa xử lý JSON ở review:** nếu đầu ra cuối của Extended sai cấu trúc, cho phép model sửa
đúng một lần trong phiên hiện tại và trong deadline ban đầu. Đây là sửa độ ổn định xử lý lỗi;
**chưa có bằng chứng tăng khả năng phát hiện voice clone hoặc accuracy AI ngoài thực tế**.

## Thử prompt: dữ liệu và protocol cố định trước dự đoán

[Protocol](evaluations/voice-quality-2026-11-12-protocol.json),
[source/config đóng băng](evaluations/voice-quality-2026-11-12-candidate-frozen.json).
Baseline là `03c7b9a`. Ứng viên xét âm học trước nội dung, nêu rõ dấu hiệu có thể có/không đủ để kết luận,
và làm rõ trường hợp người nói kể lại, từ chối hoặc cảnh báo về một yêu cầu nhạy cảm.

- Development: hai cặp human/clone từ speaker calibration 07/08, clean, và hai câu nội dung đã biết.
  **6 ca × 2 bản = 12 phiên**. [Development](evaluations/voice-quality-2026-11-12-development.json)
  qua [gate](evaluations/voice-quality-2026-11-12-development-gate.json): clone điểm thấp 2 → 0,
  số nội dung đúng vẫn 2/2, chưa có clone nào được cảnh báo.
- Kiểm định: hai bản ghi gốc thuộc speaker test 13/17, mỗi bản có human/clone × clean/phone8k/noise,
  thành **12 clip âm học**. Chúng tách speaker khỏi development, mới đối với lượt Gemini này,
  nhưng là corpus đã dùng để đánh giá V3 trước đây, không phải kiểm định ngoài.
- Thêm **6 câu TTS mới**, ba scam và ba benign/khuyên bảo/kể lại, cùng giọng macOS Linh. Viết và
  tạo audio trước dự đoán, không cắt cụt câu. Đây là các kịch bản có kiểm soát, không phải test mù độc lập.
- 18 ca review × 2 bản = **36 phiên**; hai câu lặp realtime × 2 bản = **4 phiên**. Cùng model,
  Thinking LOW, WAV/SHA giống nhau, cùng budget 15.000/3.100 ms, đổi thứ tự trước/sau theo ca,
  cách thời điểm bắt đầu >=6 giây. Không fallback, không retry trong phép so sánh.
- Nhãn/ID/file không gửi lên model. Ngưỡng giữ >=0,8 cảnh báo, <=0,2 điểm thấp, còn lại UNKNOWN;
  lỗi và UNKNOWN giữ trong mẫu số. Không điều chỉnh prompt/ngưỡng sau kết quả kiểm định.
- [Gate runtime bổ sung](evaluations/voice-quality-2026-11-12-runtime-gate.json) chỉ siết tiêu chí,
  được cố định trước khi có dự đoán realtime: không được giảm nội dung đúng hoặc thêm lỗi ở hai ca nhanh.

## Vì sao ứng viên bị loại

[Từng lượt](evaluations/voice-quality-2026-11-12-comparison.json),
[gate và số tổng hợp](evaluations/voice-quality-2026-11-12-comparison-gate.json):

- Trên **6 clone** thuộc nhóm âm học, cả hai bản cảnh báo **0/6**. Điểm thấp sai giảm **4 → 1**,
  các ca còn lại chuyển UNKNOWN. Cả hai không báo nhầm trên 6 human, nhưng chỉ 2/6 human có điểm thấp;
  4/6 human UNKNOWN. Không dùng việc abstain nhiều để tuyên bố detector đã tốt.
- Trên sáu ca nội dung review, kết luận đúng giảm **5/6 → 3/6**. Ứng viên có một lỗi JSON và hai
  UNKNOWN ngữ nghĩa. Baseline có một UNKNOWN. Không gặp false alert hoặc confident miss, nhưng
  UNKNOWN trên lời lừa đảo vẫn làm mất khả năng cảnh báo.
- Hai ca realtime: đúng **2/2 → 1/2**, thêm một TIMEOUT ở câu đòi mã xác thực.
- Median mọi lượt review: **2.664,5 → 2.923 ms**. Không có cơ sở nói prompt mới nhanh hơn.

Ứng viên không qua gate coverage nội dung, mức tối thiểu 4/6 và hồi quy realtime. Không triển khai
prompt này, không chạy lại cùng ca đến khi pass, không xóa các thất bại khỏi báo cáo.

## Bản sửa được triển khai: review sửa định dạng tối đa một lần

Live không có response schema bảo đảm; đầu ra âm thanh được chép thành JSON có thể lỗi cấu trúc.
Trước đây, một đầu ra cuối sai định dạng lập tức làm model chính thất bại, dù review còn nhiều thời gian.

Điều kiện sửa lại đều phải đúng:

- Chế độ **review**, strategy Gemini theo task, model Extended Thinking.
- Nhận đầu ra cuối `IDLE`, parser báo **INVALID_RESULT** và chưa sửa lần nào.
- Còn ít nhất **3.000 ms** trong ngân sách hiện tại.

Backend xóa output/candidate cũ, yêu cầu model định dạng lại đánh giá **cùng audio trong cùng phiên**.
Không đưa nhãn hoặc kết luận mong muốn vào prompt sửa. Không gửi lại PCM, không mở socket/model mới,
không reset timer. Lần sửa vẫn dùng mọi kiểm tra schema, quote, risk và bằng chứng hiện có.

Kết quả hợp lệ `UNKNOWN` không được sửa để tìm kết luận chắc chắn hơn. Lời đệm khi còn `IN_PROGRESS`
không kích hoạt sửa. Lỗi khung WebSocket, key/quota/provider, input hoặc công cụ lạ không được bỏ qua.
Nếu lần sửa vẫn sai hoặc hết thời gian, vẫn trả lỗi; model fallback chỉ chạy nếu ngân sách chung còn đủ.

**Realtime giữ nguyên hành vi.** Standard Live, Flash và chế độ hybrid giữ hành vi cũ. Tổng review vẫn
15 giây cho router, 15,3 giây cho route và 16 giây cho client. Không tăng thời gian của Test 6.

Khi sửa thành công, response có `formatRepairAttempts:1`; client kiểm tra trường này chỉ nhận 0/1
và một lần sửa chỉ phù hợp transport LIVE_API. Đây là thông tin chẩn đoán, không phải điểm tin cậy.
Phiên có thể dùng thêm token vì model sinh thêm một phản hồi; không đồng nhất số WebSocket với số token.

## Kiểm thử bản sửa

**83 test backend + 6 client**, typecheck extension, build backend/extension qua. Test tái hiện:
JSON đầu sai → sửa đúng; không gửi lại audio; đúng một socket; valid UNKNOWN không sửa; realtime,
hybrid và ngân sách ngắn không sửa; lần hai sai vẫn lỗi; không dùng lại SAFE cũ; hủy/deadline ngay
trong lúc sửa; client từ chối metadata giả/malformed. Chrome fixture E2E **13/13** qua.

[Fault injection với Google thật](evaluations/voice-quality-2026-11-12-repair-smoke.json): chủ động
làm hỏng phản hồi đầu **ở client**, sau đó chuyển nguyên phản hồi tiếp theo. Đây là kiểm tra recovery,
**không phải lỗi tự nhiên của Google và không phải accuracy benchmark**. Kết quả:

- Một WebSocket, hai lượt yêu cầu đánh giá, 29 PCM frame gửi đúng một lần.
- Lần sửa trả JSON hợp lệ, DEEPFAKE_SCAM/90, tactic OTP, p=null, `formatRepairAttempts:1`.
- Hoàn tất khoảng **2.567 ms**, không gửi lại audio. Một ca không bảo đảm mọi lần sửa đều thành công
  hoặc đều nhanh như vậy.

Các số đo failed prompt không được gán cho bản sửa này. Bản sửa chưa được benchmark để công bố tỷ lệ
lỗi tự nhiên giảm bao nhiêu; mục tiêu đã kiểm tra là phục hồi có giới hạn và không phá các guard.

## Hai ca qua Chrome/API thật sau bản sửa

[Browser report](evaluations/voice-quality-2026-11-12-browser.json):

- OTP review: HTTP 200, DEEPFAKE_SCAM/90, đúng tactic OTP, p=null; model Extended, không fallback,
  không có kết quả local, khoảng **3.524 ms**. Phản hồi đầu hợp lệ nên không cần repair.
- Advice realtime: **HTTP 504/TIMEOUT**, khoảng **3.189 ms**; không có kết luận nội dung để tính đúng.
  Không chạy lại ca nhanh đến khi pass. Code realtime không thay đổi; ca này tiếp tục cho thấy deadline
  cloud chưa ổn định. Không công bố hai ca browser đều thành công.

[Verification](evaluations/voice-quality-2026-11-12-verification.json) ghi nguồn/hash và kết quả tests.
12 phiên dev + 40 comparison + 1 fault injection = 53 phiên đã đếm trực tiếp. Review browser có một
phiên thành công. Ca nhanh lỗi không trả trace đầy đủ, nên chỉ giới hạn thêm tối đa 3 phiên theo router;
**tổng upper bound 57, dưới cap 60**, không giả định số phiên chính xác từ HTTP lỗi. Một phiên sửa
format có thêm lượt sinh đầu ra, nên không dùng số phiên này để ước lượng token/chi phí chính xác.

## Chạy thử và giới hạn còn lại

Dùng cấu hình Gemini hiện tại, mở Voice và bật **Phân tích kỹ file**. Giữ các bước khởi động trong
[VOICE.md](VOICE.md). Cần reload unpacked Extension vì client có thêm kiểm tra metadata; bundle đã build.
Không đổi `.env`. `VOICE_ANALYSIS_STRATEGY=hybrid` vẫn là lựa chọn bổ trợ, không bị xóa.

Trong Network → `analyze-voice`, chỉ khi đã sửa đầu ra thành công mới thấy `formatRepairAttempts:1`.
Không có trường này không có nghĩa request lỗi; phản hồi hợp lệ đầu tiên không cần sửa.
Không coi p=0 là chứng minh giọng thật. Kết quả giọng tổng hợp của Gemini vẫn chưa hiệu chuẩn và chưa
đáng tin cậy để xác minh danh tính. Giọng clone và audio có nhiễu tiếp tục là điểm yếu đã biết.

Nguồn/script và dữ liệu tổng hợp nằm ngoài Git tại `~/Library/Caches/ZeroLeak/voice-quality-20261112/`.
Raw audio/voice embedding/key không đưa vào Git. **Test 6 cuộc gọi thực tế dưới 3 giây vẫn chưa nghiệm thu.**
