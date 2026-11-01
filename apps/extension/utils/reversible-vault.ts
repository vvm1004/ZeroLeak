/**
 * Reversible Token Vault (ZeroLeak On-Device Vault)
 * Stores reversible token mappings [TOKEN_01] <-> "Sensitive Value"
 * Strictly 100% local on the client browser.
 */

class ReversibleTokenVault {
  private inMemoryVault = new Map<string, string>();
  private readonly storageKey = 'zeroleak_token_vault';

  constructor() {
    this.loadFromSessionStorage();
  }

  /**
   * Stores a token placeholder to original value mapping
   */
  public store(token: string, originalValue: string): void {
    this.inMemoryVault.set(token, originalValue);
    this.persistToSessionStorage();
  }

  /**
   * Batch store matches from a DLP scan
   */
  public storeMatches(matches: Array<{ tokenPlaceholder: string; originalValue: string }>): void {
    for (const match of matches) {
      this.inMemoryVault.set(match.tokenPlaceholder, match.originalValue);
    }
    this.persistToSessionStorage();
  }

  /**
   * Resolves a token placeholder back to its original plain text value
   */
  public resolve(token: string): string | undefined {
    return this.inMemoryVault.get(token);
  }

  /**
   * Returns all active tokens
   */
  public getAllTokens(): string[] {
    return Array.from(this.inMemoryVault.keys());
  }

  /**
   * Clears the current session vault
   */
  public clear(): void {
    this.inMemoryVault.clear();
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(this.storageKey);
      }
    } catch {
      // Ignore sessionStorage access errors
    }
  }

  private persistToSessionStorage(): void {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const obj = Object.fromEntries(this.inMemoryVault);
        sessionStorage.setItem(this.storageKey, JSON.stringify(obj));
      }
    } catch (e) {
      console.warn('[ZeroLeak Vault] Failed to persist to sessionStorage:', e);
    }
  }

  private loadFromSessionStorage(): void {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const raw = sessionStorage.getItem(this.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'string') {
              this.inMemoryVault.set(k, v);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[ZeroLeak Vault] Failed to load from sessionStorage:', e);
    }
  }
}

export const tokenVault = new ReversibleTokenVault();
