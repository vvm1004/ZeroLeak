/**
 * ZeroLeak Lens — In-Memory LRU Cache
 *
 * Implements an O(1) Least Recently Used cache with TTL expiration.
 * Used to store URL analysis results so repeated checks (e.g. during hackathon demo)
 * return instantly in < 50ms (typically < 2ms) without re-invoking Playwright or Gemini.
 */

import type { PhishingAnalysisResponse } from '@zeroleak/shared-types';

export interface CacheOptions {
  /** Maximum number of entries before LRU eviction. Defaults to 500. */
  maxEntries?: number;
  /** Default Time-to-Live in milliseconds. Defaults to 10 minutes (600,000ms). */
  defaultTtlMs?: number;
}

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  addedAt: number;
  accessCount: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
  size: number;
  maxEntries: number;
}

export class LruCache<T> {
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;
  private readonly map: Map<string, CacheEntry<T>>;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private expirations = 0;

  constructor(options: CacheOptions = {}) {
    this.maxEntries = options.maxEntries && options.maxEntries > 0 ? options.maxEntries : 500;
    this.defaultTtlMs = options.defaultTtlMs && options.defaultTtlMs > 0 ? options.defaultTtlMs : 10 * 60 * 1000;
    this.map = new Map();
  }

  /**
   * Retrieves an item from cache.
   * If expired, purges the item and returns undefined.
   * If found and valid, refreshes item's LRU position to the tail (most recently used).
   */
  public get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    const now = Date.now();
    if (entry.expiresAt <= now) {
      this.map.delete(key);
      this.expirations++;
      this.misses++;
      return undefined;
    }

    // Refresh LRU order: delete and re-insert at end of Map
    this.map.delete(key);
    entry.accessCount++;
    this.map.set(key, entry);
    this.hits++;
    return entry.value;
  }

  /**
   * Stores an item in the cache.
   * If capacity is exceeded, evicts the least recently used item (the head of Map iterator).
   */
  public set(key: string, value: T, ttlMs?: number): void {
    const ttl = typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : this.defaultTtlMs;
    const now = Date.now();

    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      // Evict oldest (least recently used) entry
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
        this.evictions++;
      }
    }

    this.map.set(key, {
      value,
      expiresAt: now + ttl,
      addedAt: now,
      accessCount: 1,
    });
  }

  /**
   * Checks whether a valid (non-expired) entry exists for the given key.
   */
  public has(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      this.expirations++;
      return false;
    }
    return true;
  }

  /**
   * Removes an entry from cache.
   */
  public delete(key: string): boolean {
    return this.map.delete(key);
  }

  /**
   * Clears all entries and resets statistics.
   */
  public clear(): void {
    this.map.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.expirations = 0;
  }

  /**
   * Current number of items in cache.
   */
  public get size(): number {
    return this.map.size;
  }

  /**
   * Returns cache metrics (hits, misses, evictions, expirations, size).
   */
  public stats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      expirations: this.expirations,
      size: this.map.size,
      maxEntries: this.maxEntries,
    };
  }
}

/**
 * Normalizes a URL for consistent cache indexing.
 * Ensures case insensitivity for scheme and host, sorts query parameters,
 * and strips redundant trailing slashes.
 */
export function normalizeUrlForCache(rawUrl: string): string {
  try {
    const trimmed = rawUrl.trim();
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(trimmed);
    const url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    const protocol = url.protocol.toLowerCase();
    const host = url.host.toLowerCase();

    // Sort query parameters deterministically
    const searchParams = new URLSearchParams(url.search);
    const sortedKeys = Array.from(searchParams.keys()).sort();
    const sortedParams = new URLSearchParams();
    for (const key of sortedKeys) {
      for (const val of searchParams.getAll(key)) {
        sortedParams.append(key, val);
      }
    }
    const search = sortedParams.toString() ? `?${sortedParams.toString()}` : '';

    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    } else if (pathname === '/') {
      pathname = '';
    }

    return `${protocol}//${host}${pathname}${search}`;
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

/**
 * Global singleton cache instance for URL analysis results.
 */
export const defaultUrlAnalysisCache = new LruCache<PhishingAnalysisResponse>({
  maxEntries: 500,
  defaultTtlMs: 10 * 60 * 1000, // 10 minutes
});
