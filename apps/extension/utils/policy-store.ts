import {
  DEFAULT_SECURITY_POLICY,
  type SecurityPolicy,
} from '@zeroleak/shared-types';

const STORAGE_KEY = 'zeroleak_security_policy';

/**
 * Retrieves current policy from chrome.storage.local with fallback
 */
export async function getStoredPolicy(): Promise<SecurityPolicy> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get(STORAGE_KEY);
      if (res && res[STORAGE_KEY]) {
        return res[STORAGE_KEY] as SecurityPolicy;
      }
    }
  } catch (err) {
    console.warn('[ZeroLeak Policy] Failed to read from chrome.storage:', err);
  }
  return { ...DEFAULT_SECURITY_POLICY };
}

/**
 * Saves updated policy to chrome.storage.local
 */
export async function saveStoredPolicy(policy: SecurityPolicy): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY]: policy });
    }
  } catch (err) {
    console.warn('[ZeroLeak Policy] Failed to save to chrome.storage:', err);
  }
}

/**
 * Checks whether the current hostname matches any protected domains in the policy
 */
export function isDomainProtected(hostname: string, policy: SecurityPolicy): boolean {
  if (!policy.protectedDomains || policy.protectedDomains.length === 0) {
    return true; // Default protect all if unspecified
  }
  const cleanHost = hostname ? hostname.toLowerCase() : '';

  // Always protect local test playgrounds, localhost, 127.0.0.1, and local files
  if (!cleanHost || cleanHost === 'localhost' || cleanHost === '127.0.0.1') {
    return true;
  }

  return policy.protectedDomains.some((domain) => {
    const cleanDomain = domain.toLowerCase();
    return cleanDomain === '*' || cleanHost === cleanDomain || cleanHost.endsWith('.' + cleanDomain);
  });
}
