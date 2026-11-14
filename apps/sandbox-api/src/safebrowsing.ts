/**
 * Google Safe Browsing API v4 Client
 * 
 * Epic 2.2: Fast blacklist check before or during Playwright sandbox execution
 * Checks URL against Google's global malware, social engineering (phishing), and unwanted software lists.
 */

export interface SafeBrowsingCheckResult {
  isKnownThreat: boolean;
  threatType: string | null;
  platformType?: string | null;
  executionTimeMs: number;
}

export async function checkUrlSafeBrowsing(
  urlToCheck: string,
  apiKey?: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<SafeBrowsingCheckResult> {
  const startTime = Date.now();
  const key = apiKey || process.env.GOOGLE_SAFE_BROWSING_API_KEY;

  if (!key) {
    return {
      isKnownThreat: false,
      threatType: null,
      executionTimeMs: Date.now() - startTime,
    };
  }

  const endpoint = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`;
  const payload = {
    client: { clientId: 'zeroleak-devfest-2026', clientVersion: '1.0.0' },
    threatInfo: {
      threatTypes: [
        'MALWARE',
        'SOCIAL_ENGINEERING',
        'UNWANTED_SOFTWARE',
        'POTENTIALLY_HARMFUL_APPLICATION',
      ],
      platformTypes: ['ANY_PLATFORM'],
      threatEntryTypes: ['URL'],
      threatEntries: [{ url: urlToCheck }],
    },
  };

  const timeoutMs = options.timeoutMs ?? 1500;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const abortListener = () => controller.abort();
  if (options.signal) {
    options.signal.addEventListener('abort', abortListener, { once: true });
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        isKnownThreat: false,
        threatType: null,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const data: any = await res.json();
    const match = data.matches?.[0];

    return {
      isKnownThreat: Boolean(match),
      threatType: match?.threatType || null,
      platformType: match?.platformType || null,
      executionTimeMs: Date.now() - startTime,
    };
  } catch {
    return {
      isKnownThreat: false,
      threatType: null,
      executionTimeMs: Date.now() - startTime,
    };
  } finally {
    clearTimeout(timer);
    if (options.signal) {
      options.signal.removeEventListener('abort', abortListener);
    }
  }
}

