# Voice detector V3 — 2026-11-10

**Cập nhật model:** [Gemini 3.8 Live Extended Thinking](VOICE_LIVE_API.md).
Các phép đo/luồng Flash bên dưới được giữ làm lịch sử; head âm học V3 không thay đổi.

**Cập nhật runtime 2026-11-11:** [Voice followup](VOICE_FOLLOWUP.md). Head V3 giữ nguyên;
ứng viên head/đổi luồng chưa đạt điều kiện thay thế. Số đo phía dưới là lịch sử ngày 2026-11-10.

V3 bổ sung dữ liệu clone tiếng Việt có đoạn tham chiếu riêng, kênh điện thoại mô phỏng và tiếng vọng/nhiễu.
Hai encoder XLS-R/AASIST, VAD, ngưỡng `0.2 / 0.8` và hợp đồng API giữ nguyên; chỉ thay head tuyến tính nhỏ.
Gemini tiếp tục đánh giá nội dung riêng. Không coi điểm âm học thấp là xác minh người gọi.

## Kết quả và quyết định thay model

Đã thử hai ứng viên, với điều kiện phát hành ghi trước mỗi lượt xem test:

1. **Ứng viên 1 bị loại.** Thêm clone Nano và channel augmentation giúp nhóm Nano,
   nhưng trên Turbo chưa dùng để train, số synthetic bị chấm <=0,2 tăng từ 5 lên 11/45.
   Đã giữ V2, lưu đầy đủ kết quả thất bại; không chỉnh ngưỡng bằng test này.
2. **Ứng viên 2 được bổ sung Turbo trong train/calibration.** Chọn các bản ghi và reference chưa dùng
   để có một lượt test mới. Nhóm test đã xem ở lượt 1 trở thành hồi quy; Turbo không còn là generator
   chưa thấy trong huấn luyện. Chỉ chọn regularization trên calibration, đóng băng head rồi mới chấm test mới.

Trên **90 ca từ 15 cặp mới** (`v4-fresh`), gồm 45 human và 45 Turbo synthetic:

- Cảnh báo synthetic: **12/45 → 15/45** từ V2 sang V3.
- Synthetic bị chấm điểm thấp <=0,2: **10 → 6**; synthetic UNKNOWN: **23 → 24**.
- Human bị cảnh báo nhầm: **0/45 ở cả hai bản**; V3 có 5 human UNKNOWN.
- Ngưỡng chẩn đoán 0,5: nhận 17/45 → 28/45 synthetic. Đây không phải ngưỡng cảnh báo của ứng dụng.

Các nhóm hồi quy, cũng ở ngưỡng cảnh báo >=0,8:

- V2 cũ: synthetic 58/64 → **62/64**, 0 synthetic điểm thấp, 2 synthetic UNKNOWN.
- Nano clone của lượt 1: 24/45 → **29/45**; synthetic điểm thấp 2 → 0.
- Turbo của lượt 1: 15/45 → **17/45**; synthetic điểm thấp 5 → 3.
- Không gặp human false alert trong các nhóm này. Không suy ra FPR ngoài thực tế bằng 0.

**Điểm yếu còn rõ:** Turbo mới qua echo/white-noise 15 dB có **0/15 cảnh báo** ở cả V2/V3;
V3 có 13 UNKNOWN và 2 synthetic điểm thấp trong điều kiện đó. V3 cải thiện có giới hạn,
chưa đủ để bảo đảm phát hiện voice clone trong cuộc gọi có nhiễu. Không trình bày kết quả là accuracy 100%.

Head phát hành: `e6206d556dddca31b396dfc7d0f58c1af204dee502e11a98ec7e4dadc12a9f0f`.
Regularization 0,1 được chọn bằng calibration từ lưới cố định `{0.01, 0.1, 1}`.

## Kiểm tra runtime và tích hợp

Đã chạy **398 request ứng viên + 90 request V2 đối chứng** tuần tự qua HTTP thật,
bao gồm Silero VAD và deadline nội bộ 2,8 giây. Điểm/kết luận khớp head đã freeze;
không có lỗi HTTP. Median của bốn nhóm ứng viên khoảng **385–472 ms**, max toàn lượt **2.470 ms**.
Riêng nhóm test mới: median 418 ms, max 607 ms. Không suy ra nhanh hơn V2 từ một lượt timing.
Các số đo không gồm thu âm 5 giây, tải model lúc khởi động, Gemini hoặc mạng ngoài máy.

Head V3 được dùng mặc định bởi lệnh khởi động worker và CLI đánh giá. API tiếp tục đọc kết quả
worker qua loopback; `acousticAnalysis.modelVersion` là SHA256 thật của head. Nhánh fallback local
không còn ghi cứng tên phiên bản V2. Không đổi UI hay hợp đồng kết quả.

20 test backend + 9 test Python, typecheck/build backend và typecheck CLI đều qua.
Smoke test TypeScript dùng worker V3 thật với dependency nội dung được cố ý cho lỗi:
kết quả âm học vẫn được giữ, nội dung UNKNOWN, version đúng SHA của V3. Không gọi Gemini
trong lượt benchmark/smoke này; không tính smoke test vào độ chính xác mô hình.

## Phương pháp dữ liệu

Bộ cuối có **1.222 ca**: 568 train, 256 calibration, 398 test/hồi quy.
V2 đóng góp 448 ca. Lượt 1 thêm 342 ca Nano clone và 90 ca Turbo audit;
lượt 2 thêm 342 ca Turbo, trong đó 90 ca là test từ các bản ghi mới chưa chấm.

- Chỉ dùng read speech công khai VIVOS/FLEURS, speaker ID ẩn danh của dataset và các bộ sinh public.
  Không dùng giọng riêng của người dùng hoặc clone người có danh tính cụ thể.
- VIVOS giữ nhóm 10/4/5 speaker ID cho train/calibration/test. Reference là một đoạn khác target,
  cùng speaker và cùng split. Target/reference mới loại trừ các đoạn đã dùng trước đó.
- Human/synthetic trong mỗi cặp được cắt cùng độ dài `min(human, synthetic, 5s)`, ít nhất 1 giây.
  Không pad độ dài theo nhãn. Từ ngữ trong hai đoạn cắt chưa được căn theo từng thời điểm.
- Cùng phép biến đổi cho hai lớp: clean; highpass 300/lowpass 3400 → 8 kHz mu-law → 16 kHz;
  hoặc echo cố định + band limit + white noise 15 dB với seed theo origin.
- Mỗi nhóm 90 ca chỉ gồm **15 cặp gốc × 2 lớp × 3 điều kiện**, không phải 90 thử nghiệm độc lập.
  Nano/Turbo ở lượt 1 lặp lại các human source, nên không cộng chúng thành bằng chứng độc lập.
- Lượt 2 có target/reference mới nhưng vẫn cùng corpus và cùng 5 test speaker ID. Đây là kiểm tra
  bản ghi mới, không phải kiểm định bên ngoài. Chưa biết giới tính/vùng miền và chưa có người đánh giá
  mức giống giọng của clone. Chưa loại trừ mọi dấu hiệu phụ từ nguồn thu, âm lượng hoặc bộ sinh. VieNeu Nano/Turbo cũng có quan hệ kiến trúc, không đại diện mọi bộ sinh.
- Mean/scale và weights chỉ học từ train; calibration chọn regularization. Head ghi xuống file trước
  khi tạo điểm/test report. Không đổi encoder hoặc ngưỡng theo kết quả test.

Trainer kiểm origin, SHA audio, reference SHA và speaker đã biết không xuyên split.
Báo cáo có từng cohort và từng điều kiện để tránh kết quả tổng che mất nhóm yếu.
Đã tái tạo V2 bằng trainer sửa đổi và thu được đúng SHA256 cũ. Head V3 cũng tái tạo
đúng từng byte từ cache đã chuyển sang thư mục lưu bền vững.

## Chạy và đo lại

Cách cài venv và tải encoder/VAD giữ nguyên trong [hướng dẫn V2](VOICE_DETECTOR_V2.md).
`pnpm dev:voice-detector` mặc định dùng `apps/sandbox-api/models/voice-linear-v3.json`.
Không cần thêm model lớn hoặc thư viện runtime. Chạy V3 bằng hai terminal:

```bash
pnpm dev:voice-detector
pnpm dev:sandbox
```

Head V2 vẫn được giữ để đối chiếu/rollback. Nếu muốn chạy V2, dừng worker đang chiếm port trước,
rồi chạy trực tiếp thay cho lệnh `pnpm dev:voice-detector`:

```bash
"$HOME/Library/Caches/ZeroLeak/voice/venv/bin/python" -B apps/sandbox-api/scripts/voice_acoustic.py \
  --xlsr-assets "$HOME/Library/Caches/ZeroLeak/voice/xlsr" \
  --aasist-assets "$HOME/Library/Caches/ZeroLeak/voice/aasist" \
  --vad "$HOME/Library/Caches/ZeroLeak/voice/silero_vad.jit" \
  --head apps/sandbox-api/models/voice-linear-v2.json --port 8081
```

Không mở thêm dịch vụ trùng port nếu đã chạy. Đo một nhóm qua HTTP, không gọi Gemini:

```bash
python3 -B apps/sandbox-api/scripts/evaluate-voice-runtime.py \
  --manifest "$HOME/Library/Caches/ZeroLeak/voice-evaluation-v3/candidate2/dataset/cases.json" \
  --cohort v4-fresh --output /private/tmp/voice-v3-runtime-new.json
```

Tái tạo head bằng cache public đã lưu, output phải là file mới:

```bash
"$HOME/Library/Caches/ZeroLeak/voice/venv/bin/python" -B apps/sandbox-api/scripts/train-voice-head.py \
  --manifest "$HOME/Library/Caches/ZeroLeak/voice-evaluation-v3/candidate2/dataset/cases.json" \
  --cache "$HOME/Library/Caches/ZeroLeak/voice-evaluation-v3/candidate2/features" \
  --baseline-head apps/sandbox-api/models/voice-linear-v2.json \
  --head-output /private/tmp/voice-v3-head-new.json \
  --report-output /private/tmp/voice-v3-report-new.json
```

Để chuẩn bị dữ liệu khác, dùng venv data riêng với `requirements-voice-data.txt` và ffmpeg:

- `prepare-voice-v3.py select`: chọn target/reference trước khi chấm, với `--vivos-test`,
  `--v2-provenance`, `--v2-manifest`, `--root`; có thể loại trừ lượt trước bằng `--exclude-protocol`.
- `nano`, `pack`, `turbo`: tạo clone và các kênh. Turbo mặc định chỉ test; `--include-development`
  dùng cả train/calibration và phải ghi rõ generator đã được thấy trong development.
- Với lượt 2: `select --prefix v4 --seed 41000 --turbo-development --exclude-protocol <protocol-lượt-1>`;
  sau đó `turbo --include-development --cohort v4-fresh`. Các tham số bắt buộc khác xem `--help`.
- Asset Nano/Turbo/codec phải tải đúng revision/SHA trong provenance. Không dùng model tự đổi theo `main`.
- `combine-voice-data.py --input <cohort>=<cases.json> ... --output <thư-mục-mới>` hợp nhất audio,
  giữ split/nhãn/checksum. Trainer có thể trích feature mới bằng hai tham số encoder assets khi chưa có cache.

Waveform tái sinh có thể khác giữa version/library/platform, dù có seed. Đó là lần thử mới,
không tự nhận là bản sao byte-identical của báo cáo này. Chỉ head tái tạo từ cache cố định mới có thể
đối chiếu byte. Raw audio, reference, voice embedding và cache đặc trưng nằm ngoài Git.

Kiểm tra offline (venv runtime có NumPy/PyTorch; ffmpeg cho channel tests):

```bash
"$HOME/Library/Caches/ZeroLeak/voice/venv/bin/python" -B -m unittest discover \
  -s apps/sandbox-api/test -p 'test_*.py'
```

## Bằng chứng

[Provenance, protocol và SHA asset](evaluations/voice-v3-provenance.json),
[manifest cuối](evaluations/voice-v3-manifest.json),
[ứng viên 1 bị loại](evaluations/voice-v3-candidate1-release.json),
[holdout ứng viên 1](evaluations/voice-v3-candidate1-holdout.json),
[holdout cuối](evaluations/voice-v3-candidate2-holdout.json),
[tiêu chí phát hành cuối](evaluations/voice-v3-candidate2-policy.json),
[kết quả tiêu chí](evaluations/voice-v3-candidate2-release.json),
[đối chiếu HTTP/VAD](evaluations/voice-v3-http-validation.json),
[HTTP test mới](evaluations/voice-v3-http-v4-fresh.json),
[HTTP V2 đối chứng](evaluations/voice-v3-http-baseline-fresh.json),
[kiểm tra tích hợp](evaluations/voice-v3-integration-smoke.json),
[kiểm tra phần mềm](evaluations/voice-v3-verification.json).

Mọi kết quả giới hạn trong dữ liệu nêu trên. Chưa có speaker–microphone replay/call capture vật lý,
chưa kiểm định độc lập, và Test 6 về cuộc gọi giả giọng vẫn chưa được nghiệm thu.
VIVOS có CC-BY-NC-SA-4.0: head tiếp tục mang nhãn experimental/noncommercial research;
chưa xác nhận phù hợp để phát hành thương mại.
