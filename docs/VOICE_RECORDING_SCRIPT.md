# Kịch bản quay demo đầy đủ ZeroLeak Voice Pro

Kịch bản này dùng bản **hybrid**: Gemini 3.8 Live Extended Thinking phân tích nội dung; detector local V3 phân tích giọng tổng hợp. Chuẩn bị trước, sau đó quay theo đúng 8 case dưới đây, khoảng 7–9 phút tùy thời gian dịch vụ. Đọc kết quả thật trên màn hình; không yêu cầu một điểm số cố định hoặc dựng lại output.

Đã gom 7 audio có tên dễ chọn, trang phát và provenance vào:

`/Users/quangkimle/Library/Caches/ZeroLeak/voice-recording-demo-20261113/`

Thư mục chọn file:

`/Users/quangkimle/Library/Caches/ZeroLeak/voice-recording-demo-20261113/audio/`

Trang phát chỉ phát WAV và không gọi Google/giả lập kết quả. Nguồn, SHA và thời lượng ở `sources.json`. Các file VIVOS/clone và file 15 giây là dữ liệu kiểm thử có nguồn/điều kiện sử dụng đi kèm, không phải bản thu lừa đảo thực tế. Giữ provenance khi sử dụng và không đưa raw audio vào repo.

## A. Chuẩn bị trước khi bấm quay

### 1. Chuẩn bị màn hình và thu âm video

Máy hiện tại có OBS. Dùng OBS để có cả tiếng thuyết minh và tiếng audio phát từ Chrome:

1. Mở OBS Studio. Trong **Sources**, thêm **macOS Screen Capture**, chọn màn hình sẽ quay. Trên macOS 13+, nguồn này hỗ trợ cả âm thanh màn hình. Kiểm tra thanh âm lượng của nguồn có chạy khi phát audio.
2. Dùng **một nguồn microphone duy nhất** để thu lời thuyết minh: nếu Mic/Aux đã thu đúng mic thì dùng nó; nếu chưa, thêm Audio Input Capture và chọn mic. Tránh thêm cùng mic hai lần.
3. Vì Screen Capture có thể đã thu tiếng Chrome, không thêm trùng nguồn âm thanh hệ thống khiến bị vọng. Kiểm tra video 10 giây trước khi quay thật: phải nghe được lời bạn và file mẫu, không nhân đôi tiếng.
4. Đặt video khoảng 1920×1080, 30 fps; tăng zoom Chrome nếu chữ quá nhỏ. Dùng tai nghe để tiếng file không lọt lại vào mic.
5. Tắt thông báo và đóng nội dung riêng tư. Không mở `.env`, API key hay mật khẩu trên phần màn hình ghi hình.

Tham khảo [OBS macOS Screen Capture](https://obsproject.com/kb/macos-screen-capture-source) và [hướng dẫn thu âm desktop chính thức](https://obsproject.com/kb/macos-desktop-audio-capture-guide). Thiết lập quay là việc bạn thực hiện; không có thao tác tự ghi micro của bạn trong bước chuẩn bị này.

### 2. Terminal 1: build và mở dịch vụ Voice

Nếu đang chạy backend/worker cũ tại 8080/8081, dừng đúng terminal đó bằng Ctrl+C. Trong Terminal 1:

```bash
cd /Users/quangkimle/Documents/code/ZeroLeak
pnpm build:extension
pnpm dev:voice-pro
```

Đợi dòng có **[Voice Pro] Sẵn sàng tại http://127.0.0.1:8080**. Giữ terminal này chạy. Lệnh Pro tự nạp detector, warmup rồi mở API; không cần mở worker bằng lệnh khác. Key được đọc từ `.env` đã cấu hình trước khi quay.

### 3. Terminal 2: kiểm tra và mở trang audio

```bash
cd /Users/quangkimle/Documents/code/ZeroLeak
pnpm check:voice-demo --strategy hybrid
```

Cần thấy `"passed": true`. Đây chỉ là kiểm tra cấu hình, không xác minh quota hay chất lượng Gemini. Sau đó, trong cùng Terminal 2:

```bash
python3 -m http.server 18083 --bind 127.0.0.1 --directory "$HOME/Library/Caches/ZeroLeak/voice-recording-demo-20261113"
```

Giữ Terminal 2 chạy. Hai terminal này là đủ cho kịch bản.

### 4. Mở extension đúng bản

1. Mở Chrome, vào `chrome://extensions`.
2. Bật **Developer mode**.
3. Nếu đã cài đúng bản: bấm **Reload**. Nếu chưa: **Load unpacked**, chọn thư mục sau. Có thể dùng Cmd+Shift+G trong hộp chọn để dán đường dẫn:

```text
/Users/quangkimle/Documents/code/ZeroLeak/apps/extension/.output/chrome-mv3
```

4. Bấm biểu tượng ZeroLeak trên thanh công cụ → **Bảo vệ cuộc gọi — ZeroLeak Voice**.
5. Trong Voice, mở **Kết nối dịch vụ**, kiểm tra địa chỉ `http://127.0.0.1:8080`. Nhập mã truy cập nếu bạn đã cấu hình `VOICE_API_TOKEN`; sau đó thu gọn mục này.
6. Mở tab thứ hai: `http://127.0.0.1:18083/`. Tiêu đề tab là **ZeroLeak Voice — Audio Demo**. Thử phát mẫu 02 rồi bấm **Dừng tất cả** để kiểm tra tiếng.
7. Quay về Voice. Các ca chọn file không cần bấm Bắt đầu kiểm tra; nút đó chỉ dùng thu tab/micro.

### 5. Diễn tập một lượt trước khi quay

Chạy thử các case, nhất là micro và tab vì phụ thuộc quyền thiết bị. File đã được dùng kiểm tra trước đây nhưng lần gọi Gemini mới vẫn có thể khác. Nếu UNKNOWN/lỗi thì ghi nhận chưa kết luận, không tính thành ca nhận diện đúng.

Khi quay chính, bạn có thể bắt đầu ở trang Voice đã sẵn sàng. Phần build/warmup làm trước; nếu muốn chứng minh dịch vụ đang chạy, cho xem dòng Sẵn sàng vài giây rồi trở lại Chrome. Khi chờ kết quả, giữ khung Đang phân tích; nếu dựng video nhanh hơn thì ghi rõ đã cắt/tăng tốc thời gian chờ.

## B. Quy tắc chung khi chạy các ca file

- Để khán giả nghe mẫu, phát nó ở tab audio rồi dừng. Sau đó sang Voice bấm **Chọn file thử**.
- Trong hộp chọn file macOS, bấm **Cmd+Shift+G**, dán thư mục audio ở đầu tài liệu, Enter rồi chọn file theo tên.
- Hệ thống đọc file, hiện Đang phân tích rồi trả kết quả. Chờ tối đa khoảng 15 giây xử lý; không bấm nhiều lần khi còn đang chờ.
- Nhìn riêng: kết luận/rủi ro **nội dung**, khung **Giọng nói · kiểm tra trên máy**, và trích dẫn lời thoại.
- Mỗi lần chọn file mới sẽ bắt đầu một phiên mới, xóa lịch sử trước đó. Việc giữ cảnh báo giữa hai đoạn phải kiểm tra bằng chế độ liên tục ở case 8.
- Không bấm Bắt đầu kiểm tra sau khi chọn file vì đó là một thao tác thu âm mới. Upload file không tự phát tiếng; dùng tab audio để nghe.

## C. Kịch bản quay, lời nói và thao tác

### Mở đầu — khoảng 15 giây

Để Voice ở trạng thái sẵn sàng. Nói:

> Đây là ZeroLeak Voice. Nhóm em kiểm tra hai rủi ro độc lập: nội dung có dấu hiệu lừa đảo và âm thanh có dấu hiệu giọng tổng hợp. Gemini phụ trách nội dung; detector âm học chạy trên máy phụ trách giọng nói. Em sẽ demo bằng file, micro và âm thanh từ tab Chrome.

### Case 1 — Đối chiếu người thật và voice clone mô phỏng

**Mục tiêu:** cho thấy phần âm học nhận hai loại dữ liệu khác nhau, không xác minh danh tính.

1. Chọn file `01-nguoi-that.wav`.
2. Chờ kết quả. Mục tiêu phần âm học: **Chưa thấy bằng chứng giọng tổng hợp**. Nội dung có thể ít rủi ro; nếu UNKNOWN thì chưa đủ kết luận nội dung.
3. Chỉ vào khung giọng nói. Nói:

> Đây là một bản ghi người thật từ nguồn VIVOS công khai. Điểm thấp chỉ có nghĩa mô hình chưa thấy bằng chứng giọng tổng hợp; nó không xác minh người gọi là ai.

4. Chọn `07-voice-clone-mo-phong.wav`, bản tạo bằng VieNeu-Turbo từ cùng nguồn đối chiếu.
5. Mục tiêu phần âm học: **Có dấu hiệu giọng tổng hợp**. Không yêu cầu nội dung phải SAFE; lượt đã kiểm tra trước từng gặp lỗi Gemini nhưng vẫn giữ được cảnh báo local.
6. Nói:

> Bản tiếp theo là voice clone mô phỏng từ dữ liệu công khai, không phải cuộc gọi thật. Nhánh âm học có thể cảnh báo riêng. Nếu nội dung chưa đủ thông tin hoặc dịch vụ nội dung lỗi, hệ thống vẫn giữ kết quả âm học và không tự gán nội dung là an toàn.

Nếu không có cảnh báo trong lượt mới, đó là một ca chưa đạt mục tiêu âm học, không thay bằng kết quả khác để trình bày như lượt vừa chạy.

### Case 2 — Giọng AI nhưng nội dung bình thường

1. Chọn `02-ai-noi-binh-thuong.wav`. Mẫu nói về lịch hẹn tới ngân hàng.
2. Chờ kết quả mục tiêu:
   - Nội dung: **Chưa thấy kịch bản lừa đảo**, thường 0 điểm.
   - Giọng nói: **Có dấu hiệu giọng tổng hợp**.
3. Nói:

> Giọng này được tổng hợp bằng AI, nhưng nội dung là một lịch hẹn bình thường. Hai kết quả được tách biệt để tránh coi mọi giọng AI là lừa đảo.

Đọc số thực tế đang hiện. Điểm detector không phải phần trăm chắc chắn hoặc accuracy.

### Case 3 — Giả danh ngân hàng để lấy mật khẩu

1. Chọn `03-doi-mat-khau.wav`.
2. Mẫu nói: “Tôi từ ngân hàng, gửi mật khẩu để mở khóa tài khoản.” Đây là lời mô phỏng, không chứa mật khẩu thật.
3. Mục tiêu:
   - **Có dấu hiệu cần thận trọng** hoặc **Nguy cơ lừa đảo qua cuộc gọi**.
   - Có tactic yêu cầu OTP/mật khẩu; có thể kèm giả danh cơ quan/ngân hàng.
   - Có quote/lời thoại cho người dùng kiểm tra.
4. Nói:

> Hệ thống cảnh báo vì có yêu cầu cung cấp mật khẩu và mạo danh ngân hàng. Em có thể xem phần lời thoại và bằng chứng cho cảnh báo, thay vì chỉ nhận một điểm số.

Không yêu cầu đúng 90/95 điểm hoặc đúng mọi tactic ở mọi lần gọi; đánh giá theo kết luận và bằng chứng thực tế.

### Case 4 — Giả danh lãnh đạo, yêu cầu chuyển tiền gấp

1. Chọn `04-gia-danh-lanh-dao.wav`.
2. Mẫu: “Giám đốc đây, chuyển khoản gấp, không gọi lại xác minh.”
3. Mục tiêu: có cảnh báo nội dung, với dấu hiệu giả danh lãnh đạo/thúc ép hành động và quote hỗ trợ.
4. Nói:

> Chức danh giám đốc không đủ để kết luận lừa đảo. Điểm đáng ngờ ở đây là yêu cầu chuyển tiền gấp và ngăn người nghe gọi lại xác minh.

Giọng mẫu là TTS đọc kịch bản, không khẳng định đã clone một lãnh đạo có thật.

### Case 5 — Có nhắc mã xác thực nhưng là lời từ chối

1. Chọn `05-tu-choi-cung-cap-ma.wav`.
2. Mẫu: “Tôi sẽ không cung cấp mã xác thực cho bất cứ ai.”
3. Mục tiêu: **Chưa thấy kịch bản lừa đảo** về nội dung; phần âm học vẫn có thể cảnh báo vì đây là TTS.
4. Nói:

> Đây là lời từ chối cung cấp mã. Hệ thống cần hiểu ý nghĩa và phủ định, thay vì thấy từ khóa rồi báo lừa đảo. Phần giọng nói được đánh giá độc lập.

UNKNOWN không phải là một kết luận đúng cho mục tiêu SAFE của ca này; nếu gặp thì ghi chưa kết luận.

### Case 6 — File 15 giây có TTS ở phần cuối

1. Chọn `06-file-15s-ai-o-cuoi.wav`.
2. Nói trong lúc chờ:

> Đây là file kiểm thử ghép có chủ đích:10 giây đầu là các đoạn người thật công khai,5 giây cuối có TTS. Em dùng nó để kiểm tra việc hệ thống đọc toàn bộ file.

3. Kiểm tra khung âm học có thông tin **15.0 giây, chia thành 3 đoạn** và mục tiêu **Có dấu hiệu giọng tổng hợp**.
4. Nói:

> File được kiểm tra theo từng đoạn ngắn, có giữ phần cuối. Điểm hiển thị là mức cao nhất từ các đoạn có bằng chứng, không phải xác suất toàn bộ cuộc gọi là giả.

Không yêu cầu nội dung của file ghép phải SAFE hoặc scam; mục tiêu case này là phạm vi15 giây và dấu hiệu âm học. UI chưa định vị chính xác timestamp giọng giả, nên không mô tả nó đã chỉ ra thời điểm10 giây.

### Case 7 — Micro thật, tự dừng sau 5 giây

1. Đảm bảo tab audio đã dừng, đeo tai nghe; Chrome dùng đúng micro.
2. Trong Voice chọn **Micro của bạn** → **Một đoạn 5 giây**.
3. Bấm **Bắt đầu kiểm tra**, chọn **Allow/Cho phép** khi Chrome yêu cầu. Nếu macOS yêu cầu quyền micro, cấp cho Chrome và thử lại.
4. Chờ giao diện báo đang nhận âm thanh, nói ngay một lần:

> Đọc mã OTP cho tôi ngay để xác minh tài khoản.

5. Ngừng nói. Để ứng dụng tự dừng thu sau 5 giây và chờ phân tích, không bấm Hủy phân tích.
6. Mục tiêu: có sóng âm, thanh thời lượng tăng, tự chuyển sang phân tích, rồi cảnh báo nội dung yêu cầu OTP/mật khẩu.
7. Khi đã dừng thu, mới thuyết minh:

> Đây là giọng người thật đang đọc một kịch bản thử nghiệm. Rủi ro nội dung được kiểm tra độc lập với dấu hiệu giọng tổng hợp. Hệ thống tự dừng sau đoạn thu để người dùng biết lúc nào bắt đầu chờ kết quả.

Không vừa đọc câu mẫu vừa nói “đây là ví dụ chống lừa đảo” trong 5 giây đó: như vậy bạn đang đổi ngữ nghĩa của đầu vào. Ca mic thật cần diễn tập riêng; detector có thể UNKNOWN hoặc cảnh báo nhầm vì nhiễu/thiết bị. Không dùng điểm của ca này như xác minh danh tính.

### Case 8 — Tab Chrome và giữ cảnh báo trong cùng phiên

**Mục tiêu:** mô phỏng nghe audio từ ứng dụng trong trình duyệt và giữ bằng chứng sau đoạn ít rủi ro. Mẫu vẫn là audio mô phỏng, không gọi điện thật.

1. Mở tab `http://127.0.0.1:18083/`, bấm **Dừng tất cả**. Giữ âm lượng player mặc định 100%; điều chỉnh âm lượng tai nghe nếu cần.
2. Sắp Voice và trang phát cạnh nhau nếu thuận tiện. Quay về Voice chọn **Âm thanh từ tab** → **Theo dõi liên tục**.
3. Bấm **Bắt đầu kiểm tra**. Trong hộp chia sẻ chọn **Thẻ Chrome/Chrome Tab**, chọn đúng **ZeroLeak Voice — Audio Demo**, bật **Chia sẻ âm thanh/Also share tab audio**, rồi Share.
4. Không chọn màn hình hoặc cửa sổ trong hộp chia sẻ của Voice; ứng dụng sẽ từ chối. Việc OBS quay màn hình là luồng riêng và không quyết định nguồn thu của Voice.
5. Chờ một cửa sổ thu 5 giây mới bắt đầu: thanh thời lượng vừa quay về đầu, hoặc tổng thời gian vừa qua5/10/15 giây. Bấm **Phát từ đầu** cho mẫu 03 ngay đầu cửa sổ. Mẫu dài khoảng 3,2 giây để câu không bị cắt qua ranh giới.
6. Quay về Voice chờ cảnh báo nội dung. Có thể mất5 giây gom audio cộng tối đa 8 giây xử lý cho mỗi yêu cầu. Nếu còn hàng đợi thì tổng chờ dài hơn.
7. Giữ nguyên phiên đang thu. Khi cửa sổ mới bắt đầu, sang trang audio phát mẫu 02, rồi quay lại Voice. **Không chọn file mới, không bấm Bắt đầu kiểm tra mới giữa hai mẫu.**
8. Mục tiêu: kết quả gần nhất của mẫu 02 có thể ít rủi ro, nhưng **Phiên này đã có cảnh báo** vẫn giữ quote/điểm của mẫu 03. Mở **Diễn biến phiên kiểm tra → Xem chi tiết lượt…** cho khán giả xem hai đoạn.
9. Bấm **Dừng thu và phân tích**, đợi xong đoạn đang chờ. Bấm Dừng tất cả bên trang audio. Không dùng Hủy phân tích để kết thúc khi vẫn muốn nhận kết quả.
10. Nói:

> Trong cùng phiên, đoạn sau ít rủi ro không làm mất bằng chứng của đoạn đáng ngờ trước đó. Đây là ghi nhớ các kết quả đã có, không phải cộng điểm hay kết luận toàn bộ cuộc gọi là lừa đảo.

Nếu chọn nhầm nguồn và sóng âm không chạy, dừng thu và chọn lại tab có chia sẻ âm thanh. Nếu câu bị chia đôi, thử lại một cửa sổ mới và ghi rõ đó là lượt thử mới. Chế độ liên tục có thể bỏ qua đoạn khi dịch vụ bận; UI sẽ thông báo, không tuyên bố đã bao phủ toàn bộ cuộc gọi.

### Kết thúc — khoảng 15 giây

> Voice đã hỗ trợ kiểm tra bằng file, micro và âm thanh từ tab; tách rủi ro nội dung khỏi dấu hiệu giọng tổng hợp và giữ lịch sử để người dùng xem lại. Đây là cảnh báo hỗ trợ xác minh. Nhóm em tiếp tục kiểm định thêm với tiếng Việt và điều kiện cuộc gọi thực tế, nhất là khi có nhiễu.

Không dùng các câu “chặn được mọi deepfake”, “100% chính xác” hoặc “đã xác minh đúng người gọi”. Các mẫu đã chuẩn bị không phải bằng chứng chất lượng cho mọi giọng, vùng miền hoặc bộ sinh mới.

## D. Xử lý nhanh nếu có lỗi khi diễn tập

- **Cổng 8080/8081 đang dùng:** Ctrl+C tại đúng terminal dịch vụ cũ, chạy lại Pro. Không khởi động thêm nhiều backend.
- **Chọn file nhưng không nghe tiếng:** upload để phân tích không tự phát audio; nghe mẫu ở trang player trước.
- **Không có sóng mic:** kiểm tra quyền mic của Chrome và đúng thiết bị đầu vào; thu lại ở nơi yên tĩnh.
- **Tab không có sóng:** chọn Chrome Tab và bật chia sẻ âm thanh. Đổi sang nguồn màn hình/cửa sổ không sửa được việc này.
- **UNKNOWN/lỗi nội dung nhưng local có cảnh báo:** đây là hai nhánh độc lập. Đọc đúng lý do hiện trên UI, dừng thu và đợi trước khi thử lại. Checker passed không có nghĩa key/quota luôn tốt.
- **Lịch sử mất khi đổi file:** đúng thiết kế, mỗi file là phiên mới. Dùng case8 để kiểm tra giữ cảnh báo.
- **File 15 giây không có thông tin3đoạn:** kiểm tra đang chạy Pro, build/reload đúng extension và chọn đúng file 06.
- **Video không nghe tiếng Chrome hoặc bị vọng:** xem lại10 giây ghi thử trong OBS; kiểm tra nguồn Screen Capture và tránh ghi trùng âm thanh/micro.

## E. Checklist kết thúc diễn tập

- [ ] Pro sẵn sàng; checker hybrid passed; extension đúng thư mục build.
- [ ] Hai bản người thật/clone được trình bày đúng nguồn và giới hạn.
- [ ] AI nói bình thường không tự bị gán scam.
- [ ] Mật khẩu và chuyển tiền có cảnh báo nội dung/bằng chứng.
- [ ] Lời từ chối không bị đánh đồng với yêu cầu lấy mã.
- [ ] File 15 giây được báo đúng phạm vi3đoạn.
- [ ] Micro thật có sóng, tự dừng và trả kết quả.
- [ ] Tab thu được audio; cảnh báo trước còn khi đoạn sau ít rủi ro.
- [ ] Dừng thu sau ca cuối; video nghe được cả lời nói lẫn audio mẫu.

Đây là checklist bạn thực hiện; việc chuẩn bị player không có nghĩa các ca micro/tab mới đã được chạy thay bạn. Raw audio ở cache ngoài Git. Hướng dẫn kiến trúc/đánh giá: [VOICE_PRO.md](VOICE_PRO.md).
