# Voice: đối chiếu Extended Thinking và Flash-Lite — 2026-11-13

**Kết luận triển khai:** giữ `gemini-3.8-live-extended-thinking` cho phân tích nội dung hiện tại. Chưa có bằng chứng để chuyển sang `gemini-3.1-flash-lite`. **Cả hai chưa chứng minh được khả năng phát hiện giọng clone trong phép thử này.** Không thay `.env`, model mặc định, prompt production, ngưỡng cảnh báo, luồng thu âm hoặc UI.

## Đã làm

- Chuẩn bị **80 clip ngoài Git**: 8 nguồn ghi âm VIVOS công khai kèm audio clone theo cặp, cộng 16 kịch bản tiếng Việt mới do nhóm tự viết và tổng hợp bằng macOS Linh. Có bản sạch, phone8k và room_noise15db. Mọi WAV và nguồn đã kiểm SHA; các cặp người thật/clone có cùng số mẫu trong từng điều kiện.
- Tách 2 người nói development khỏi 5 người nói test; nguồn ghi âm và kịch bản không vượt split. Nano dùng ở development, Turbo ở phần acoustic test. Linh dùng ở cả hai split nội dung nên **không gọi đây là test nội dung với bộ sinh chưa từng thấy**.
- Chốt trước tập chạy **48 clip**: 32 bản sạch và 16 biến thể; 8 development, 40 test. Hai model nhận cùng WAV/SHA, cùng budget realtime 8 giây, thứ tự chạy trước luân phiên, tối đa 96 lượt, không retry/fallback.
- Chạy **71 lượt Google thật**. Flash-Lite bị dừng sau 3 lỗi liên tiếp theo quy tắc trong harness; 25 lượt dự kiến của model này được ghi rõ là chưa thử. Extended hoàn thành 48/48 clip. Không tiếp tục gọi cho tới khi có kết quả đẹp.
- Sửa metadata evaluator từ deadline realtime cũ 3.100 ms sang hằng số chung 8.000 ms. Thêm kế hoạch A/B có seed, kiểm tra split và thống kê UNKNOWN/error. Không suy giọng giả từ nhãn lừa đảo.

[Protocol chốt trước](evaluations/voice-model-ab-2026-11-13-protocol.json) · [Manifest 80 clip](evaluations/voice-model-ab-2026-11-13-dataset.json) · [Audit dữ liệu](evaluations/voice-model-ab-2026-11-13-dataset-audit.json).

## Đối chiếu công bằng trên 23 clip cả hai thực sự thử

[Thống kê cặp chung](evaluations/voice-model-ab-2026-11-13-paired-summary.json), tính sau lượt chạy từ JSON đã lưu, **0 lượt gọi Google bổ sung**. Lỗi/timeout vẫn nằm trong cặp; không lọc chỉ các lượt thành công.

- Extended: **23/23** kết quả hợp lệ, không lỗi. Median 2.969 ms, tính cả các lượt có kết luận UNKNOWN.
- Flash-Lite: **12/23** kết quả hợp lệ; **7 timeout và 4 HTTP503**. Median 3.493 ms, tính cả lỗi. 25 lượt bị bỏ qua không được tính là request đã lỗi hoặc đã thành công.
- Trong 12 clip có nhãn nội dung thuộc tập cặp chung: Extended cảnh báo 5 clip scam, kết luận đúng 3 clip benign, còn 4 UNKNOWN. Flash-Lite cảnh báo 3 clip scam, kết luận đúng 5 clip benign, còn 4 chưa đánh giá được, bao gồm lỗi dịch vụ. Không có cảnh báo nhầm benign trên tập này.
- Không có tín hiệu tăng phát hiện giọng tổng hợp theo ngưỡng đánh giá đã chốt. Không chọn lại ngưỡng sau khi xem kết quả.

**Không so trực tiếp tỷ lệ nội dung trên toàn bộ 48 clip Extended với 23 clip Flash-Lite để tuyên bố model nào thông minh hơn.** Kế hoạch đầy đủ chưa hoàn thành theo cặp, nên gate chuyển model không đạt. Lần đo chỉ phản ánh key, đường mạng, thời điểm và deadline hiện tại; không chứng minh Flash-Lite luôn kém ổn định. Không kiểm định riêng chế độ review 15 giây.

## Bản Extended đang dùng làm được gì trên toàn bộ tập đã chọn?

- Nội dung: **12/12 clip scam có cảnh báo**, 8/12 clip benign được kết luận đúng, 4 benign UNKNOWN. Có 16 văn bản gốc, trong đó 8 kịch bản scam và 8 benign; biến thể nén dùng lại một số văn bản. Không coi 24 clip có nhãn là 24 tình huống độc lập.
- Các benign còn UNKNOWN: `d_deadline_clean`, `t_internal_clean`, `t_warning_clean`, `t_done_clean`. Giữ chúng trong lỗi chưa kết luận; không đổi UNKNOWN thành kết quả đúng.
- Giọng clone: **0/12 clip đạt ngưỡng cảnh báo tổng hợp**. 6 clip có điểm thấp, 6 chưa có quyết định. 12 clip này thuộc **8 nguồn ghi âm gốc**, không phải 12 người độc lập. Các điểm thấp trên clone là bỏ sót quan trọng; không dùng điểm đó để xác minh người gọi là thật.
- Người thật: không có cảnh báo nhầm tổng hợp trên 12 clip, nhưng 9/12 chưa có quyết định. Tỷ lệ cảnh báo nhầm thấp **không đủ chứng minh detector tốt** khi clone cũng không được phát hiện.
- Kết quả hợp lệ API: 48/48, median 2.722 ms, p95 4.975 ms trong lần chạy này. Thời gian chỉ gồm lượt phân tích; chưa cộng thời gian thu audio 5 giây, hàng đợi và UI. Không phải SLA hoặc cam kết live dưới 3 giây.

Các số giọng tổng hợp dùng quy ước kiểm định **p>=0,8 là cảnh báo, p<=0,2 là điểm thấp, còn lại/null là UNKNOWN**. Đây là ngưỡng cố định của phép thử, không phải hiệu chuẩn xác suất và không tự đổi kết luận nội dung. [Từng lượt và thống kê điều kiện](evaluations/voice-model-ab-2026-11-13-report.json) · [Quyết định](evaluations/voice-model-ab-2026-11-13-decision.json).

## Giới hạn dữ liệu và phép đo

80 clip đại diện **8 nguồn người thật và 16 văn bản tự viết**, không phải 80 cuộc gọi độc lập. Phần chọn chạy có 12 clip human và 36 synthetic, nên phải xem acoustic-pairs riêng; không lấy các TTS Linh dễ nhận diện để che kết quả clone. Dữ liệu nguồn từng được dùng trong nghiên cứu local, không phải corpus bên ngoài chưa từng được xem. Các kịch bản nội dung mới chỉ có một giọng TTS; chưa cân bằng vùng miền, người nói, cảm xúc hay bộ sinh mới.

**Ma trận bốn nhóm có nhãn chưa đầy đủ.** Nội dung của speech VIVOS chưa được gán nhãn scam độc lập nên để null. Chưa có bản ghi người thật đọc kịch bản scam có nguồn/quyền dùng rõ ràng; không tự gán false cho speech công khai hoặc tạo TTS rồi gọi là người thật. Cần bổ sung và review nhóm này trước khi tuyên bố chất lượng cuộc gọi thật.

[VSASV](https://huggingface.co/datasets/hustep-lab/VSASV-Dataset) yêu cầu chấp nhận điều kiện truy cập; không vượt gate. Bài nghiên cứu [VSASV tại Interspeech](https://www.isca-archive.org/interspeech_2024/hoang24b_interspeech.html) là nguồn tham khảo, không phải dữ liệu đã được chạy trong báo cáo này. Bộ cộng đồng human/AI/scam tìm thấy có nguồn YouTube và provenance chưa đủ rõ nên không dùng làm ground truth.

Đây là so sánh **hai đường chạy hiện có**: Extended qua Live API dùng compact JSON + ASR; Flash-Lite qua generateContent dùng structured output. Không phải phép so sánh thuần model với mọi prompt/transport giống hệt. Theo [Google](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite), Flash-Lite nhận audio và hỗ trợ structured output nhưng không có Live API. Không đổi transport mặc định của bản demo.

Không thu micro thật, không test trình duyệt live lần này, không lưu raw provider response/transcript/key. Chỉ gửi audio và chỉ dẫn production cho Google; không gửi nhãn, ID, tên file, người nói hay văn bản ground truth.

## Chạy lại trên máy hiện tại

Raw audio, bản frozen của harness trước khi chạy, report từng lượt, audit, log và protocol được giữ tại:

`~/Library/Caches/ZeroLeak/voice-ab-20261113/`

Kiểm tra trước, **0 lượt Google**:

```bash
cd /Users/quangkimle/Documents/code/ZeroLeak
pnpm eval:voice:ab --manifest "$HOME/Library/Caches/ZeroLeak/voice-ab-20261113/dataset/cases.json" --plan "$HOME/Library/Caches/ZeroLeak/voice-ab-20261113/dataset/protocol.json" --output /private/tmp/voice-ab-new-run --dry-run
```

Bỏ `--dry-run` để gọi Google, với key trong `.env`. Dùng thư mục output mới; script từ chối ghi đè/resume để tránh gọi lặp. Tối đa 96 lượt theo protocol, dừng từng model sau 3 lỗi liên tiếp. Chạy lúc máy nhàn và không có người khác đang dùng cùng key để so sánh độ trễ dễ hơn.

Để chuẩn bị bộ mới từ corpus local đã có:

```bash
python3 apps/sandbox-api/scripts/prepare-voice-ab.py --acoustic-manifest "$HOME/Library/Caches/ZeroLeak/voice-evaluation-v3/candidate2/dataset/cases.json" --output /private/tmp/voice-ab-new-data
```

Cần macOS có giọng Linh, ffmpeg và corpus/provenance local đã chuẩn bị; repo không đóng gói raw audio. File protocol mới có trường stopAfterConsecutiveErrors rõ ràng. Bản report gốc được giữ nguyên; sau khi đo xong chỉ bổ sung thống kê cặp chung, metadata ngưỡng thấp và tổng quát kiểm tra split cho mọi nhãn human. Các bổ sung này không đổi request, analyzer, nhãn hoặc dự đoán của 71 lượt đã ghi.

## Kiểm tra code và quyết định tiếp theo

**100/100 backend tests pass**, backend build và typecheck riêng script pass. Test bao gồm: source/người nói/kịch bản không vượt split, thứ tự cặp có seed và không phụ thuộc nhãn, vùng UNKNOWN không tăng số ca đúng, cặp có lỗi vẫn nằm trong thống kê. Dry-run xác minh WAV/SHA, deadline8s và 0 provider calls.

Ưu tiên tiếp theo cho Gemini-only là xử lý những ca nội dung chưa đủ ngữ cảnh trên dữ liệu mới, và bổ sung nhãn độc lập cho speech người thật. Nếu mục tiêu là phát hiện clone đáng tin cậy, cần kiểm định một detector âm học chuyên biệt; việc thêm nó sẽ là thay đổi kiến trúc, chưa được áp dụng ở đây. Không tuyên bố đổi model đã cải thiện clone hoặc bảo đảm giải thưởng.
