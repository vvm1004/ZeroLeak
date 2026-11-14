/**
 * ZeroLeak Lens — Playwright Headless Sandbox
 * 
 * Epic 2.1: Isolated Playwright Headless Browser Server
 * - SSRF Protection (blocks private, link-local, loopback, and metadata IPs)
 * - Viewport: 1280x720, Chromium Headless
 * - Max page load timeout: 2000ms
 * - DOM inspection: detects password, OTP, seed phrase inputs
 * - Lightweight WebP screenshot capture (Base64)
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { isIP } from 'node:net';

export interface PlaywrightCaptureResult {
  url: string;
  finalRedirectUrl: string;
  pageTitle: string;
  actualDomain: string;
  hasPasswordInput: boolean;
  hasOtpInput: boolean;
  hasSeedPhraseInput: boolean;
  domSummary: string;
  screenshotBase64?: string;
  executionTimeMs: number;
  status: 'SUCCESS' | 'NAVIGATION_TIMEOUT' | 'UNREACHABLE' | 'BLOCKED_SSRF';
  errorMessage?: string;
}

// Global browser instance management
let browserInstance: Browser | null = null;
let isLaunching = false;

/**
 * Get or initialize the singleton Playwright Chromium browser
 */
export async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  if (isLaunching) {
    // Wait until current launch finishes
    while (isLaunching) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (browserInstance && browserInstance.isConnected()) {
      return browserInstance;
    }
  }

  isLaunching = true;
  try {
    browserInstance = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--no-first-run',
      ],
    });
    return browserInstance;
  } finally {
    isLaunching = false;
  }
}

/**
 * Gracefully close the shared browser instance
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {
      // Ignored
    } finally {
      browserInstance = null;
    }
  }
}

/**
 * Validates a URL against Server-Side Request Forgery (SSRF) vulnerabilities.
 * Blocks private IP ranges, loopback, link-local (AWS/GCP metadata 169.254.169.254), and local hostnames.
 */
export function validateUrlSafety(rawUrl: string): { safe: boolean; reason?: string; parsedUrl?: URL } {
  let parsed: URL;
  try {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawUrl)) {
      parsed = new URL(rawUrl);
    } else {
      parsed = new URL(`https://${rawUrl}`);
    }
  } catch {
    return { safe: false, reason: 'URL không đúng định dạng chuẩn RFC' };
  }

  // Only allow HTTP and HTTPS
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: `Giao thức không được hỗ trợ: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Allow test domains if explicitly configured for development/testing
  if (process.env.ALLOW_LOCAL_SANDBOX === 'true' && (hostname === 'localhost' || hostname === '127.0.0.1')) {
    return { safe: true, parsedUrl: parsed };
  }

  // Block localhost and internal names
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan')
  ) {
    return { safe: false, reason: 'Chặn truy cập vào tên miền nội bộ / localhost (SSRF Protection)' };
  }

  // Check numeric IPv4 or IPv6
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    if (isPrivateIpv4(hostname)) {
      return { safe: false, reason: `Chặn truy cập vào địa chỉ IP nội bộ: ${hostname} (SSRF Protection)` };
    }
  } else if (ipVersion === 6) {
    if (isPrivateIpv6(hostname)) {
      return { safe: false, reason: `Chặn truy cập vào địa chỉ IPv6 nội bộ: ${hostname} (SSRF Protection)` };
    }
  }

  // Block decimal IP notation (e.g., http://2130706433/ which translates to 127.0.0.1)
  if (/^\d+$/.test(hostname)) {
    return { safe: false, reason: 'Chặn địa chỉ IP dạng số nguyên (SSRF Protection)' };
  }

  return { safe: true, parsedUrl: parsed };
}

/**
 * Checks if an IPv4 address is in a private, loopback, or metadata range
 */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true;
  }

  // 127.0.0.0/8 (Loopback)
  if (parts[0] === 127) return true;
  // 10.0.0.0/8 (Private)
  if (parts[0] === 10) return true;
  // 172.16.0.0/12 (Private)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16 (Private)
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 169.254.0.0/16 (Link-local / Cloud metadata service)
  if (parts[0] === 169 && parts[1] === 254) return true;
  // 0.0.0.0/8 (Current network)
  if (parts[0] === 0) return true;
  // 100.64.0.0/10 (Carrier grade NAT)
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;

  return false;
}

/**
 * Checks if an IPv6 address is private or loopback
 */
export function isPrivateIpv6(ip: string): boolean {
  const clean = ip.toLowerCase();
  if (clean === '::1' || clean === '::' || clean.startsWith('fe80:') || clean.startsWith('fc00:') || clean.startsWith('fd00:')) {
    return true;
  }
  return false;
}

/**
 * Opens a target URL in an isolated Playwright Headless Chromium instance.
 * Extracts DOM metadata, form elements, and captures a lightweight WebP screenshot.
 */
export async function captureUrlInSandbox(
  rawUrl: string,
  options: {
    timeoutMs?: number;
    viewport?: { width: number; height: number };
  } = {}
): Promise<PlaywrightCaptureResult> {
  const startTime = Date.now();
  const timeoutMs = options.timeoutMs ?? 3500;
  const viewport = options.viewport ?? { width: 1280, height: 720 };

  // 1. SSRF Safety Validation
  const safetyCheck = validateUrlSafety(rawUrl);
  if (!safetyCheck.safe || !safetyCheck.parsedUrl) {
    return {
      url: rawUrl,
      finalRedirectUrl: rawUrl,
      pageTitle: '',
      actualDomain: rawUrl,
      hasPasswordInput: false,
      hasOtpInput: false,
      hasSeedPhraseInput: false,
      domSummary: 'Blocked by SSRF filter',
      executionTimeMs: Date.now() - startTime,
      status: 'BLOCKED_SSRF',
      errorMessage: safetyCheck.reason || 'Blocked by SSRF security filter',
    };
  }

  const normalizedUrl = safetyCheck.parsedUrl.toString();
  const initialDomain = safetyCheck.parsedUrl.hostname;

  let browser: Browser;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    browser = await getBrowser();
    context = await browser.newContext({
      viewport,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
      permissions: [],
    });

    page = await context.newPage();

    // 2. Network Routing Guard: Abort any sub-requests to internal IPs (SSRF defense in depth)
    await page.route('**/*', (route) => {
      const requestUrl = route.request().url();
      const check = validateUrlSafety(requestUrl);
      if (!check.safe) {
        route.abort('blockedbyclient');
      } else {
        route.continue();
      }
    });

    // 3. Navigation with strict timeout
    let status: PlaywrightCaptureResult['status'] = 'SUCCESS';
    let errorMessage: string | undefined;

    try {
      await page.goto(normalizedUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
    } catch (navErr: any) {
      if (navErr?.name === 'TimeoutError' || navErr?.message?.includes('timeout')) {
        status = 'NAVIGATION_TIMEOUT';
        errorMessage = `Quá thời gian tải trang (${timeoutMs}ms)`;
      } else {
        status = 'UNREACHABLE';
        errorMessage = navErr?.message || 'Không thể kết nối đến trang web';
      }
    }

    const currentUrl = page.url();
    const finalRedirectUrl = currentUrl && currentUrl !== 'about:blank' ? currentUrl : normalizedUrl;
    let actualDomain = initialDomain;
    try {
      if (finalRedirectUrl && finalRedirectUrl !== 'about:blank') {
        actualDomain = new URL(finalRedirectUrl).hostname || initialDomain;
      }
    } catch {
      actualDomain = initialDomain;
    }

    let pageTitle = '';
    try {
      pageTitle = await page.title();
    } catch {
      // Ignored
    }

    // 4. DOM Analysis (password, OTP, seed phrase inputs, form structure)
    const domInspection = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, textarea'));
      let hasPassword = false;
      let hasOtp = false;
      let hasSeedPhrase = false;

      const inputDetails: string[] = [];

      for (const el of inputs) {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        const name = (el.getAttribute('name') || '').toLowerCase();
        const id = (el.id || '').toLowerCase();
        const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
        const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
        const maxlength = el.getAttribute('maxlength') || '';

        const signature = `${name} ${id} ${placeholder} ${autocomplete}`;

        if (type === 'password') {
          hasPassword = true;
        }

        // OTP detection heuristics
        const isOtpName = /otp|one-time|xac-thuc|xac-nhan|verification|passcode/i.test(signature);
        const isOtpLength = (maxlength === '4' || maxlength === '6') && (type === 'tel' || type === 'number' || type === 'text');
        if (autocomplete === 'one-time-code' || isOtpName || isOtpLength) {
          hasOtp = true;
        }

        // Seed phrase / recovery phrase detection heuristics
        if (/seed|mnemonic|recovery-phrase|12-word|24-word/i.test(signature)) {
          hasSeedPhrase = true;
        }

        inputDetails.push(`[${type}] name="${name}" id="${id}" placeholder="${placeholder}"`);
      }

      const forms = Array.from(document.querySelectorAll('form'));
      const formDetails = forms.map((f, i) => {
        const action = f.getAttribute('action') || '';
        const method = (f.getAttribute('method') || 'GET').toUpperCase();
        return `Form #${i + 1}: method=${method} action="${action}"`;
      });

      return {
        hasPassword,
        hasOtp,
        hasSeedPhrase,
        domSummary: `Tiêu đề: "${document.title}" | Form count: ${forms.length}\n${formDetails.join('\n')}\nInputs:\n${inputDetails.slice(0, 15).join('\n')}`,
      };
    }).catch(() => ({
      hasPassword: false,
      hasOtp: false,
      hasSeedPhrase: false,
      domSummary: 'Không thể trích xuất DOM',
    }));

    // 5. Screenshot capture in lightweight WebP format
    let screenshotBase64: string | undefined;
    try {
      const isBlank = !page.url() || page.url() === 'about:blank';
      if (!isBlank && (status === 'SUCCESS' || status === 'NAVIGATION_TIMEOUT')) {
        const screenshotBuffer = await page.screenshot({
          type: 'webp',
          quality: 70,
          timeout: 2500,
        });
        screenshotBase64 = screenshotBuffer.toString('base64');
      }
    } catch {
      // Ignored if screenshot failed (e.g. empty or unreachable page)
    }

    return {
      url: rawUrl,
      finalRedirectUrl,
      pageTitle: pageTitle || '',
      actualDomain,
      hasPasswordInput: domInspection.hasPassword,
      hasOtpInput: domInspection.hasOtp,
      hasSeedPhraseInput: domInspection.hasSeedPhrase,
      domSummary: domInspection.domSummary,
      screenshotBase64,
      executionTimeMs: Date.now() - startTime,
      status,
      errorMessage,
    };
  } catch (err: any) {
    return {
      url: rawUrl,
      finalRedirectUrl: rawUrl,
      pageTitle: '',
      actualDomain: initialDomain,
      hasPasswordInput: false,
      hasOtpInput: false,
      hasSeedPhraseInput: false,
      domSummary: 'Error executing Playwright sandbox',
      executionTimeMs: Date.now() - startTime,
      status: 'UNREACHABLE',
      errorMessage: err?.message || 'Playwright sandbox failure',
    };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
    if (context) {
      await context.close().catch(() => {});
    }
  }
}
