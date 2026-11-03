# 🛡️ ZeroLeak — Bộ Dữ liệu Thử nghiệm Chuẩn (Test Data)

> **Mục đích tài liệu:** File này tập hợp 5 bộ dữ liệu thử nghiệm chuẩn (Test Data) phục vụ cho việc kiểm thử tính năng On-Device DLP, Reversible Tokenization và Threat Analyzer của **ZeroLeak** trên các giao diện chat AI (ChatGPT, Claude, Gemini) hoặc web form bất kỳ.

---

## 📋 Danh sách 5 Bộ Dữ liệu Thử nghiệm

1. [Bộ Data 1: Hợp đồng Doanh nghiệp Tiếng Việt (Full PII & API Key)](#-bộ-data-1-hợp-đồng-doanh-nghiệp-tiếng-việt-full-pii--api-key)
2. [Bộ Data 2: Thẻ Ngân hàng / Tín dụng Quốc tế (Luhn Checksum)](#-bộ-data-2-thẻ-ngân-hàng--tín-dụng-quốc-tế-luhn-checksum)
3. [Bộ Data 3: Khóa Bí mật API Keys (.env Production)](#-bộ-data-3-khóa-bí-mật-api-keys-env-production)
4. [Bộ Data 4: Giả lập AI Phản hồi (Kiểm thử Reversible Restoration)](#-bộ-data-4-giả-lập-ai-phản-hồi-kiểm-thử-reversible-restoration)
5. [Bộ Data 5: Danh sách Link Phishing (Kiểm thử Chuột phải & Sandbox)](#-bộ-data-5-danh-sách-link-phishing-kiểm-thử-chuột-phải--sandbox)

---

## 🏢 Bộ Data 1: Hợp đồng Doanh nghiệp Tiếng Việt (Full PII & API Key)

* **Mục tiêu kiểm thử:**
  * Nhận diện thực thể tiếng Việt (Contextual NER): Tên người (`[ZL_PER_...]`), Tên công ty/tổ chức (`[ZL_ORG_...]`).
  * Regex CCCD Việt Nam 12 số (`[ZL_CCCD_...]`).
  * Regex Số điện thoại Việt Nam (`[ZL_PHONE_...]`).
  * Regex Email (`[ZL_EMAIL_...]`).
  * Regex API Secret (`[ZL_KEY_...]`).

### Đoạn văn bản Copy & Paste:
```text
CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc

HỢP ĐỒNG KINH TẾ DỊCH VỤ AN NINH MẠNG
Hôm nay, ngày 01 tháng 11 năm 2026, chúng tôi gồm có:

BÊN A (Bên giao dịch): Công ty Cổ phần Công nghệ An ninh mạng ZeroLeak
- Người đại diện: ông Nguyễn Văn An
- Chức vụ: Giám đốc điều hành
- Số CCCD: 048099001234, Cấp tại: Cục Cảnh sát QLHC về TTXH
- Số điện thoại: 0912345678
- Email: an.nguyen@zeroleak.vn

BÊN B (Đối tác ủy quyền): Tập đoàn Viễn thông FPT
- Người đại diện: bà Trần Thị Mai
- Chức vụ: Trưởng phòng Hệ thống
- Số CCCD: 001198005678, Cấp tại: Hà Nội
- Số điện thoại: 0987654321
- Khóa bí mật Google Cloud API: AIzaSyBpgQXc2Mcjs9NBfcnrTbd5kFpF0s8bn4Y
```

### 👉 Kết quả mong đợi trên trình duyệt:
* Xuất hiện thông báo Toast màu xanh ngọc: **"ZeroLeak: Đã mã hóa PII"**.
* Phù hiệu **Telemetry Badge** ở góc trái hiển thị độ trễ $< 15\text{ ms}$.
* Văn bản tự động được thay thế an toàn thành:
```text
CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc

HỢP ĐỒNG KINH TẾ DỊCH VỤ AN NINH MẠNG
Hôm nay, ngày 01 tháng 11 năm 2026, chúng tôi gồm có:

BÊN A (Bên giao dịch): [ZL_ORG_01]
- Người đại diện: ông [ZL_PER_01]
- Chức vụ: Giám đốc điều hành
- Số CCCD: [ZL_CCCD_01], Cấp tại: Cục Cảnh sát QLHC về TTXH
- Số điện thoại: [ZL_PHONE_01]
- Email: [ZL_EMAIL_01]

BÊN B (Đối tác ủy quyền): [ZL_ORG_02]
- Người đại diện: bà [ZL_PER_02]
- Chức vụ: Trưởng phòng Hệ thống
- Số CCCD: [ZL_CCCD_02], Cấp tại: Hà Nội
- Số điện thoại: [ZL_PHONE_02]
- Khóa bí mật Google Cloud API: [ZL_KEY_01]
```

---

## 💳 Bộ Data 2: Thẻ Ngân hàng / Tín dụng Quốc tế (Luhn Checksum)

* **Mục tiêu kiểm thử:** Thuật toán kiểm tra số thẻ hợp lệ **Luhn Checksum** ($\sum \text{digits} \pmod{10} = 0$). Chỉ mã hóa thẻ hợp lệ, không chặn nhầm chuỗi số ngẫu nhiên.

### Đoạn văn bản Copy & Paste:
```text
Kính gửi bộ phận thanh toán,
Tôi gửi thông tin thanh toán nâng cấp tài khoản bảo mật:
- Chủ thẻ: ông Lê Hoàng Nam
- Số thẻ Visa thanh toán quốc tế: 4532-0150-1234-5671
- Số thẻ Mastercard dự phòng: 5500-0000-0000-0004
- Số điện thoại đăng ký SMS OTP: 0905123456
- Số CCCD chủ thẻ: 079095009876
```

### 👉 Kết quả mong đợi trên trình duyệt:
* Thẻ Visa `4532-0150-1234-5671` và thẻ Mastercard `5500-0000-0000-0004` (vượt qua thuật toán Luhn) được mã hóa thành `[ZL_CARD_01]` và `[ZL_CARD_02]`.
* Tên chủ thẻ được mã hóa thành `[ZL_PER_01]`.
* Số CCCD được mã hóa thành `[ZL_CCCD_01]`.
* *(Thử nghiệm phụ: Nếu đổi số cuối của thẻ `5671` thành `5670`, thẻ sẽ không bị mã hóa vì vi phạm thuật toán Luhn).*

---

## 🔑 Bộ Data 3: Khóa Bí mật API Keys (.env Production)

* **Mục tiêu kiểm thử:** Thuật toán tính độ hỗn loạn **Shannon Entropy** ($H(X) > 4.5$) kết hợp regex bắt các định dạng API Key phổ biến (OpenAI Project Key `sk-proj-...`, Google Cloud `AIza...`, GitHub Token `ghp_...`, AWS Access Key `AKIA...`).

### Đoạn văn bản Copy & Paste:
```text
# Cấu hình biến môi trường Production (TUYỆT ĐỐI BẢO MẬT)
GOOGLE_API_KEY=AIzaSyBpgQXc2Mcjs9NBfcnrTbd5kFpF0s8bn4Y
OPENAI_API_KEY=sk-proj-9mKlA8xQzT3vBnM1pL5rStU7wXyZ0123456789abcdef
GITHUB_ACCESS_TOKEN=ghp_3a7b9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
```

### 👉 Kết quả mong đợi trên trình duyệt:
* Toàn bộ 4 khóa bí mật đều bị chặn tức thì:
```text
# Cấu hình biến môi trường Production (TUYỆT ĐỐI BẢO MẬT)
GOOGLE_API_KEY=[ZL_KEY_01]
OPENAI_API_KEY=[ZL_KEY_02]
GITHUB_ACCESS_TOKEN=[ZL_KEY_03]
AWS_ACCESS_KEY_ID=[ZL_KEY_04]
```

---

## 🔄 Bộ Data 4: Giả lập AI Phản hồi (Kiểm thử Reversible Restoration)

* **Mục tiêu kiểm thử:** Kiểm tra cơ chế khôi phục hai chiều bằng **MutationObserver**.
* **Cách thực hiện:**
  1. Sau khi đã dán Bộ 1 hoặc Bộ 3 ở bước trên vào ô chat (để Token Vault lưu ánh xạ vào bộ nhớ).
  2. Bấm gửi để ChatGPT/Gemini sinh câu trả lời, HOẶC yêu cầu AI trả lời có chứa các nhãn: `[ZL_PER_01]`, `[ZL_CCCD_01]`, `[ZL_KEY_01]`.
  3. Hoặc bạn có thể yêu cầu AI như sau:

### Câu lệnh prompt yêu cầu AI trả về token:
```text
Hãy xác nhận lại thông tin nhân sự sau đây theo đúng mẫu:
"Hồ sơ của cán bộ [ZL_PER_01] mang số CCCD [ZL_CCCD_01] đã được kích hoạt khóa truy cập [ZL_KEY_01]."
```

### 👉 Kết quả mong đợi trên trình duyệt:
* Khi AI in ra câu trả lời có chứa `[ZL_PER_01]`, `[ZL_CCCD_01]`, `[ZL_KEY_01]`:
* ZeroLeak **tự động biến các nhãn đó trở lại thành tên, CCCD và key thật** trên màn hình của bạn.
* Dữ liệu thật được bọc trong **Badge xanh lá có biểu tượng ổ khóa 🔒**.
* Rê chuột vào nhãn sẽ hiện Tooltip: 
  `🛡️ Đã khôi phục cục bộ bởi ZeroLeak (CCCD Việt Nam) - Dữ liệu thật chỉ hiển thị trên máy bạn`.
* **Guardrail cốt lõi:** Ô nhập liệu của bạn không bao giờ bị khôi phục để tránh gửi nhầm dữ liệu thật ở lượt chat kế tiếp.

---

## 🚨 Bộ Data 5: Danh sách Link Phishing (Kiểm thử Chuột phải & Sandbox)

* **Mục tiêu kiểm thử:** Tính năng kiểm tra đường dẫn độc hại và mạo danh thương hiệu (Visual Brand Impersonation) qua Context Menu chuột phải.
* **Cách thực hiện:** Nhấp chuột phải vào bất kỳ đường link nào bên dưới $\rightarrow$ Chọn **"🛡️ Kiểm tra liên kết với ZeroLeak"**:

| Loại Đường Dẫn | URL Mẫu để Thử nghiệm | Kết quả Phân tích Mong đợi |
| :--- | :--- | :--- |
| **Giả mạo Vietcombank** | `https://vcb-digibank-confirm.top/login.php` | 🚨 **MALICIOUS** (100/100) — Mạo danh *Vietcombank DigiBank*, cảnh báo tên miền `.top` |
| **Giả mạo Facebook** | `http://fb-login-security-update.xyz` | 🚨 **MALICIOUS** (100/100) — Mạo danh *Facebook / Meta Login*, đuôi `.xyz` |
| **Truy cập IP Trực tiếp** | `http://192.168.1.100/vneid-login` | ⚠️ **SUSPICIOUS** (60/100) — Cảnh báo truy cập trực tiếp qua địa chỉ IP |
| **Cổng Ngân hàng Thật** | `https://vietcombank.com.vn` | 🛡️ **SAFE** (5/100) — Tên miền chính thức an toàn |

### 👉 Kết quả mong đợi trên trình duyệt:
* Xuất hiện thông báo Toast: **"ZeroLeak Threat Scanner: Đang kiểm tra mức độ an toàn..."**.
* Sau $< 2.5\text{ s}$ (hoặc tức thì qua Local Fallback), cửa sổ Modal Shadow DOM trồi lên hiển thị:
  * Điểm rủi ro (Risk Score) kèm nhãn đỏ/vàng/xanh.
  * Tên thương hiệu bị mạo danh (*Vietcombank DigiBank* hoặc *Meta*).
  * Danh sách các chỉ số bất thường (Suspicious Indicators).
