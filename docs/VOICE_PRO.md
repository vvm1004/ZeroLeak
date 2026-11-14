# Voice Pro: Gemini + detector âm học trên máy — 2026-11-13

**Đã tích hợp một chế độ hybrid chạy được bằng `pnpm dev:voice-pro`.** Gemini 3.8 Live Extended Thinking phân tích nội dung; detector XLS-R/AASIST + head V3 phân tích dấu hiệu giọng tổng hợp trên máy. Hai nhánh chạy song song, kết quả và cảnh báo độc lập. Không thay trọng số/ngưỡng V3 hoặc `.env`; lệnh Gemini-only `pnpm dev:voice-extended` vẫn giữ nguyên.

Đây là cải thiện bằng việc đưa detector chuyên biệt đã có vào luồng demo có thể khởi động và kiểm tra được, không phải một model mới được huấn luyện trong lượt này. Nó khác lựa chọn Gemini-only trước đó; chỉ lệnh Pro mới bật nhánh âm học.

## Cải thiện đo được

Đóng băng [protocol](evaluations/voice-pro-2026-11-13-protocol.json) và head SHA trước khi đánh giá; không fit hoặc chọn lại ngưỡng bằng kết quả test. Chạy worker qua HTTP thật trên toàn bộ 60 clip test của corpus80 clip đã chuẩn bị. Baseline Gemini lấy từ [lượt A/B trước](VOICE_MODEL_AB.md), nên không phải so sánh timing đồng thời.

- **10 clip clone trùng tập test đã chạy Gemini:** Gemini0 cảnh báo → local V3 **6 cảnh báo**, 4 UNKNOWN. Tập40 clip test trùng nhau được đối chiếu theoID và nguồn WAV/SHA, không trộn development.
- **Toàn bộ 18 clip clone của test:** 6 cảnh báo, 11 UNKNOWN, 1 điểm thấp bỏ sót. Các clip thuộc 6 nguồn gốc: clean cảnh báo 4/6, phone8k 2/6, nhiễu 0/6; 4/6 nguồn có ít nhất một biến thể được cảnh báo. Kết quả yếu hơn khi tính thêm các biến thể không nằm trong subset A/B; không chỉ trình bày con số6/10.
- **18 clip người thật:** 0 cảnh báo nhầm, 4 UNKNOWN. Không suy FPR thực tế bằng0.
- **24 clip TTS kiểm soát nội dung:** đều được cảnh báo tổng hợp; báo riêng để không che kết quả clone.
- 60/60 request HTTP local hợp lệ, không lỗi; median 581,34 ms, p95 851,35 ms, max 1.242,47 ms khi worker đã warm. Chưa gồm thu audio, Gemini, startup và UI.

[Gate](evaluations/voice-pro-2026-11-13-gate.json) · [Từng lượt](evaluations/voice-pro-2026-11-13-local-test.json).

Đây là hồi quy có kiểm soát: V3 đã được phát triển trên corpus liên quan, nguồn test từng được xem ở nghiên cứu local; clean/phone/noise là các biến thể cùng nguồn, không phải60 cuộc gọi độc lập. Clone ở các điều kiện nhiễu vẫn dễ bị bỏ sót hoặc UNKNOWN. Chưa phải kiểm định bên ngoài, xác minh danh tính hoặc bảo đảm phát hiện mọi deepfake.

## Các lỗi tích hợp đã sửa

1. Nhánh hybrid còn collection deadline3,1 giây, làm mất Gemini dù route/client đã dùng8 giây. Nay dùng hằng số chung8 giây realtime,15 giây review, giữ timeout riêng2,8 giây realtime/5 giây review của worker. Caller cancel vẫn hủy toàn bộ; lỗi một nhánh giữ nhánh còn lại.
2. Worker chỉ nhận<=5 giây, nên gửi nguyên file10–15 giây làm nhánh local lỗi. Node nay chia **toàn bộ** PCM thành tối đa 3 cửa sổ<=5 giây; cửa sổ cuối kéo lùi khi cần để giữ ngữ cảnh. Không bỏ phần cuối. Metadata `windowCount`/`audioDurationSeconds` được client kiểm tra khớp audio đã gửi.
3. Điểm file là mức cao nhất của các cửa sổ, **không cộng hoặc trung bình thành xác suất**. Một cửa sổ có dấu hiệu đủ để cảnh báo có giọng tổng hợp trong file. Cửa sổ im lặng/null ngăn kết luận điểm thấp cho toàn bộ file. Nhiều cửa sổ làm tăng cơ hội cảnh báo nhầm, nên chưa gọi đây là cải thiện accuracy; vẫn cần kiểm định với file dài thực tế.
4. Giao diện hiển thị riêng phần giọng nói, nhãn chưa hiệu chuẩn và phạm vi file. Giọng AI nói nội dung bình thường giữ risk0/SAFE về nội dung, đồng thời có thể có cảnh báo âm học. Cảnh báo âm học được lưu riêng trong lịch sử tối đa20 lượt và giữ đến phiên mới, không biến thành cảnh báo scam hoặc đổi màu sóng nội dung thành đỏ.

Lịch sử chỉ ở RAM trang, chiếu đúng các trường metadata; không giữ audio, embedding hay API key. Bắt đầu phiên mới/chọn file mới xóa lịch sử. Gemini-only không gọi worker.

## Kiểm tra tích hợp thật

- Launcher tự khởi động Python, đợi warmup/head SHA đúng rồi mới mở API. Nếu worker đúng phiên bản đã có thì tái sử dụng; khi thoát không dừng worker mượn. Cổng API bị chiếm được báo lỗi trước khi tạo dịch vụ mới. Ctrl+C dừng các tiến trình do chính lệnh tạo, đã kiểm tra hai cổng được trả lại.
- Tối đa6 phiên Google theo [protocol smoke](evaluations/voice-pro-2026-11-13-smoke-protocol.json), không chuyển model hoặc retry Google. 6/6 request API giữ được kết quả local đúng head. 4 ca có nhãn nội dung đều đúng:2 scam cảnh báo,2 benign SAFE.
- Một clip clone gặp Gemini `INVALID_RESULT`; API trả nội dung UNKNOWN, vẫn giữ cảnh báo tổng hợp local. Không gọi đây là6 kết quả Gemini thành công. [Kết quả smoke](evaluations/voice-pro-2026-11-13-smoke-results.json).
- 4 file15 giây có kiểm soát: người thật, clone, TTS nằm ở10–15 giây và người thật kèm im lặng. Tất cả được kiểm tra3 cửa sổ; TTS cuối file được phát hiện, người thật không bị cảnh báo và im lặng giữ UNKNOWN. Đây là kiểm tra vận chuyển/phạm vi bằng ghép/pad có chủ đích, không phải benchmark cuộc gọi thật. [Protocol](evaluations/voice-pro-2026-11-13-long-file-protocol.json) · [Kết quả](evaluations/voice-pro-2026-11-13-long-file-results.json).

## Chạy demo trên máy hiện tại

Dừng terminal API/worker cũ nếu đang dùng cổng8080/8081. Trong một terminal:

```bash
cd /Users/quangkimle/Documents/code/ZeroLeak
pnpm build:extension
pnpm dev:voice-pro
```

Chờ dòng **Voice Pro — Sẵn sàng** rồi mở `chrome://extensions`, reload extension và mở Voice. Giữ terminal chạy. Lệnh này phục vụ bản demo, không watch; khởi động lại sau khi sửa backend. `.env` cần key Google thực. Startup chỉ xác minh readiness, chưa gọi Google để kiểm tra quota.

Máy hiện tại đã có venv và assets trong `~/Library/Caches/ZeroLeak/voice`. Máy khác cần làm theo [V3](VOICE_DETECTOR_V3.md); launcher không tự tải model, Python chạy offline và chỉ bind127.0.0.1. API demo cũng bind loopback. Có thể đặt `PORT` và `VOICE_ACOUSTIC_URL` để dùng cổng khác.

Kiểm tra cấu hình từ terminal khác, **0 lượt Google**:

```bash
pnpm check:voice-demo --strategy hybrid
```

Nếu dùng cổng riêng, thêm `--api-base http://127.0.0.1:<api-port> --acoustic-base http://127.0.0.1:<worker-port>`. Checker xác minh strategy/route, worker sẵn sàng đúng head, và input lỗi bị chặn trước analyzer. Kiểm tra chấp nhận cấu hình đúng, từ chối head/strategy sai đã qua fixture,0 provider calls; không tính fixture là độ chính xác mô hình.

## Demo nên thể hiện gì?

1. Giọng TTS nói câu bình thường: nội dung có thể SAFE, giọng nói có thể cảnh báo tổng hợp. Giải thích hai loại kết quả độc lập.
2. Câu yêu cầu OTP/chuyển tiền: Gemini đưa cảnh báo nội dung và quote, bất kể giọng thật hay AI.
3. File15 giây có giọng tổng hợp ở phần cuối: UI hiển thị phạm vi15 giây/3đoạn, không bỏ đuôi.
4. Theo dõi liên tục, sau cảnh báo phát đoạn ít rủi ro: bằng chứng cũ còn trong lịch sử. Không kết luận toàn bộ cuộc gọi an toàn chỉ từ đoạn cuối.

Để đối chiếu lại Gemini-only, dừng Pro rồi chạy `pnpm dev:voice-extended`. Không sửa `.env` hoặc xóa model local.

Raw audio, script kiểm định, log, source snapshots và ảnh QA nằm ngoài Git trong `~/Library/Caches/ZeroLeak/voice-pro-20261113`. Chỉ báo cáo đã lọc được đưa vào `docs/evaluations`; không có raw provider output/transcript/key.

## Xác minh cuối

- 103/103 test backend, 23/23 test client pass; backend build, frontend typecheck/build và typecheck launcher/checker pass.
- Toàn bộ browser suite: 26 passed, 2 skipped cho overlap thử nghiệm. Bao gồm cảnh báo local khi Gemini lỗi, giữ cảnh báo âm học qua đoạn tiếp theo, reset phiên, file15giây/3đoạn, hủy request, đuôi audio và nguồn tab. Đây là fixture Google và microphone giả lập, không phải kiểm định micro vật lý hoặc độ chính xác.
- Ảnh desktop/mobile đã xem: phần nội dung ít rủi ro và cảnh báo tổng hợp tách biệt, không tràn ngang.
- Một assertion cũ bị nhầm đơn vị điểm và selector cũ đã được sửa. Test tắt microphone được tắt sớm hơn để bảo đảm cửa sổ im lặng hoàn toàn, đồng thời xác minh số frame của đuôi gửi. Giữ cả log lỗi ban đầu và log chạy lại; không giấu lỗi bằng retry Google.
