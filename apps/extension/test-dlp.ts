import { scanMultiLayerDlp, isValidLuhn } from './utils/deterministic-dlp';

async function test() {
  const card = '4532-0150-1234-5671';
  console.log(`Luhn check for ${card}: ${isValidLuhn(card)}`);

  const contract = `CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
HỢP ĐỒNG KINH TẾ DỊCH VỤ AN NINH MẠNG
Bên A: Công ty Cổ phần Công nghệ An ninh mạng ZeroLeak
Đại diện bởi ông: Nguyễn Văn An - Chức vụ: Giám đốc
Số CCCD: 048099001234, Cấp tại: Đà Nẵng
Số điện thoại: 0912345678, Email: an.nguyen@zeroleak.vn

Bên B: Tập đoàn Viễn thông FPT
Đại diện bởi bà: Trần Thị Mai - Chức vụ: Trưởng phòng IT
Số CCCD: 001198005678, Cấp tại: Hà Nội
Thông tin thanh toán thẻ tín dụng: 4532-0150-1234-5671 (Thẻ Visa hợp lệ)
API Secret Production: AIzaSyBpgQXc2Mcjs9NBfcnrTbd5kFpF0s8bn4Y`;

  console.log('\n--- STARTING DLP MULTI-LAYER SCAN TEST ---');
  const res = await scanMultiLayerDlp(contract, [
    'VN_CCCD',
    'CREDIT_CARD',
    'API_SECRET',
    'PHONE_VN',
    'EMAIL',
    'PERSON_NAME',
    'ORGANIZATION',
  ]);

  console.log(`Scan completed in ${res.scanLatencyMs} ms`);
  console.log(`Entropy Max: ${res.entropyMax}`);
  console.log(`Total sensitive matches found: ${res.matches.length}`);
  for (const m of res.matches) {
    console.log(`  - [${m.type}] ${m.tokenPlaceholder} -> "${m.originalValue}" (confidence: ${m.confidence})`);
  }

  console.log('\n--- SANITIZED TEXT RESULT ---');
  console.log(res.sanitizedText);
}

test();
