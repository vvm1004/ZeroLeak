/**
 * Reversible Token Vault (ZeroLeak On-Device Vault)
 * Stores reversible token mappings [TOKEN_01] <-> "Sensitive Value"
 * Strictly 100% local on the client browser (In-Memory Map + SessionStorage).
 *
 * Strict Guardrail 1: ZERO RAW PII EXFILTRATION.
 */

import type { SensitiveDataType, TokenVaultEntry, DlpDetectionMatch } from '@zeroleak/shared-types';

export class ReversibleTokenVault {
  private inMemoryVault = new Map<string, TokenVaultEntry>();
  private reverseLookup = new Map<string, string>(); // originalValue -> token
  private readonly storageKey = 'zeroleak_token_vault_v1';
  private listeners: Array<() => void> = [];

  constructor() {
    this.loadFromSessionStorage();
  }

  /**
   * Stores a token placeholder to original value mapping with metadata
   */
  public store(
    token: string,
    originalValue: string,
    type: SensitiveDataType = 'PERSON_NAME'
  ): TokenVaultEntry {
    const entry: TokenVaultEntry = {
      token,
      originalValue,
      type,
      createdAt: Date.now(),
    };

    this.inMemoryVault.set(token, entry);
    this.reverseLookup.set(originalValue, token);
    this.persistToSessionStorage();
    this.notifyListeners();
    return entry;
  }

  /**
   * Batch stores detection matches from a DLP scan
   */
  public storeMatches(matches: DlpDetectionMatch[]): void {
    if (!matches || matches.length === 0) return;

    for (const match of matches) {
      const entry: TokenVaultEntry = {
        token: match.tokenPlaceholder,
        originalValue: match.originalValue,
        type: match.type,
        createdAt: Date.now(),
      };
      this.inMemoryVault.set(match.tokenPlaceholder, entry);
      this.reverseLookup.set(match.originalValue, match.tokenPlaceholder);
    }

    this.persistToSessionStorage();
    this.notifyListeners();
  }

  /**
   * Resolves a token placeholder back to its original plain text value
   * Returns undefined if token is unknown.
   */
  public resolve(token: string): string | undefined {
    return this.inMemoryVault.get(token)?.originalValue;
  }

  /**
   * Gets the full entry (value, type, timestamp) for a token
   */
  public getEntry(token: string): TokenVaultEntry | undefined {
    return this.inMemoryVault.get(token);
  }

  /**
   * Check if a token exists in the vault
   */
  public has(token: string): boolean {
    return this.inMemoryVault.has(token);
  }

  /**
   * Finds an existing token placeholder for an identical sensitive string
   * Ensures identical PII receives the same placeholder token within a session.
   */
  public findTokenByValue(originalValue: string): string | undefined {
    return this.reverseLookup.get(originalValue);
  }

  /**
   * Returns all active token keys
   */
  public getAllTokens(): string[] {
    return Array.from(this.inMemoryVault.keys());
  }

  /**
   * Returns all stored entries
   */
  public getAllEntries(): TokenVaultEntry[] {
    return Array.from(this.inMemoryVault.values());
  }

  /**
   * Total number of stored sensitive tokens
   */
  public size(): number {
    return this.inMemoryVault.size;
  }

  /**
   * Subscribes to vault changes
   */
  public subscribe(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('[ZeroLeak Vault] Listener notification error:', err);
      }
    }
  }

  /**
   * Clears the current session vault
   */
  public clear(): void {
    this.inMemoryVault.clear();
    this.reverseLookup.clear();
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(this.storageKey);
      }
    } catch {
      // Ignore sessionStorage access errors
    }
    this.notifyListeners();
  }

  private persistToSessionStorage(): void {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const records = Array.from(this.inMemoryVault.entries());
        sessionStorage.setItem(this.storageKey, JSON.stringify(records));
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
          if (Array.isArray(parsed)) {
            for (const [token, entry] of parsed) {
              if (token && entry && entry.originalValue) {
                this.inMemoryVault.set(token, entry);
                this.reverseLookup.set(entry.originalValue, token);
              }
            }
          } else if (typeof parsed === 'object') {
            // Backward compatibility with key-value string format
            for (const [token, val] of Object.entries(parsed)) {
              if (typeof val === 'string') {
                const entry: TokenVaultEntry = {
                  token,
                  originalValue: val,
                  type: 'PERSON_NAME',
                  createdAt: Date.now(),
                };
                this.inMemoryVault.set(token, entry);
                this.reverseLookup.set(val, token);
              }
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
