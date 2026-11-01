import { defineBackground } from 'wxt/sandbox';
import {
  DEFAULT_SECURITY_POLICY,
  type SecurityPolicy,
  type ZeroKnowledgeTelemetryEvent,
} from '@zeroleak/shared-types';
import { localSyncBus, FIRESTORE_COLLECTIONS } from '@zeroleak/firebase-config';

export default defineBackground(() => {
  console.log('[ZeroLeak Background] Service worker active.');

  const STORAGE_KEY = 'zeroleak_security_policy';
  const TELEMETRY_KEY = 'zeroleak_telemetry_history';

  // 1. Initialize default policy on install
  chrome.runtime.onInstalled.addListener(async () => {
    const existing = await chrome.storage.local.get(STORAGE_KEY);
    if (!existing[STORAGE_KEY]) {
      await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_SECURITY_POLICY });
      console.log('[ZeroLeak Background] Initialized default security policy.');
    }

    // Set up right-click Context Menu
    chrome.contextMenus.create({
      id: 'phishguard-scan-link',
      title: '🛡️ Kiểm tra an toàn bằng PhishGuard',
      contexts: ['link'],
    });
  });

  // 2. Handle Context Menu clicks
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'phishguard-scan-link' && info.linkUrl && tab?.id) {
      console.log('[PhishGuard Background] Scanning link:', info.linkUrl);
      chrome.tabs.sendMessage(tab.id, {
        type: 'PHISHGUARD_SCAN_URL',
        url: info.linkUrl,
      });
    }
  });

  // 3. Message Router (Content script <-> Background <-> Popup)
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'TELEMETRY_LOG') {
      handleTelemetryLog(message.event);
      sendResponse({ status: 'ok' });
      return true;
    }

    if (message?.type === 'GET_POLICY') {
      chrome.storage.local.get(STORAGE_KEY).then((res) => {
        sendResponse(res[STORAGE_KEY] || DEFAULT_SECURITY_POLICY);
      });
      return true;
    }

    if (message?.type === 'UPDATE_POLICY') {
      const updatedPolicy: SecurityPolicy = message.policy;
      chrome.storage.local.set({ [STORAGE_KEY]: updatedPolicy }).then(() => {
        // Broadcast to all open tabs so Content Scripts update in real time
        chrome.tabs.query({}, (tabs) => {
          for (const tab of tabs) {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, {
                type: 'POLICY_UPDATED',
                policy: updatedPolicy,
              }).catch(() => {
                // Ignore errors for tabs without content scripts
              });
            }
          }
        });
        sendResponse({ status: 'ok' });
      });
      return true;
    }

    return false;
  });

  async function handleTelemetryLog(event: ZeroKnowledgeTelemetryEvent) {
    try {
      // 1. Save to local storage ring buffer for popup visualization
      const current = await chrome.storage.local.get(TELEMETRY_KEY);
      const history: ZeroKnowledgeTelemetryEvent[] = current[TELEMETRY_KEY] || [];
      history.unshift(event);
      if (history.length > 50) history.pop();
      await chrome.storage.local.set({ [TELEMETRY_KEY]: history });

      // 2. Emit to realtime sync bus (BroadcastChannel & Firestore)
      await localSyncBus.logTelemetry(event);

      console.log(`[ZeroLeak Telemetry] Logged incident on ${event.targetDomain} (${event.actionTaken})`);
    } catch (err) {
      console.warn('[ZeroLeak Background] Telemetry log error:', err);
    }
  }
});
