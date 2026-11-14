import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { LruCache, normalizeUrlForCache } from '../src/cache.js';
import { coordinateUrlAnalysis } from '../src/url-analyzer.js';
import { createApp } from '../src/app.js';
import type { PhishingAnalysisResponse } from '@zeroleak/shared-types';

describe('Epic 2.3: In-Memory LRU Cache & URL Normalization', () => {
  test('LruCache basic get, set, has, and delete', () => {
    const cache = new LruCache<string>({ maxEntries: 3, defaultTtlMs: 5000 });

    assert.equal(cache.get('k1'), undefined);
    assert.equal(cache.has('k1'), false);

    cache.set('k1', 'val1');
    assert.equal(cache.has('k1'), true);
    assert.equal(cache.get('k1'), 'val1');
    assert.equal(cache.size, 1);

    cache.delete('k1');
    assert.equal(cache.has('k1'), false);
    assert.equal(cache.get('k1'), undefined);
    assert.equal(cache.size, 0);
  });

  test('LruCache evicts least recently used item when maxEntries is exceeded', () => {
    const cache = new LruCache<string>({ maxEntries: 3 });

    cache.set('a', 'alpha');
    cache.set('b', 'beta');
    cache.set('c', 'gamma');

    // Currently: oldest = 'a', newest = 'c'
    // Access 'a' so 'b' becomes the oldest
    assert.equal(cache.get('a'), 'alpha');

    // Add 'd' -> 'b' should be evicted!
    cache.set('d', 'delta');

    assert.equal(cache.get('b'), undefined, 'b should be evicted as least recently used');
    assert.equal(cache.get('a'), 'alpha', 'a was refreshed so it should be retained');
    assert.equal(cache.get('c'), 'gamma', 'c should be retained');
    assert.equal(cache.get('d'), 'delta', 'd was just added');

    const stats = cache.stats();
    assert.equal(stats.evictions, 1);
    assert.equal(stats.size, 3);
  });

  test('LruCache respects TTL and purges expired entries', async () => {
    const cache = new LruCache<string>({ maxEntries: 10, defaultTtlMs: 50 });

    cache.set('temp', 'temporary', 30); // 30ms TTL
    assert.equal(cache.get('temp'), 'temporary');

    await new Promise((r) => setTimeout(r, 60));

    assert.equal(cache.has('temp'), false);
    assert.equal(cache.get('temp'), undefined);

    const stats = cache.stats();
    assert.ok(stats.expirations >= 1);
  });

  test('normalizeUrlForCache normalizes casing, trailing slashes, and sorts query parameters', () => {
    const url1 = 'HTTPS://VietComBank.com.vn/Login/?b=2&a=1#token';
    const url2 = 'https://vietcombank.com.vn/Login?a=1&b=2';
    const url3 = 'https://vietcombank.com.vn/';
    const url4 = 'https://vietcombank.com.vn';

    assert.equal(normalizeUrlForCache(url1), 'https://vietcombank.com.vn/Login?a=1&b=2');
    assert.equal(normalizeUrlForCache(url2), 'https://vietcombank.com.vn/Login?a=1&b=2');
    assert.equal(normalizeUrlForCache(url3), 'https://vietcombank.com.vn');
    assert.equal(normalizeUrlForCache(url4), 'https://vietcombank.com.vn');

    // Query parameters order is deterministic
    assert.equal(normalizeUrlForCache(url1), normalizeUrlForCache(url2));
  });

  test('coordinateUrlAnalysis uses LRU Cache to return cached result in < 50ms', async () => {
    const testCache = new LruCache<PhishingAnalysisResponse>({ maxEntries: 10 });
    let sandboxCalls = 0;

    const mockCapture = async (url: string) => {
      sandboxCalls++;
      // Simulate 100ms Playwright execution
      await new Promise((r) => setTimeout(r, 100));
      return {
        url,
        finalRedirectUrl: url,
        pageTitle: 'Test Page',
        actualDomain: 'safe-domain.vn',
        hasPasswordInput: false,
        hasOtpInput: false,
        hasSeedPhraseInput: false,
        domSummary: 'Normal page',
        executionTimeMs: 100,
        status: 'SUCCESS' as const,
      };
    };

    const targetUrl = 'https://safe-domain.vn/dashboard';

    // 1. First invocation: Cache Miss (calls sandbox)
    const res1 = await coordinateUrlAnalysis(targetUrl, {
      captureUrl: mockCapture,
      checkSafeBrowsing: async () => ({ isKnownThreat: false, threatType: null, executionTimeMs: 0 }),
      analyzeGemini: async () => ({ riskScore: 10, verdict: 'SAFE', indicators: ['An toàn'] }),
      cache: testCache,
    });

    assert.equal(sandboxCalls, 1);
    assert.equal(res1.verdict, 'SAFE');
    assert.ok(res1.executionTimeMs >= 90, `First call took ${res1.executionTimeMs}ms`);

    // 2. Second invocation: Cache Hit (instant, no sandbox call)
    const res2 = await coordinateUrlAnalysis(targetUrl, {
      captureUrl: mockCapture,
      checkSafeBrowsing: async () => ({ isKnownThreat: false, threatType: null, executionTimeMs: 0 }),
      analyzeGemini: async () => ({ riskScore: 10, verdict: 'SAFE', indicators: ['An toàn'] }),
      cache: testCache,
    });

    assert.equal(sandboxCalls, 1, 'Sandbox should NOT be called on cache hit');
    assert.equal(res2.verdict, 'SAFE');
    assert.ok(res2.executionTimeMs < 50, `Cached call must be < 50ms, took ${res2.executionTimeMs}ms`);

    // 3. Third invocation with noCache: true (bypasses cache)
    const res3 = await coordinateUrlAnalysis(targetUrl, {
      captureUrl: mockCapture,
      checkSafeBrowsing: async () => ({ isKnownThreat: false, threatType: null, executionTimeMs: 0 }),
      analyzeGemini: async () => ({ riskScore: 10, verdict: 'SAFE', indicators: ['An toàn'] }),
      cache: testCache,
      noCache: true,
    });

    assert.equal(sandboxCalls, 2, 'Sandbox should be invoked when noCache: true');
    assert.ok(res3.executionTimeMs >= 90);
  });

  test('POST /api/v1/analyze-url integrates LRU cache and /health reflects cache metrics', async () => {
    const testCache = new LruCache<PhishingAnalysisResponse>({ maxEntries: 100 });
    let executionCount = 0;

    const app = createApp({
      cache: testCache,
      analyzeUrl: async (url, opts) => {
        return coordinateUrlAnalysis(url, {
          ...opts,
          cache: testCache,
          captureUrl: async (u) => {
            executionCount++;
            return {
              url: u,
              finalRedirectUrl: u,
              pageTitle: 'Bank Demo',
              actualDomain: 'demo-site.vn',
              hasPasswordInput: true,
              hasOtpInput: false,
              hasSeedPhraseInput: false,
              domSummary: 'form login',
              executionTimeMs: 10,
              status: 'SUCCESS',
            };
          },
          checkSafeBrowsing: async () => ({ isKnownThreat: false, threatType: null, executionTimeMs: 0 }),
          analyzeGemini: async () => ({ riskScore: 50, verdict: 'SUSPICIOUS', indicators: ['Form login'] }),
        });
      },
    });

    // 1. Initial request -> cache miss
    const res1 = await app.request('/api/v1/analyze-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://demo-site.vn/login' }),
    });
    assert.equal(res1.status, 200);
    assert.equal(executionCount, 1);

    // 2. Repeat request -> cache hit
    const res2 = await app.request('/api/v1/analyze-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://demo-site.vn/login' }),
    });
    assert.equal(res2.status, 200);
    assert.equal(executionCount, 1, 'Should not re-execute on cache hit');

    // 3. Verify /health returns cache stats
    const healthRes = await app.request('/health');
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.cache.urlAnalysis.hits, 1);
    assert.equal(healthData.cache.urlAnalysis.misses, 1);
    assert.equal(healthData.cache.urlAnalysis.size, 1);

    // 4. Clear cache endpoint
    const clearRes = await app.request('/api/v1/clear-cache', { method: 'POST' });
    assert.equal(clearRes.status, 200);
    assert.equal(testCache.size, 0);
  });
});

