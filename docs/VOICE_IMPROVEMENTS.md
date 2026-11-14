# Cải thiện Voice sau screening — 2026-11-10

**Bản theo task và so sánh với hybrid:** [Gemini đánh giá cả giọng tổng hợp và nội dung](VOICE_TASK_COMPARISON.md). Mặc định mới là `VOICE_ANALYSIS_STRATEGY=gemini`; các phép đo bên dưới thuộc các bản trước.

**Cập nhật trước đó:** [tối ưu trực tiếp Gemini 3.8 Extended, A/B và sáu câu mới](VOICE_EXTENDED_IMPROVEMENTS.md).

**Cập nhật model:** [Gemini 3.8 Live Extended Thinking](VOICE_LIVE_API.md).
Các phép đo/luồng Flash bên dưới được giữ làm lịch sử; head âm học V3 không thay đổi.

**Cập nhật tiếp theo 2026-11-11:** [backoff, readiness, kết quả paced và các ứng viên bị loại](VOICE_FOLLOWUP.md).

**Bản sửa trước đó 2026-11-11:** [sửa timeout/coordinator, warmup và kiểm thử lại](VOICE_RELIABILITY.md).
66 test phần mềm qua; kiểm định nội dung mới chưa đạt gate.

**Cập nhật trước đó 2026-11-11:** [hướng dẫn kiểm thử nội dung/bằng chứng và review](VOICE_TESTING.md).
Đã bổ sung kiểm tra quote, trạng thái provider, waveform theo cảnh báo, bỏ SAFE cũ khi lỗi và chế độ
review file có deadline riêng. Bộ 24 ca nội dung còn 2 báo nhầm và 6 lỗi/timeout: chưa đạt gate;
không công bố accuracy tăng. Detector âm học vẫn là [V3](VOICE_DETECTOR_V3.md), giữ giới hạn khi nhiễu.
Phần dưới lưu đối chiếu lịch sử trước V2/V3.

## Lỗi đã sửa trong ứng dụng

Router cũ hủy model chính ở 2.100 ms để chừa khoảng 1 giây gọi fallback. Screening cho thấy nhiều
lượt hợp lệ cần 2.600–3.000 ms, nên cách chia này loại bỏ cả những lượt có thể hoàn tất đúng hạn.
Đã bỏ mốc hủy 2.100 ms: model chính được dùng phần ngân sách còn lại, tối đa tổng cộng 3.100 ms.
Nếu lỗi sớm vẫn thử fallback trong thời gian còn lại; hết deadline thì trả chưa đánh giá được.
Không tăng timeout extension 3.500 ms.

Test với đồng hồ giả tái hiện: model chính trả ở 2.500 ms, trước sửa bị chuyển sang fallback,
sau sửa nhận đúng kết quả chính. Đây là test điều phối, không phải phép đo tăng accuracy AI.
13 test backend, typecheck và build backend đã qua.

## Đối chiếu detector âm học

Cùng 22 ca của [screening ban đầu](VOICE_EVALUATION.md), ngưỡng chẩn đoán 0,5 định trước,
CPU 4 threads, batch 1. Các phép đo được chạy lần lượt, sau một warmup riêng cho mỗi model;
không có upload audio/Gemini calls trong hai lượt này.

- [AASIST chính chủ](https://github.com/clovaai/aasist): bắt 14/14 ca synthetic nhưng báo nhầm
  4/8 ca human, tương ứng FPR 50% trong bộ nhỏ này. Median inference sau warmup khoảng 139 ms.
- [XLS-R fine-tune của Gustking](https://huggingface.co/Gustking/wav2vec2-large-xlsr-deepfake-audio-classification):
  bắt 12/14 ca synthetic, không báo nhầm 8 ca human; **bỏ sót cả hai mẫu Piper**.
  Median inference sau warmup khoảng 331 ms, p95 khoảng 339 ms. Bản trọng số khoảng 1,26 GB,
  chạy được bằng CPU trên máy hiện tại; chưa đo tính đồng thời hay khả năng chịu tải server.

Đây là 22 **ca**, gồm các bản nén cùng nguồn, không phải 22 speaker độc lập. Ngưỡng chưa hiệu chuẩn.
Điểm softmax không phải xác suất giọng giả ngoài thực tế. Median/p95 chỉ đo xử lý từng mẫu sau warmup,
không gồm tải model, kiểm hash, import thư viện, thu âm 5 giây hoặc truyền mạng. Một lượt prototype lạnh
của XLS-R từng cần khoảng 3.210 ms cho inference đầu tiên; nếu tích hợp cần nạp/warmup trước readiness.

**Chưa thể chốt XLS-R thắng trên dữ liệu mới:** human đang chọn đều có nhãn nam, còn paired TTS chỉ
có một giọng macOS Linh. Khác biệt speaker/giới tính/nguồn thu có thể giúp model phân loại. Hai truy vấn
metadata FLEURS bổ sung tại offset 200 và 300 bị HTTP 502, nên đợt này chưa bổ sung được nhóm cân bằng.
Không tuyên bố đã kiểm định cân bằng giới tính hoặc đã loại trừ confound. Không đổi threshold để che
hai mẫu Piper bị bỏ sót. Tăng coverage so với Gemini chưa tự nó chứng minh độ chính xác tốt hơn.

Bằng chứng từng ca, version, revision, SHA256 và thời gian:
[AASIST](evaluations/voice-acoustic-aasist-2026-11-10.json),
[XLS-R](evaluations/voice-acoustic-xlsr-2026-11-10.json).

## Hướng tích hợp đề xuất

1. **Tách hai quyết định:** detector âm học chỉ cảnh báo dấu hiệu tổng hợp; Gemini phân tích nội dung.
   Giọng AI đọc lời nhắc lịch họp không tự thành scam; người thật đòi OTP vẫn có thể là scam.
   Không gộp chúng thành một xác suất và không dùng điểm thấp để xác minh danh tính người gọi.
2. **Kiểm định ứng viên bằng dữ liệu mới:** bổ sung human nam/nữ và nhiều vùng miền, nhiều bộ sinh TTS/
   voice clone, nội dung đọc tương đồng, codec/tiếng ồn áp dụng cho cả hai lớp. Chia theo bản ghi gốc,
   speaker và generator trước khi chọn ngưỡng trên dev; giữ test riêng. Các speaker ID chưa biết phải
   ghi là chưa biết, không giả định chỉ khác tên file là khác speaker.
3. **Dùng trạng thái chưa đủ bằng chứng:** chất lượng thấp, model bất đồng hoặc điểm chưa chắc chắn
   cần UNKNOWN. Chọn vùng không chắc chắn dựa trên dev, rồi đo cả coverage và tỷ lệ báo nhầm/bỏ sót
   trên test; không chỉ báo accuracy trên những ca model chịu chấm điểm.
4. **Sửa kiểm thử hiểu nội dung:** đưa câu phủ định/khuyên bảo, trích dẫn và lời yêu cầu trực tiếp vào
   bộ dev và một bộ test mới. Yêu cầu bằng chứng lời thoại cho từng tactic và kiểm tra lỗi nhận lời.
   Chưa có bằng chứng rằng thêm một câu vào prompt sẽ sửa được trường hợp OTP báo nhầm trong screening.
5. **Sau khi chọn được model:** nạp detector local một lần, warmup rồi nhận PCM 16 kHz; chạy độc lập
   với Gemini. Khi Gemini hết quota vẫn có thể báo riêng kết quả âm học, còn nội dung giữ UNKNOWN.
   Khi model âm học chưa sẵn sàng cũng không sinh điểm giả. Giữ deadline và kiểm tra riêng độ trễ cuối cùng.

Trong một tuần, ưu tiên hoàn thành một luồng đã đo được, cùng tập test độc lập. Hai ứng viên hiện tại
đều có lỗi đã biết; bước tiếp theo là dữ liệu kiểm định, rồi mới quyết định model/threshold để đưa vào UI.

## Chạy lại công cụ đã có

Không cần GPU, torchaudio hoặc dịch vụ trả phí. Dùng venv riêng; các version đã chạy trên macOS arm64,
Python 3.13.7 được ghi trong requirements. Không thêm dependency vào pnpm/Node production.

```bash
python3 -m venv /private/tmp/zeroleak-acoustic-venv
/private/tmp/zeroleak-acoustic-venv/bin/python -m pip install \
  -r apps/sandbox-api/scripts/requirements-voice-eval.txt

/private/tmp/zeroleak-acoustic-venv/bin/python apps/sandbox-api/scripts/evaluate-acoustic.py \
  --backend xlsr --assets /private/tmp/zeroleak-xlsr-probe \
  --manifest /private/tmp/zeroleak-voice-eval/dataset/cases.json \
  --output /private/tmp/voice-xlsr-next.json
```

Thêm `--download` để tải asset còn thiếu theo revision/SHA256 cố định; script không ghi đè file đang có
sai hash. Có thể dùng thư mục assets khác. Chọn `--backend aasist --assets /private/tmp/zeroleak-acoustic-probe`
để đối chiếu AASIST. Cần tạo dataset trước nếu thư mục tạm đã mất, theo [hướng dẫn chuẩn bị](VOICE_EVALUATION.md).
Hai model khác kiến trúc: AASIST lấy/repeat 64.600 samples như upstream; XLS-R dùng toàn cửa sổ đến 5 giây
và normalization của feature extractor. Không coi đầu vào nội bộ của chúng là giống hệt từng sample.

Output phải là file JSON mới, chứa score/nhãn/chỉ số/provenance, không chứa audio hoặc transcript.
Script không đọc `.env`. Chỉ input âm thanh đi vào model, không có nhãn hay tên file trong tensor.
Checkpoint AASIST dùng `weights_only=True`; XLS-R dùng safetensors và không chạy remote custom code.

Kiểm thử công cụ không cần tải model:

```bash
python3 -B -m unittest discover -s apps/sandbox-api/test -p test_acoustic_eval.py
```

4 test kiểm tra phép tính có abstention, mẫu số từng lớp, hash/path của audio và chặn model asset bị sửa
trước khi thực thi. Các test này không đo chất lượng AI.
