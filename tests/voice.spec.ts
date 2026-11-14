import { test, expect } from 'playwright/test';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encodeVoiceWav } from '../apps/extension/utils/voice-audio';

let context: BrowserContext;
let temp: string;
let page: Page;
let extensionId: string;

const fixtureWav = () => Buffer.from(encodeVoiceWav(Float32Array.from({ length: 80000 }, (_, i) => Math.sin(2 * Math.PI * (220 * i / 16000 + 20 * (i / 16000) ** 2)) * .25)));

test.beforeEach(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'zeroleak-voice-e2e-'));
  const audioPath = path.join(temp, 'input.wav');
  await writeFile(audioPath, fixtureWav());
  const extension = path.resolve('apps/extension/.output/chrome-mv3');
  context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
    headless: false,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--auto-accept-camera-and-microphone-capture', '--use-fake-device-for-media-stream',
      '--auto-select-tab-capture-source-by-title=ZeroLeak Voice Test Source',
      `--use-file-for-fake-audio-capture=${audioPath}`, '--autoplay-policy=no-user-gesture-required'],
    viewport: { width: 1200, height: 900 },
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ zeroleak_voice_settings: { apiBase: 'http://127.0.0.1:18080', token: '' } });
  });
  await context.addInitScript(() => {
    const state = window as Window & { voiceTestStreams?: MediaStream[] };
    state.voiceTestStreams = [];
    for (const method of ['getUserMedia', 'getDisplayMedia'] as const) {
      const original = navigator.mediaDevices[method].bind(navigator.mediaDevices);
      Object.defineProperty(navigator.mediaDevices, method, { configurable: true, writable: true, value: async (options: MediaStreamConstraints) => {
        const stream = await original(options); state.voiceTestStreams!.push(stream); return stream;
      } });
    }
  });
  page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/voice.html`);
  await expect(page.getByRole('button', { name: 'Bắt đầu kiểm tra' })).toBeEnabled();
});

test.afterEach(async () => {
  await context?.close();
  if (temp) await rm(temp, { recursive: true, force: true });
});

test('file → WAV → HTTP API → validated Gemini fixture → visible warning', async ({}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByLabel('Chọn file âm thanh để phân tích').setInputFiles({ name: 'sample.wav', mimeType: 'audio/wav', buffer: fixtureWav() });
  await expect(page.getByRole('heading', { name: 'Có dấu hiệu cần thận trọng' })).toBeVisible();
  await expect(page.getByText(/85.*100 điểm rủi ro/)).toBeVisible();
  await expect(page.getByText('Yêu cầu OTP / mật khẩu', { exact: true })).toBeVisible();
  await expect(page.getByText('Chưa đủ bằng chứng', { exact: true })).toBeVisible();
  await expect(page.locator('.evidence blockquote')).not.toContainText('123456');
  await expect(page.locator('.evidence blockquote')).toContainText('[ĐÃ ẨN]');
  await expect(page.locator('.tactics blockquote')).toHaveCount(2);
  await expect(page.locator('.tactics')).not.toContainText('123456');
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('voice-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('voice-mobile.png'), fullPage: true });
});

test('default 5s microphone clip stops automatically and retains the delayed result', async () => {
  await context.route('**/api/v1/analyze-voice', async route => {
    expect(route.request().postDataJSON().analysisMode).not.toBe('review');
    await new Promise(resolve => setTimeout(resolve,4100));
    await route.continue();
  });
  const requestSent = page.waitForRequest('**/api/v1/analyze-voice');
  await page.getByRole('radio', { name: /Micro của bạn/ }).check();
  await page.getByRole('button', { name: 'Bắt đầu kiểm tra' }).click();
  await expect(page.getByText('Đang thu âm', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading',{name:'Đang nhận âm thanh',exact:true})).toBeVisible();
  await expect(page.locator('.analysis-steps [aria-current=step]')).toContainText('Nhận âm thanh');
  const data=(await requestSent).postDataJSON(); expect(data.analysisMode).not.toBe('review');
  expect(Buffer.from(data.audioBase64,'base64').readUInt32LE(40)).toBe(160000);
  await expect(page.getByRole('group', {name:'Đang xử lý đoạn thu'})).toBeVisible();
  await expect(page.locator('.analysis-steps [aria-current=step]')).toContainText('Phân tích');
  await expect(page.getByRole('button', {name:'Dừng thu và phân tích'})).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { voiceTestStreams: MediaStream[] }).voiceTestStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  await expect(page.getByRole('heading', { name: 'Có dấu hiệu cần thận trọng' })).toBeVisible({ timeout: 16000 });
  await expect(page.getByText('Đã có kết quả', { exact: true })).toBeVisible();
  await expect(page.locator('.analysis-steps [aria-current=step]')).toContainText('Kết quả');
  await expect(page.getByRole('button', { name: 'Bắt đầu kiểm tra' })).toBeEnabled();
  expect(await page.evaluate(() => (window as Window & { voiceTestStreams: MediaStream[] }).voiceTestStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
});

test('denied permission and unavailable API give actionable errors, never a SAFE result', async () => {
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
  });
  await page.getByRole('radio', { name: /Micro của bạn/ }).check();
  await page.getByRole('button', { name: 'Bắt đầu kiểm tra' }).click();
  await expect(page.getByRole('alert')).toContainText('Chưa được cấp quyền');
  await context.route('**/api/v1/analyze-voice', route => route.abort('connectionrefused'));
  await page.getByLabel('Chọn file âm thanh để phân tích').setInputFiles({ name: 'sample.wav', mimeType: 'audio/wav', buffer: fixtureWav() });
  await expect(page.getByRole('alert')).toContainText('Không kết nối được dịch vụ');
  await expect(page.getByRole('heading', { name: 'Chưa thấy kịch bản lừa đảo' })).not.toBeVisible();
});

test('browser tab sharing captures its audio and survives changing active tabs', async () => {
  const source = await context.newPage();
  await source.goto('http://127.0.0.1:18080/voice-source');
  await source.getByRole('button', { name: 'Phát âm thanh thử' }).click();
  await page.bringToFront();
  const submitted = page.waitForRequest('**/api/v1/analyze-voice');
  await page.getByRole('button', { name: 'Bắt đầu kiểm tra' }).click();
  await expect(page.getByText('Đang thu âm', { exact: true })).toBeVisible();
  const captured = await page.evaluate(() => {
    const stream = (window as Window & { voiceTestStreams: MediaStream[] }).voiceTestStreams.at(-1)!;
    const audio = stream.getAudioTracks()[0], settings = audio.getSettings();
    return { displaySurface: stream.getVideoTracks()[0]?.getSettings().displaySurface,
      tabAudio: /tab audio|web.contents|browser tab/i.test(audio.label),
      tabDevice: settings.deviceId?.startsWith('web-contents'),
      autoGainControl: settings.autoGainControl, echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression };
  });
  expect(captured.displaySurface).toBe('browser'); expect(captured.tabAudio).toBe(true);
  expect(captured.tabDevice).toBe(true); expect(captured.autoGainControl).toBe(false);
  expect(captured.echoCancellation).toBe(false); expect(captured.noiseSuppression).toBe(false);
  await source.bringToFront();
  await expect(page.getByRole('heading', { name: 'Có dấu hiệu cần thận trọng' })).toBeVisible({ timeout: 16000 });
  const wave = Buffer.from((await submitted).postDataJSON().audioBase64, 'base64');
  let crossings = 0;
  for (let i = 46; i < wave.length; i += 2) if ((wave.readInt16LE(i - 2) >= 0) !== (wave.readInt16LE(i) >= 0)) crossings++;
  // Actual source tab is 220Hz. Fake microphone is a 220–420Hz chirp;
  // this rejects a test accidentally capturing that fake input instead of the tab.
  expect(crossings).toBeGreaterThan(1800); expect(crossings).toBeLessThan(2400);
  await page.bringToFront();
  await expect(page.getByRole('button', { name:'Dừng thu và phân tích' })).toHaveCount(0);
  await expect(page.getByText('Đã có kết quả', { exact:true })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { voiceTestStreams: MediaStream[] }).voiceTestStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
});

test('popup has an entry to the standalone Voice page', async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const opened = context.waitForEvent('page');
  await popup.getByRole('button', { name: /Bảo vệ cuộc gọi/ }).click();
  const voice = await opened;
  await expect(voice).toHaveURL(`chrome-extension://${extensionId}/voice.html`);
  await expect(voice.getByRole('heading', { name: 'Nghe cuộc gọi. Nhìn rõ dấu hiệu.' })).toBeVisible();
});

test('cancel drops a delayed result and malformed responses cannot crash the result panel', async () => {
  let release!: () => void;
  let completed!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const finished = new Promise<void>(resolve => { completed = resolve; });
  await context.route('**/api/v1/analyze-voice', async route => {
    await held;
    try { await route.fulfill({ status: 200, json: { verdict: 'SUSPICIOUS' } }); }
    finally { completed(); }
  });
  const sent = page.waitForRequest('**/api/v1/analyze-voice');
  await page.getByLabel('Chọn file âm thanh để phân tích').setInputFiles({ name: 'sample.wav', mimeType: 'audio/wav', buffer: fixtureWav() });
  await sent;
  await page.getByRole('button', { name: 'Hủy phân tích' }).click();
  release(); await finished;
  await expect(page.getByRole('status')).toContainText('Đã hủy phân tích file');
  await expect(page.getByRole('group', { name: 'Đang xử lý file âm thanh' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Chọn file thử', exact: true })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Có dấu hiệu cần thận trọng' })).not.toBeVisible();
  await context.unroute('**/api/v1/analyze-voice');
  await context.route('**/api/v1/analyze-voice', route => route.fulfill({ status: 200, json: { verdict: 'SAFE', detectedTactics: [{}] } }));
  await page.getByLabel('Chọn file âm thanh để phân tích').setInputFiles({ name: 'sample.wav', mimeType: 'audio/wav', buffer: fixtureWav() });
  await expect(page.getByRole('alert')).toContainText('kết quả không hợp lệ');
  await expect(page.getByRole('group', { name: 'Đang xử lý file âm thanh' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Chọn file thử', exact: true })).toBeEnabled();
});

test('local acoustic result is shown separately when Gemini is unavailable', async () => {
  await context.route('**/api/v1/analyze-voice', route => route.fulfill({ status: 200, json: {
    riskScore: null, verdict: 'UNKNOWN', syntheticVoiceProbability: null, detectedTactics: [],
    transcriptSnippet: '', warningMessageVi: 'Chưa phân tích được nội dung cuộc gọi.', executionTimeMs: 500,
    audioQuality: 'LIMITED', assessmentSource: 'LOCAL_ACOUSTIC', contentAnalysis: { status: 'UNAVAILABLE', reason: 'RATE_LIMITED' }, analysisModel: 'acoustic-fixture',
    acousticAnalysis: { status: 'AVAILABLE', verdict: 'SYNTHETIC_SUSPECTED', score: .95, scoreCalibrated: false,
      source: 'LOCAL_XLSR_AASIST', modelVersion: 'a'.repeat(64), executionTimeMs: 450 },
  } }));
  await page.getByLabel('Chọn file âm thanh để phân tích').setInputFiles({ name: 'sample.wav', mimeType: 'audio/wav', buffer: fixtureWav() });
  await expect(page.getByRole('heading', { name: 'Chưa đánh giá được nội dung' })).toBeVisible();
  await expect(page.getByText(/Gemini đã chạm giới hạn sử dụng/)).toBeVisible();
  await expect(page.getByText('Có dấu hiệu giọng tổng hợp', { exact: true })).toBeVisible();
  await expect(page.getByText(/Điểm mô hình 95\/100, chưa hiệu chuẩn/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nguy cơ lừa đảo qua cuộc gọi' })).not.toBeVisible();
});

test('insufficient speech is UNKNOWN with no fabricated acoustic percentage', async () => {
  await context.route('**/api/v1/analyze-voice', route => route.fulfill({ status: 200, json: {
    riskScore: null, verdict: 'UNKNOWN', syntheticVoiceProbability: null, detectedTactics: [],
    transcriptSnippet: '', warningMessageVi: 'Chưa đánh giá được đoạn này.', executionTimeMs: 100,
    audioQuality: 'LIMITED', assessmentSource: 'LOCAL_ACOUSTIC', analysisModel: 'acoustic-fixture',
    acousticAnalysis: { status: 'AVAILABLE', verdict: 'UNKNOWN', score: null, scoreCalibrated: false,
      source: 'LOCAL_XLSR_AASIST', modelVersion: 'a'.repeat(64), executionTimeMs: 90 },
  } }));
  await page.getByLabel('Chọn file âm thanh để phân tích').setInputFiles({ name: 'sample.wav', mimeType: 'audio/wav', buffer: fixtureWav() });
  await expect(page.getByText('Tín hiệu giọng nói chưa đủ chắc chắn', { exact: true })).toBeVisible();
  await expect(page.getByText(/Chưa đủ lời nói rõ để chấm điểm/)).toBeVisible();
  await expect(page.getByText(/Điểm mô hình/)).not.toBeVisible();
});

test('a content scam warning colors the actual live waveform red', async () => {
  await page.getByRole('radio', { name:'Theo dõi liên tục', exact:true }).check();
  await context.route('**/api/v1/analyze-voice', route => route.fulfill({ status: 200, json: {
    riskScore: 90, verdict: 'DEEPFAKE_SCAM', syntheticVoiceProbability: null,
    detectedTactics: ['OTP_OR_CREDENTIAL_ASK'], tacticEvidence: [{ tactic: 'OTP_OR_CREDENTIAL_ASK', quote: 'Đọc mã OTP ngay' }],
    transcriptSnippet: 'Đọc mã OTP ngay.', warningMessageVi: 'Không chia sẻ OTP. Hãy kiểm tra qua kênh chính thức.',
    audioQuality: 'CLEAR', executionTimeMs: 100, assessmentSource: 'GEMINI_AUDIO', analysisModel: 'software-test-fixture',
  } }));
  await page.getByRole('radio', { name: /Micro của bạn/ }).check();
  await page.getByRole('button', { name: 'Bắt đầu kiểm tra' }).click();
  await expect(page.getByRole('heading', { name: 'Nguy cơ lừa đảo qua cuộc gọi' })).toBeVisible({ timeout: 16000 });
  await expect.poll(() => page.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).getContext('2d')?.strokeStyle)).toBe('#fb7185');
  await expect(page.locator('.tactics blockquote')).toHaveText('Đọc mã OTP ngay');
  await page.getByRole('button', { name: 'Dừng thu và phân tích' }).click();
});

test('a later failed capture window removes the previous SAFE result', async () => {
  await page.getByRole('radio', { name:'Theo dõi liên tục', exact:true }).check();
  let calls = 0;
  await context.route('**/api/v1/analyze-voice', route => {
    if (++calls > 1) return route.abort('connectionrefused');
    return route.fulfill({ status: 200, json: { riskScore: 0, verdict: 'SAFE', syntheticVoiceProbability: null,
      detectedTactics: [], tacticEvidence: [], transcriptSnippet: 'Chúng ta họp vào chiều nay.',
      warningMessageVi: 'Chưa thấy dấu hiệu trong đoạn này.', audioQuality: 'CLEAR', executionTimeMs: 100,
      assessmentSource: 'GEMINI_AUDIO', analysisModel: 'software-test-fixture' } });
  });
  await page.getByRole('radio', { name: /Micro của bạn/ }).check();
  await page.getByRole('button', { name: 'Bắt đầu kiểm tra' }).click();
  await expect(page.getByRole('heading', { name: 'Chưa thấy kịch bản lừa đảo' })).toBeVisible({ timeout: 16000 });
  await expect(page.getByRole('alert')).toContainText('Không kết nối được dịch vụ', { timeout: 16000 });
  await expect(page.getByRole('heading', { name: 'Chưa thấy kịch bản lừa đảo' })).not.toBeVisible();
  await expect(page.getByRole('status')).toContainText('chưa được đánh giá');
  await page.getByRole('button', { name: 'Dừng thu và phân tích' }).click();
});


test('file upload automatically uses review and survives the live client deadline', async ({}, testInfo) => {
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await context.route('**/api/v1/analyze-voice', async route => {
    expect(route.request().postDataJSON().analysisMode).toBe('review');
    await new Promise(resolve => setTimeout(resolve, 4100));
    return route.fulfill({ status: 200, json: { riskScore: 0, verdict: 'SAFE', syntheticVoiceProbability: null,
      detectedTactics: [], tacticEvidence: [], transcriptSnippet: 'Chúng ta họp chiều nay.', warningMessageVi: 'Chưa thấy dấu hiệu trong đoạn này.',
      audioQuality: 'CLEAR', executionTimeMs: 4100, assessmentSource: 'GEMINI_AUDIO', analysisModel: 'software-test-fixture' } });
  });
  await page.getByLabel('Chọn file âm thanh để phân tích').setInputFiles({ name: 'sample.wav', mimeType: 'audio/wav', buffer: fixtureWav() });
  await expect(page.getByRole('status')).toContainText('15 giây');
  await expect(page.getByRole('heading', { name: 'Đang phân tích âm thanh', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Đang xử lý file âm thanh' })).toContainText('sample.wav');
  await expect(page.getByRole('button', { name: 'Đang phân tích…', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Hủy phân tích' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bắt đầu bằng một đoạn âm thanh' })).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('voice-processing-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.file-processing .loading-spinner')).toHaveCSS('animation-name', 'none');
  await page.screenshot({ path: testInfo.outputPath('voice-processing-mobile.png'), fullPage: true });
  await expect(page.getByRole('heading', { name: 'Chưa thấy kịch bản lừa đảo' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Đang xử lý file âm thanh' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Chọn file thử', exact: true })).toBeEnabled();
});

test('provider fixture shows the actual Flash fallback rather than claiming Live success', async ({}, testInfo) => {
  await context.route('**/api/v1/analyze-voice', route => route.fulfill({ status: 200, json: {
    riskScore: 85, verdict: 'SUSPICIOUS', syntheticVoiceProbability: null, detectedTactics: ['OTP_OR_CREDENTIAL_ASK'],
    transcriptSnippet: 'Đọc mã OTP cho tôi.', warningMessageVi: 'Không cung cấp OTP.', audioQuality: 'CLEAR', executionTimeMs: 1200,
    assessmentSource: 'GEMINI_AUDIO', analysisModel: 'gemini-3.5-flash-lite', analysisTransport: 'GENERATE_CONTENT', fallbackUsed: true,
    contentAnalysis: { status: 'AVAILABLE' }, providerAttempts: [
      { model: 'gemini-3.8-live-extended-thinking', transport: 'LIVE_API', status: 'FAILED', reason: 'PROVIDER_ERROR' },
      { model: 'gemini-3.8-live', transport: 'LIVE_API', status: 'FAILED', reason: 'PROVIDER_ERROR' },
      { model: 'gemini-3.5-flash-lite', transport: 'GENERATE_CONTENT', status: 'SUCCEEDED' },
    ],
  } }));
  await page.getByLabel('Chọn file âm thanh để phân tích').setInputFiles({ name: 'sample.wav', mimeType: 'audio/wav', buffer: fixtureWav() });
  await expect(page.getByText(/Model phân tích nội dung:.*gemini-3.5-flash-lite/)).toContainText('Đang dùng model dự phòng');
  await page.getByText('Các model đã thử', { exact: true }).click();
  await expect(page.getByText('gemini-3.8-live-extended-thinking: Chưa phân tích được', { exact: true })).toBeVisible();
  await expect(page.getByText('gemini-3.5-flash-lite: Đã phân tích', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('voice-fallback-provenance.png'), fullPage: true });
});


test('Gemini task estimate is shown separately from a benign content verdict without a local worker', async () => {
  await context.route('**/api/v1/analyze-voice', route => route.fulfill({status:200,json:{
    riskScore:0,verdict:'SAFE',syntheticVoiceProbability:.9,detectedTactics:[],tacticEvidence:[],
    transcriptSnippet:'Chiều nay họp nhóm nhé.',warningMessageVi:'Chưa thấy dấu hiệu lừa đảo trong đoạn này.',
    executionTimeMs:1500,audioQuality:'CLEAR',assessmentSource:'GEMINI_AUDIO',analysisModel:'gemini-task-fixture',
    analysisTransport:'LIVE_API',fallbackUsed:false,providerAttempts:[{model:'gemini-task-fixture',transport:'LIVE_API',status:'SUCCEEDED'}],contentAnalysis:{status:'AVAILABLE'},
  }}));
  await page.getByLabel('Chọn file âm thanh để phân tích').setInputFiles({name:'sample.wav',mimeType:'audio/wav',buffer:fixtureWav()});
  await expect(page.getByRole('heading',{name:'Chưa thấy kịch bản lừa đảo'})).toBeVisible();
  await expect(page.getByText('90% · ước lượng mô hình',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Kiểm tra tín hiệu giọng nói'})).toHaveCount(0);
  await expect(page.getByText(/Model phân tích nội dung:.*gemini-task-fixture/)).toBeVisible();
});


test('a busy live request submits the queued overlapping audio next without parallel requests', async () => {
  await page.getByRole('radio', { name:'Theo dõi liên tục', exact:true }).check();
  test.skip(process.env.VOICE_E2E_OVERLAP !== '1', 'Requires the explicitly enabled experimental overlap build.');
  const inputs: Buffer[] = [];
  let active = 0, maximum = 0;
  await context.route('**/api/v1/analyze-voice', async route => {
    active++; maximum = Math.max(maximum, active);
    inputs.push(Buffer.from(route.request().postDataJSON().audioBase64, 'base64'));
    try {
      if (inputs.length === 1) await new Promise(resolve => setTimeout(resolve, 2750));
      await route.fulfill({ status: 200, json: { riskScore: 0, verdict: 'SAFE', syntheticVoiceProbability: null,
        detectedTactics: [], transcriptSnippet: 'Âm thanh thử nghiệm.', warningMessageVi: 'Kết quả fixture.',
        audioQuality: 'CLEAR', executionTimeMs: 1, assessmentSource: 'GEMINI_AUDIO', analysisModel: 'software-test-fixture' } });
    } finally { active--; }
  });
  await page.getByRole('radio', { name: /Micro của bạn/ }).check();
  await page.getByRole('button', { name: 'Bắt đầu kiểm tra' }).click();
  await expect.poll(() => inputs.length, { timeout: 16000 }).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Dừng thu và phân tích' }).click();
  const crossings = (wav: Buffer) => {
    let count = 0;
    for (let i = 46; i < 44 + 8000; i += 2) if ((wav.readInt16LE(i - 2) >= 0) !== (wav.readInt16LE(i) >= 0)) count++;
    return count;
  };
  // Fake input is a looping 5s chirp. The 2.5s overlap starts at a higher frequency;
  // dropping it and waiting for the 10s window would return to the low frequency.
  expect(crossings(inputs[1])).toBeGreaterThan(crossings(inputs[0]) + 20);
  expect(maximum).toBe(1);
});

test('stop clears pending live audio before a delayed response can restart submission', async () => {
  await page.getByRole('radio', { name:'Theo dõi liên tục', exact:true }).check();
  test.skip(process.env.VOICE_E2E_OVERLAP !== '1', 'Requires the explicitly enabled experimental overlap build.');
  let release!: () => void, completed!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const finished = new Promise<void>(resolve => { completed = resolve; });
  let calls = 0;
  await context.route('**/api/v1/analyze-voice', async route => {
    calls++;
    await held;
    try { await route.fulfill({ status: 200, json: { verdict: 'SAFE' } }); } catch { /* Aborted when stopped. */ }
    finally { completed(); }
  });
  const sent = page.waitForRequest('**/api/v1/analyze-voice');
  await page.getByRole('radio', { name: /Micro của bạn/ }).check();
  await page.getByRole('button', { name: 'Bắt đầu kiểm tra' }).click();
  await sent;
  await page.waitForTimeout(2700); // The second live window arrives while the first is held.
  await page.getByRole('button', { name: 'Dừng thu và phân tích' }).click();
  await page.getByRole('button', { name:'Hủy phân tích' }).click();
  release(); await finished;
  await expect(page.getByRole('status')).toContainText('Không gửi thêm âm thanh');
  await page.waitForTimeout(500);
  expect(calls).toBe(1);
  expect(await page.evaluate(() => (window as Window & { voiceTestStreams: MediaStream[] }).voiceTestStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  await expect(page.getByRole('heading', { name: 'Chưa thấy kịch bản lừa đảo' })).not.toBeVisible();
});


const reviewFileWav = (seconds: number) => Buffer.from(encodeVoiceWav(Float32Array.from({length:16000*seconds},(_,i)=>Math.sin(i*.1)*.25),true));

test('detailed review sends a whole 12s file once and reports the duration that was sent', async () => {
  const sent=page.waitForRequest('**/api/v1/analyze-voice');
  await page.getByLabel('Chọn file âm thanh để phân tích').setInputFiles({name:'whole-12s.wav',mimeType:'audio/wav',buffer:reviewFileWav(12)});
  const data=(await sent).postDataJSON();const wav=Buffer.from(data.audioBase64,'base64');
  expect(data.analysisMode).toBe('review');expect(wav.readUInt32LE(40)).toBe(384000);
  await expect(page.getByRole('heading',{name:'Có dấu hiệu cần thận trọng'})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('toàn bộ 12.0 giây');
});

test('review rejects a 16s file locally without silently truncating it or making an API call', async () => {
  let calls=0;page.on('request',r=>{if(r.url().endsWith('/api/v1/analyze-voice'))calls++;});
  const tooLong=Buffer.alloc(512044);reviewFileWav(15).copy(tooLong);
  tooLong.writeUInt32LE(tooLong.length-8,4);tooLong.writeUInt32LE(512000,40);
  await page.getByLabel('Chọn file âm thanh để phân tích').setInputFiles({name:'too-long.wav',mimeType:'audio/wav',buffer:tooLong});
  await expect(page.getByRole('alert')).toContainText('không tự bỏ phần cuối');expect(calls).toBe(0);
  await expect(page.getByRole('heading',{name:'Chưa thấy kịch bản lừa đảo'})).not.toBeVisible();
});


for (const surface of ['monitor','window']) {
  test(`tab mode rejects ${surface} sharing and stops its tracks before any API request`, async () => {
    let calls=0;page.on('request',request=>{if(request.url().endsWith('/api/v1/analyze-voice'))calls++;});
    await page.evaluate(async surface => {
      const audio=new AudioContext(),destination=audio.createMediaStreamDestination(),tone=audio.createOscillator();
      tone.connect(destination);tone.start();
      const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
      const video=canvas.captureStream().getVideoTracks()[0];
      const original=video.getSettings.bind(video);Object.defineProperty(video,'getSettings',{value:()=>({...original(),displaySurface:surface})});
      const stream=new MediaStream([...destination.stream.getAudioTracks(),video]);
      (window as Window & {voiceTestStreams:MediaStream[];voiceWrongSurfaceContext?:AudioContext}).voiceTestStreams.push(stream);
      (window as Window & {voiceWrongSurfaceContext?:AudioContext}).voiceWrongSurfaceContext=audio;
      navigator.mediaDevices.getDisplayMedia=async()=>stream;
    },surface);
    await page.getByRole('button',{name:'Bắt đầu kiểm tra'}).click();
    await expect(page.getByRole('alert')).toContainText('chưa phải Thẻ Chrome');expect(calls).toBe(0);
    expect(await page.evaluate(()=>(window as Window & {voiceTestStreams:MediaStream[]}).voiceTestStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
    await page.evaluate(async()=>{await (window as Window & {voiceWrongSurfaceContext?:AudioContext}).voiceWrongSurfaceContext?.close();});
  });
}


test('cancel while reading a file clears feedback and never submits its late decoded audio', async () => {
  let calls = 0;
  page.on('request', request => { if (request.url().endsWith('/api/v1/analyze-voice')) calls++; });
  await page.evaluate(() => {
    const state = window as Window & { voiceReadRelease?: () => void; voiceReadFinished?: boolean };
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      const file = this;
      return new Promise<ArrayBuffer>((resolve, reject) => {
        state.voiceReadRelease = () => { void read.call(file).then(resolve, reject); };
      });
    };
    const close = AudioContext.prototype.close;
    AudioContext.prototype.close = async function () {
      try { return await close.call(this); } finally { state.voiceReadFinished = true; }
    };
  });
  const name = 'ban-ghi-tieng-Viet-'.repeat(12) + '.wav';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Chọn file âm thanh để phân tích').setInputFiles({ name, mimeType:'audio/wav', buffer:fixtureWav() });
  await expect(page.getByRole('heading', { name:'Đang đọc file âm thanh', exact:true })).toBeVisible();
  await expect(page.getByRole('group', { name:'Đang xử lý file âm thanh' })).toContainText(name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name:'Hủy phân tích' }).click();
  await expect(page.getByRole('status')).toContainText('Đã hủy phân tích file');
  await expect(page.getByRole('group', { name:'Đang xử lý file âm thanh' })).toHaveCount(0);
  await expect(page.getByRole('button', { name:'Chọn file thử', exact:true })).toBeEnabled();
  await page.evaluate(() => (window as Window & { voiceReadRelease?: () => void }).voiceReadRelease?.());
  await page.waitForFunction(() => (window as Window & { voiceReadFinished?: boolean }).voiceReadFinished === true);
  expect(calls).toBe(0);
  await expect(page.getByRole('status')).toContainText('Đã hủy phân tích file');
});


for (const endMethod of ['button','source-ended'] as const) {
  test(`finishing a short clip by ${endMethod} sends the recorded tail and waits for its result`, async ({},testInfo) => {
    let calls=0, release!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;});
    await context.route('**/api/v1/analyze-voice',async route=>{
      calls++;await held;await route.continue();
    });
    await expect(page.getByRole('radio',{name:'Một đoạn 5 giây',exact:true})).toBeChecked();
    await page.getByRole('radio',{name:/Micro của bạn/}).check();
    await page.getByRole('button',{name:'Bắt đầu kiểm tra'}).click();
    const progress=page.getByRole('progressbar',{name:'Thời lượng đoạn đang thu'});
    await expect(progress).toBeVisible();
    await expect.poll(()=>progress.evaluate((p:HTMLProgressElement)=>p.value)).toBeGreaterThanOrEqual(1.5);
    const waiting=page.waitForRequest('**/api/v1/analyze-voice');
    if(endMethod==='button'){
      await page.screenshot({path:testInfo.outputPath('capture-countdown.png'),fullPage:true});
      await page.getByRole('button',{name:'Dừng thu và phân tích'}).click();
    }else{
      await page.evaluate(()=>{
        const stream=(window as Window & {voiceTestStreams:MediaStream[]}).voiceTestStreams.at(-1)!;
        stream.getAudioTracks()[0].dispatchEvent(new Event('ended'));
      });
    }
    const sent=await waiting;
    const data=sent.postDataJSON(),frames=Buffer.from(data.audioBase64,'base64').readUInt32LE(40)/2;
    expect(frames).toBeGreaterThanOrEqual(8000);expect(frames).toBeLessThan(80000);
    expect(data.analysisMode).not.toBe('review');
    await expect(page.getByRole('group',{name:'Đang xử lý đoạn thu'})).toBeVisible();
    expect(await page.evaluate(()=>(window as Window & {voiceTestStreams:MediaStream[]}).voiceTestStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
    await page.screenshot({path:testInfo.outputPath('capture-waiting.png'),fullPage:true});
    release();
    await expect(page.getByRole('heading',{name:'Có dấu hiệu cần thận trọng'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Bắt đầu kiểm tra'})).toBeEnabled();expect(calls).toBe(1);
  });
}


test('continuous stop drains the final speech after a silent window while a request is busy', async () => {
  let calls=0, release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  await context.route('**/api/v1/analyze-voice',async route=>{
    calls++;if(calls===1)await held;await route.continue();
  });
  await page.getByRole('radio',{name:'Theo dõi liên tục',exact:true}).check();
  await page.getByRole('radio',{name:/Micro của bạn/}).check();
  const first=page.waitForRequest('**/api/v1/analyze-voice');
  await page.getByRole('button',{name:'Bắt đầu kiểm tra'}).click();
  const progress=page.getByRole('progressbar',{name:'Thời lượng đoạn đang thu'});
  await expect.poll(()=>progress.evaluate((p:HTMLProgressElement)=>p.value)).toBeGreaterThanOrEqual(4);
  await page.evaluate(()=>(window as Window & {voiceTestStreams:MediaStream[]}).voiceTestStreams.at(-1)!.getAudioTracks().forEach(t=>{t.enabled=false;}));
  await first;
  await expect(page.getByText('10s đã thu',{exact:true})).toBeVisible({timeout:8000});
  await page.evaluate(()=>(window as Window & {voiceTestStreams:MediaStream[]}).voiceTestStreams.at(-1)!.getAudioTracks().forEach(t=>{t.enabled=true;}));
  await expect.poll(()=>progress.evaluate((p:HTMLProgressElement)=>p.value)).toBeGreaterThanOrEqual(1.2);
  await page.getByRole('button',{name:'Dừng thu và phân tích'}).click();
  release();
  await expect.poll(()=>calls).toBe(2);
  await expect(page.getByText('2 đoạn đã kiểm tra',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Bắt đầu kiểm tra'})).toBeEnabled();
  expect(await page.evaluate(()=>(window as Window & {voiceTestStreams:MediaStream[]}).voiceTestStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
});
