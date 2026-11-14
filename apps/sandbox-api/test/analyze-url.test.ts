import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import {
  validateUrlSafety,
  isPrivateIpv4,
  isPrivateIpv6,
  captureUrlInSandbox,
  closeBrowser,
} from '../src/playwright.js';

describe('Epic 2.1: SSRF Protection & URL Safety Filter', () => {
  test('blocks private IPv4 addresses', () => {
    assert.equal(isPrivateIpv4('127.0.0.1'), true);
    assert.equal(isPrivateIpv4('127.1.2.3'), true);
    assert.equal(isPrivateIpv4('10.0.0.1'), true);
    assert.equal(isPrivateIpv4('10.255.255.255'), true);
    assert.equal(isPrivateIpv4('172.16.0.1'), true);
    assert.equal(isPrivateIpv4('172.31.255.255'), true);
    assert.equal(isPrivateIpv4('192.168.1.1'), true);
    assert.equal(isPrivateIpv4('169.254.169.254'), true); // Cloud metadata IP
    assert.equal(isPrivateIpv4('0.0.0.0'), true);

    // Public IPs should not be marked as private
    assert.equal(isPrivateIpv4('8.8.8.8'), false);
    assert.equal(isPrivateIpv4('1.1.1.1'), false);
    assert.equal(isPrivateIpv4('172.32.0.1'), false);
  });

  test('blocks private IPv6 addresses', () => {
    assert.equal(isPrivateIpv6('::1'), true);
    assert.equal(isPrivateIpv6('fe80::1'), true);
    assert.equal(isPrivateIpv6('fc00::1'), true);
  });

  test('validateUrlSafety blocks SSRF attack vectors', () => {
    // Loopback & Localhost
    assert.equal(validateUrlSafety('http://localhost').safe, false);
    assert.equal(validateUrlSafety('http://localhost:8080/admin').safe, false);
    assert.equal(validateUrlSafety('http://127.0.0.1').safe, false);
    assert.equal(validateUrlSafety('http://sub.localhost').safe, false);
    assert.equal(validateUrlSafety('http://router.local').safe, false);
    assert.equal(validateUrlSafety('http://server.internal').safe, false);

    // Cloud Metadata Service
    assert.equal(validateUrlSafety('http://169.254.169.254/latest/meta-data/').safe, false);

    // Private IP subnets
    assert.equal(validateUrlSafety('http://192.168.1.1/admin').safe, false);
    assert.equal(validateUrlSafety('http://10.0.0.1').safe, false);
    assert.equal(validateUrlSafety('http://172.16.5.1').safe, false);

    // Decimal encoded IP (127.0.0.1 = 2130706433)
    assert.equal(validateUrlSafety('http://2130706433').safe, false);

    // Dangerous protocols
    assert.equal(validateUrlSafety('file:///etc/passwd').safe, false);
    assert.equal(validateUrlSafety('gopher://127.0.0.1:6379/_').safe, false);
    assert.equal(validateUrlSafety('javascript:alert(1)').safe, false);

    // Valid external web URLs
    assert.equal(validateUrlSafety('https://example.com').safe, true);
    assert.equal(validateUrlSafety('https://vietcombank.com.vn').safe, true);
    assert.equal(validateUrlSafety('http://vcb-digibank-confirm.top/login.php').safe, true);
  });
});

describe('Epic 2.1: POST /api/v1/analyze-url endpoint', () => {
  const app = createApp({
    captureUrl: async (url, opts) => {
      if (url.includes('private')) {
        return {
          url,
          finalRedirectUrl: url,
          pageTitle: '',
          actualDomain: '192.168.1.1',
          hasPasswordInput: false,
          hasOtpInput: false,
          hasSeedPhraseInput: false,
          domSummary: 'Blocked by SSRF filter',
          executionTimeMs: 1,
          status: 'BLOCKED_SSRF',
          errorMessage: 'Chặn IP nội bộ',
        };
      }

      if (url.includes('phishing-test')) {
        return {
          url,
          finalRedirectUrl: 'https://vcb-fake.top/login.php',
          pageTitle: 'Vietcombank Online Banking',
          actualDomain: 'vcb-fake.top',
          hasPasswordInput: true,
          hasOtpInput: true,
          hasSeedPhraseInput: false,
          domSummary: 'Form with password and OTP inputs',
          screenshotBase64: 'UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//739w==', // Dummy WebP base64
          executionTimeMs: 120,
          status: 'SUCCESS',
        };
      }

      return {
        url,
        finalRedirectUrl: url,
        pageTitle: 'Example Domain',
        actualDomain: 'example.com',
        hasPasswordInput: false,
        hasOtpInput: false,
        hasSeedPhraseInput: false,
        domSummary: 'No credentials inputs',
        screenshotBase64: 'UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//739w==',
        executionTimeMs: 95,
        status: 'SUCCESS',
      };
    },
  });

  test('rejects empty or missing URL with 400', async () => {
    const res = await app.request('/api/v1/analyze-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'INVALID_URL');
  });

  test('blocks SSRF targets with 400 SSRF_BLOCKED', async () => {
    const res = await app.request('/api/v1/analyze-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://private.lan/admin' }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'SSRF_BLOCKED');
  });

  test('returns structured sandbox capture data for valid target URL', async () => {
    const res = await app.request('/api/v1/analyze-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.url, 'https://example.com');
    assert.equal(body.actualDomain, 'example.com');
    assert.equal(body.hasPasswordInput, false);
    assert.equal(body.hasOtpInput, false);
    assert.equal(body.verdict, 'SAFE');
    assert.ok(body.screenshotBase64);
    assert.ok(typeof body.executionTimeMs === 'number');
  });

  test('detects password and OTP inputs and marks preliminary heuristic risk', async () => {
    const res = await app.request('/api/v1/analyze-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://phishing-test.com' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.hasPasswordInput, true);
    assert.equal(body.hasOtpInput, true);
    assert.equal(body.verdict, 'SUSPICIOUS');
    assert.ok(body.riskScore >= 75);
    assert.ok(body.indicators.some((i: string) => i.includes('mật khẩu')));
    assert.ok(body.indicators.some((i: string) => i.includes('OTP')));
  });
});

describe('Epic 2.1: Playwright Headless Real Sandbox Execution', () => {
  let server: http.Server;
  let testPort: number;

  before(async () => {
    // Start a lightweight deterministic local HTTP server for E2E sandbox testing
    server = http.createServer((req, res) => {
      if (req.url === '/phishing-page') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Vietcombank Fake Portal</title></head>
            <body>
              <h2>Đăng nhập VCB DigiBank</h2>
              <form action="/login.php" method="POST">
                <input type="text" name="username" placeholder="Tên đăng nhập" />
                <input type="password" name="password" placeholder="Mật khẩu" />
                <input type="tel" name="otp_code" maxlength="6" autocomplete="one-time-code" placeholder="Mã OTP" />
                <button type="submit">Xác nhận</button>
              </form>
            </body>
          </html>
        `);
      } else if (req.url === '/crypto-scam') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Metamask Verify</title></head>
            <body>
              <textarea name="recovery_seed" placeholder="Nhập 12 từ Seed Phrase để khôi phục ví"></textarea>
            </body>
          </html>
        `);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><head><title>Clean Portal</title></head><body><h1>Hello World</h1></body></html>');
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        testPort = addr.port;
        resolve();
      });
    });
  });

  after(async () => {
    delete process.env.ALLOW_LOCAL_SANDBOX;
    await closeBrowser();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('Playwright captureUrlInSandbox inspects DOM inputs and captures WebP screenshot', async () => {
    // Enable local sandbox test access for this local test server
    process.env.ALLOW_LOCAL_SANDBOX = 'true';

    const result = await captureUrlInSandbox(`http://127.0.0.1:${testPort}/phishing-page`, { timeoutMs: 3000 });

    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.actualDomain, '127.0.0.1');
    assert.equal(result.pageTitle, 'Vietcombank Fake Portal');
    assert.equal(result.hasPasswordInput, true);
    assert.equal(result.hasOtpInput, true);
    assert.equal(result.hasSeedPhraseInput, false);
    assert.ok(result.domSummary.includes('password'));
    assert.ok(result.screenshotBase64 && result.screenshotBase64.length > 50);
  });

  test('Playwright captureUrlInSandbox detects seed phrase input', async () => {
    process.env.ALLOW_LOCAL_SANDBOX = 'true';

    const result = await captureUrlInSandbox(`http://127.0.0.1:${testPort}/crypto-scam`, { timeoutMs: 3000 });

    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.hasSeedPhraseInput, true);
    assert.equal(result.hasPasswordInput, false);
  });

  test('Playwright captureUrlInSandbox blocks SSRF without launching browser', async () => {
    delete process.env.ALLOW_LOCAL_SANDBOX;

    const result = await captureUrlInSandbox('http://127.0.0.1:8080/secret');

    assert.equal(result.status, 'BLOCKED_SSRF');
    assert.ok(result.errorMessage?.includes('SSRF'));
  });
});
