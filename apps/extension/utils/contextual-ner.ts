import type {
  DlpDetectionMatch,
  SensitiveDataType,
} from '@zeroleak/shared-types';

/**
 * Common Vietnamese Family Names (Họ)
 */
const VN_FAMILY_NAMES = [
  'Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ',
  'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Đinh', 'Đoàn', 'Lâm',
  'Trịnh', 'Mai', 'Đào', 'Cao', 'Hà', 'Lưu', 'Lương', 'Thái', 'Châu', 'Tạ',
  'Phùng', 'Tô', 'Vương', 'Văn', 'Tăng', 'Quách', 'Nghiêm', 'Triệu', 'La'
];

/**
 * Common Vietnamese Cities & Provinces to avoid false positive PERSON_NAME matches
 */
const VN_LOCATIONS = [
  'Hà Nội', 'Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ',
  'Bình Dương', 'Đồng Nai', 'Quảng Nam', 'Thừa Thiên Huế', 'Khánh Hòa',
  'Việt Nam', 'Cấp tại', 'Nơi cấp', 'Hạn dùng'
];

/**
 * Organization prefix triggers
 */
const ORG_PREFIXES = [
  'Công ty Cổ phần',
  'Công ty TNHH',
  'Công ty TNHH MTV',
  'Công ty Liên doanh',
  'Công ty',
  'Tập đoàn',
  'Tổng công ty',
  'Ngân hàng TMCP',
  'Ngân hàng',
  'Viện',
  'Trường Đại học',
  'Trung tâm',
  'Chi nhánh',
  'Doanh nghiệp tư nhân',
  'Quỹ đầu tư',
  'Bệnh viện',
];

/**
 * Personal name context triggers (honorifics and role indicators)
 */
const PERSON_CONTEXT_TRIGGERS = [
  'ông', 'bà', 'anh', 'chị', 'đại diện', 'người đại diện', 'họ và tên',
  'họ tên', 'chủ tài khoản', 'khách hàng', 'bên a', 'bên b', 'giám đốc',
  'nhân viên', 'luật sư', 'chuyên viên', 'bác sĩ', 'mr', 'ms', 'mrs'
];

/**
 * Regex for Vietnamese capitalized full name (2 to 5 words, strictly within same line)
 */
const VN_NAME_REGEX = /\b([A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯĂẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴÝỶỸ][a-zàáâãèéêìíòóôõùúăđĩũơưăạảấầẩẫậắằẳẵặẹẻẽềềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵýỷỹ]+(?:[^\S\r\n]+[A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯĂẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴÝỶỸ][a-zàáâãèéêìíòóôõùúăđĩũơưăạảấầẩẫậắằẳẵặẹẻẽềềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵýỷỹ]+){1,4})\b/g;

/**
 * Scans for Vietnamese Person Names and Organizations
 * Supports Chrome Built-in AI (Gemini Nano) when available, falling back to local heuristic NER.
 */
export async function scanContextualNer(
  text: string,
  enabledTypes: SensitiveDataType[]
): Promise<DlpDetectionMatch[]> {
  const matches: DlpDetectionMatch[] = [];

  // Try Chrome Built-in AI (window.ai) if enabled and available in user's browser
  const aiMatches = await tryChromeBuiltinAi(text, enabledTypes);
  if (aiMatches && aiMatches.length > 0) {
    return aiMatches;
  }

  // Fallback: Ultra-fast Deterministic & Contextual Heuristic NER (< 5ms)
  if (enabledTypes.includes('PERSON_NAME')) {
    matches.push(...extractPersonNames(text));
  }

  if (enabledTypes.includes('ORGANIZATION')) {
    matches.push(...extractOrganizations(text));
  }

  return matches;
}

/**
 * Heuristic extractor for Vietnamese Person Names
 */
function extractPersonNames(text: string): DlpDetectionMatch[] {
  const results: DlpDetectionMatch[] = [];
  const regex = new RegExp(VN_NAME_REGEX.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const candidate = match[1].trim();
    const words = candidate.split(/[^\S\r\n]+/);

    if (words.length < 2 || words.length > 5) continue;

    // Filter out known cities or locations
    if (VN_LOCATIONS.some((loc) => candidate.toLowerCase().includes(loc.toLowerCase()))) {
      continue;
    }

    // Check if first word is a known Vietnamese family name
    const startsWithVnFamilyName = VN_FAMILY_NAMES.some(
      (family) => family.toLowerCase() === words[0].toLowerCase()
    );

    // Look at previous 35 characters on same line for context clues (ông, bà, họ tên, đại diện...)
    const startContext = Math.max(0, match.index - 35);
    const lineStartIndex = text.lastIndexOf('\n', match.index);
    const effectiveStart = Math.max(startContext, lineStartIndex + 1);
    const prevContext = text.slice(effectiveStart, match.index).toLowerCase();

    const hasContextClue = PERSON_CONTEXT_TRIGGERS.some((trigger) =>
      prevContext.includes(trigger)
    );

    if (startsWithVnFamilyName || (hasContextClue && words.length >= 2)) {
      results.push({
        type: 'PERSON_NAME',
        originalValue: candidate,
        tokenPlaceholder: '[PERSON_NAME_00]',
        startIndex: match.index,
        endIndex: match.index + candidate.length,
        confidence: startsWithVnFamilyName && hasContextClue ? 0.98 : 0.85,
      });
    }
  }

  return results;
}

/**
 * Heuristic extractor for Organizations
 */
function extractOrganizations(text: string): DlpDetectionMatch[] {
  const results: DlpDetectionMatch[] = [];

  for (const prefix of ORG_PREFIXES) {
    // Matches prefix followed by 1 to 6 capitalized words on the SAME LINE
    const pattern = new RegExp(
      `\\b(${prefix}[^\\S\\r\\n]+[-A-Za-z0-9&.ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯĂẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴÝỶỸàáâãèéêìíòóôõùúăđĩũơưăạảấầẩẫậắằẳẵặẹẻẽềềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵýỷỹ]+(?:[^\\S\\r\\n]+[-A-Za-z0-9&.ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯĂẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴÝỶỸàáâãèéêìíòóôõùúăđĩũơưăạảấầẩẫậắằẳẵặẹẻẽềềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵýỷỹ]+){0,5})`,
      'g'
    );

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const orgName = match[1].trim();
      results.push({
        type: 'ORGANIZATION',
        originalValue: orgName,
        tokenPlaceholder: '[ORGANIZATION_00]',
        startIndex: match.index,
        endIndex: match.index + orgName.length,
        confidence: 0.95,
      });
    }
  }

  return results;
}

/**
 * Chrome Built-in AI (window.ai / Prompt API) execution
 */
async function tryChromeBuiltinAi(
  text: string,
  enabledTypes: SensitiveDataType[]
): Promise<DlpDetectionMatch[] | null> {
  try {
    const win = typeof window !== 'undefined' ? (window as any) : null;
    if (!win || !win.ai || !win.ai.languageModel) {
      return null;
    }

    const capabilities = await win.ai.languageModel.capabilities();
    if (capabilities.available === 'no') {
      return null;
    }

    const session = await win.ai.languageModel.create({
      systemPrompt:
        'You are an on-device NER model. Extract any PERSON_NAME or ORGANIZATION entities from the input. Return valid JSON only as array of objects: [{"type":"PERSON_NAME"|"ORGANIZATION", "value":"..."}].',
    });

    const prompt = `Text: "${text.slice(0, 1000)}"`;
    const response = await session.prompt(prompt);
    session.destroy();

    const parsed = JSON.parse(response);
    if (!Array.isArray(parsed)) return null;

    const matches: DlpDetectionMatch[] = [];
    for (const item of parsed) {
      if (!enabledTypes.includes(item.type)) continue;
      const idx = text.indexOf(item.value);
      if (idx !== -1) {
        matches.push({
          type: item.type,
          originalValue: item.value,
          tokenPlaceholder: `[${item.type}_00]`,
          startIndex: idx,
          endIndex: idx + item.value.length,
          confidence: 0.95,
        });
      }
    }
    return matches;
  } catch {
    // Smooth fallback if Chrome Built-in AI is disabled or fails
    return null;
  }
}
