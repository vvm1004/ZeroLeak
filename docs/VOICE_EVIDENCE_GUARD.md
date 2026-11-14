# Voice: kiểm tra cảnh báo CEO và thử ngữ cảnh — 2026-11-13

Bản cập nhật giảm cảnh báo nội dung thiếu bằng chứng, vẫn dùng **Gemini 3.8 Live Extended Thinking**, thinking LOW. Không đổi model, prompt production, cửa sổ audio, deadline, số lượt gọi Google hoặc ngưỡng điểm. Không có detector local tham gia.

## Sửa lỗi đã quan sát được

Trong thử nghiệm Google thật, câu chỉ tự xưng giám đốc và yêu cầu giữ bí mật đã nhận cảnh báo CEO_FRAUD 90 điểm. Chức danh, giữ bí mật hay lịch họp gấp chưa đủ chứng minh yêu cầu lừa đảo.

`voice-result.ts` áp dụng điều kiện ngữ cảnh nhạy cảm vốn có của URGENCY_PRESSURE cho cả CEO_FRAUD. Nếu transcript của đoạn hiện tại thiếu dấu hiệu hành động nhạy cảm được hỗ trợ, trả UNKNOWN, riskScore=null, xóa tactic/evidence chưa đủ căn cứ. Lời giải thích nêu cần nghe thêm yêu cầu cụ thể. **Không tự đổi thành SAFE.** Ước lượng giọng tổng hợp vẫn độc lập; bản sửa này không xác minh danh tính hay giọng clone.

Đây là điều kiện cần trên văn bản ASR, không phải bộ phát hiện lừa đảo bằng regex. Danh sách dấu hiệu có giới hạn; yêu cầu dùng cách diễn đạt khác hoặc bị cắt qua ranh giới audio có thể phải giữ UNKNOWN. Các trường hợp qua guard vẫn phải vượt kiểm tra speech act và quote hiện có.

## So sánh bằng Google thật

Chốt trước 8 audio TTS tiếng Việt mới: 4 lời nói bình thường/cảnh báo và 4 yêu cầu nhạy cảm. Mỗi audio gọi Google **một lần**, sau đó replay **cùng JSON và ASR** qua parser trước/sau. Cả 8 lượt replay khớp baseline; không retry, không fallback. Tách tác động guard khỏi sự ngẫu nhiên giữa hai lần sinh của model.

- Lời nói bình thường: baseline có 2 cảnh báo nhầm trên 4 mẫu, bản sửa không còn hai cảnh báo này. Hai mẫu chuyển sang UNKNOWN, **không phải nhận diện SAFE thành công**.
- Yêu cầu chuyển tiền, OTP, mật khẩu, truy cập từ xa: cả 4 cảnh báo được giữ; không mất cảnh báo nào trên bộ thử.
- Mẫu giới thiệu còn UNKNOWN và mẫu khuyên không chuyển tiền còn SAFE.
- Không đổi điểm giọng tổng hợp của bất kỳ mẫu nào. Cả 8 mẫu lần này đều có ước lượng null, nên không tính chất lượng phân biệt giọng người/AI.

[Protocol chốt trước](evaluations/voice-context-2026-11-13-guard-protocol.json) · [Kết quả từng mẫu](evaluations/voice-context-2026-11-13-guard-results.json).

Bộ này nhỏ, tự viết và dùng một giọng TTS. Nó kiểm tra một lỗi bằng chứng; không đại diện cuộc gọi thật, nhiều giọng/vùng miền, dữ liệu công khai độc lập hay độ chính xác deepfake. Không tuyên bố detector chính xác tuyệt đối hoặc chắc chắn đạt giải.

## Phương án đã thử nhưng không đưa vào production

Theo [tài liệu Gemini Live](https://ai.google.dev/gemini-api/docs/live-api/capabilities), clientContent hỗ trợ bổ sung văn bản/ngữ cảnh. Từ đó thử giả thuyết: đưa tối đa 300 ký tự ASR đoạn liền trước, chỉ làm dữ liệu không tin cậy, không đưa nhãn/điểm và không cho trích quote của đoạn cũ.

4 kịch bản cố định, 12 phiên Google: 4 prefix dùng chung, 4 target baseline và 4 target có ngữ cảnh. Đảo thứ tự baseline/candidate theo mẫu, cùng target WAV, cùng model/deadline 8 giây. **Không có gain theo tiêu chí chốt trước**. Câu trích dẫn yêu cầu chuyển tiền vẫn báo nhầm; một lời từ chối từ SAFE thành UNKNOWN. Median thời gian target là 2724 ms baseline và 4461 ms candidate; chỉ là số đo nhỏ của lần chạy, không phải SLA.

Vì vậy **không truyền previousTranscript trong production**, không bật overlap mặc định, không tăng chi phí gọi model. [Protocol](evaluations/voice-context-2026-11-13-protocol.json) · [Kết quả kể cả phương án bị loại](evaluations/voice-context-2026-11-13-results.json).

Tổng cộng 20 phiên Google cho hai phép thử. Harness lần đầu tạo audio im lặng trong sandbox: validator chặn trước provider, 0 phiên Google; lỗi harness được lưu riêng, không tính vào kết quả detector. Không dùng micro thật, bản ghi riêng tư, và không lưu raw provider response/key trong báo cáo.

## Kiểm tra và cách demo

- Backend: 96/96 test pass, build pass.
- Client: 20/20 test pass.
- Chrome: regression riêng cho kết quả CEO thiếu bằng chứng, được kiểm tra cùng lịch sử phiên và điểm giọng tổng hợp độc lập. Đây là fixture, không phải lượt Google hay phép đo accuracy.

Khởi động backend bằng `pnpm dev:voice-extended`. Nếu `tsx watch` đang chạy, nó tự nạp thay đổi. Với hai câu “Anh là giám đốc, vào họp gấp” và “Anh là giám đốc, chuyển tiền ngay, đừng gọi lại”, đọc đủ rõ trong đoạn 5 giây hoặc dùng file tối đa 15 giây. Mẫu thứ nhất không nên có cảnh báo CEO chỉ từ chức danh; nếu model vẫn gán CEO thiếu bằng chứng, guard giữ UNKNOWN. Mẫu thứ hai có thể cảnh báo kèm quote. Lời nói thực tế, ASR và Gemini vẫn có thể khác bộ TTS.

Raw audio, source snapshot, script chuẩn bị/chạy, log và protocol được giữ ngoài Git tại `~/Library/Caches/ZeroLeak/voice-context-20261113`. Script từ chối ghi đè kết quả, giới hạn số phiên; một lần đánh giá mới cần thư mục kết quả mới. Chỉ JSON tóm tắt đã lọc được đưa vào `docs/evaluations`.
