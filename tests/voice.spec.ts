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

const fixtureWav = () => Buffer.from(encodeVoiceWav(Float32Array.from({ length: 80000 }, (_, i) => Math.sin(i * 2 * Math.PI * 220 / 16000) * .25)));

test.beforeEach(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'zeroleak-voice-e2e-'));
  const audioPath = path.join(temp, 'input.wav');
  await writeFile(audioPath, fixtureWav());
  const extension = path.resolve('apps/extension/.output/chrome-mv3');
  context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
    headless: false,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
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
  await page.getByLabel('Chọn file âm thanh để phân tích 5 giây đầu').setInputFiles({ name: 'sample.wav', mimeType: 'audio/wav', buffer: fixtureWav() });
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

test('actual AudioWorklet captures microphone, submits a 5s window, and stop releases it', async () => {
  await page.getByRole('checkbox', { name: /Phân tích kỹ file/ }).check();
  const requestSent = page.waitForRequest('**/api/v1/analyze-voice');
  await page.getByRole('radio', { name: /Micro của bạn/ }).check();
  await page.getByRole('button', { name: 'Bắt đầu kiểm tra' }).click();
  await expect(page.getByText('Đang thu âm', { exact: true })).toBeVisible();
  expect((await requestSent).postDataJSON().analysisMode).not.toBe('review');
  await expect(page.getByRole('heading', { name: 'Có dấu hiệu cần thận trọng' })).toBeVisible({ timeout: 16000 });
  await page.getByRole('button', { name: 'Dừng thu âm' }).click();
  await expect(page.getByText('Chưa thu âm', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bắt đầu kiểm tra' })).toBeEnabled();
  await expect(page.getByRole('status')).toContainText('Không gửi thêm âm thanh');
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
  await page.getByLabel('Chọn file âm thanh để phân tích 5 giây đầu').setInputFiles({ name: 'sample.wav', mimeType: 'audio/wav', buffer: fixtureWav() });
  await expect(page.getByRole('alert')).toContainText('Không kết nối được dịch vụ');
  await expect(page.getByRole('heading', { name: 'Chưa thấy kịch bản lừa đảo' })).not.toBeVisible();
});

test('browser tab sharing captures its audio and survives changing active tabs', async () => {
  const source = await context.newPage();
  await source.goto('http://127.0.0.1:18080/voice-source');
  await source.getByRole('button', { name: 'Phát âm thanh thử' }).click();
  await page.bringToFront();
  await page.getByRole('button', { name: 'Bắt đầu kiểm tra' }).click();
  await expect(page.getByText('Đang thu âm', { exact: true })).toBeVisible();
  await source.bringToFront();
  await expect(page.getByRole('heading', { name: 'Có dấu hiệu cần thận trọng' })).toBeVisible({ timeout: 16000 });
  await page.bringToFront();
  await page.getByRole('button', { name: 'Dừng thu âm' }).click();
  await expect(page.getByText('Chưa thu âm', { exact: true })).toBeVisible();
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
  await page.getByLabel('Chọn file âm thanh để phân tích 5 giây đầu').setInputFiles({ name: 'sample.wav', mimeType: 'audio/wav', buffer: fixtureWav() });
  await sent;
  await page.getByRole('button', { name: 'Hủy phân tích' }).click();
  release(); await finished;
  await expect(page.getByRole('status')).toContainText('Không gửi thêm âm thanh');
  await expect(page.getByRole('heading', { name: 'Có dấu hiệu cần thận trọng' })).not.toBeVisible();
  await context.unroute('**/api/v1/analyze-voice');
  await context.route('**/api/v1/analyze-voice', route => route.fulfill({ status: 200, json: { verdict: 'SAFE', detectedTactics: [{}] } }));
  await page.getByLabel('Chọn file âm thanh để phân tích 5 giây đầu').setInputFiles({ name: 'sample.wav', mimeType: 'audio/wav', buffer: fixtureWav() });
  await expect(page.getByRole('alert')).toContainText('kết quả không hợp lệ');
});

test('local acoustic result is shown separately when Gemini is unavailable', async () => {
  await context.route('**/api/v1/analyze-voice', route => route.fulfill({ status: 200, json: {
    riskScore: null, verdict: 'UNKNOWN', syntheticVoiceProbability: null, detectedTactics: [],
    transcriptSnippet: '', warningMessageVi: 'Chưa phân tích được nội dung cuộc gọi.', executionTimeMs: 500,
    audioQuality: 'LIMITED', assessmentSource: 'LOCAL_ACOUSTIC', contentAnalysis: { status: 'UNAVAILABLE', reason: 'RATE_LIMITED' }, analysisModel: 'acoustic-fixture',
    acousticAnalysis: { status: 'AVAILABLE', verdict: 'SYNTHETIC_SUSPECTED', score: .95, scoreCalibrated: false,
      source: 'LOCAL_XLSR_AASIST', modelVersion: 'a'.repeat(64), executionTimeMs: 450 },
  } }));
  await page.getByLabel('Chọn file âm thanh để phân tích 5 giây đầu').setInputFiles({ name: 'sample.wav', mimeType: 'audio/wav', buffer: fixtureWav() });
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
  await page.getByLabel('Chọn file âm thanh để phân tích 5 giây đầu').setInputFiles({ name: 'sample.wav', mimeType: 'audio/wav', buffer: fixtureWav() });
  await expect(page.getByText('Tín hiệu giọng nói chưa đủ chắc chắn', { exact: true })).toBeVisible();
  await expect(page.getByText(/Chưa đủ lời nói rõ để chấm điểm/)).toBeVisible();
  await expect(page.getByText(/Điểm mô hình/)).not.toBeVisible();
});

test('a content scam warning colors the actual live waveform red', async () => {
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
  await page.getByRole('button', { name: 'Dừng thu âm' }).click();
});

test('a later failed capture window removes the previous SAFE result', async () => {
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
  await page.getByRole('button', { name: 'Dừng thu âm' }).click();
});


test('detailed file review is opt-in and survives the live client deadline', async () => {
  await page.getByRole('checkbox', { name: /Phân tích kỹ file/ }).check();
  await context.route('**/api/v1/analyze-voice', async route => {
    expect(route.request().postDataJSON().analysisMode).toBe('review');
    await new Promise(resolve => setTimeout(resolve, 4100));
    return route.fulfill({ status: 200, json: { riskScore: 0, verdict: 'SAFE', syntheticVoiceProbability: null,
      detectedTactics: [], tacticEvidence: [], transcriptSnippet: 'Chúng ta họp chiều nay.', warningMessageVi: 'Chưa thấy dấu hiệu trong đoạn này.',
      audioQuality: 'CLEAR', executionTimeMs: 4100, assessmentSource: 'GEMINI_AUDIO', analysisModel: 'software-test-fixture' } });
  });
  await page.getByLabel('Chọn file âm thanh để phân tích 5 giây đầu').setInputFiles({ name: 'sample.wav', mimeType: 'audio/wav', buffer: fixtureWav() });
  await expect(page.getByRole('status')).toContainText('15 giây');
  await expect(page.getByRole('heading', { name: 'Chưa thấy kịch bản lừa đảo' })).toBeVisible();
});
