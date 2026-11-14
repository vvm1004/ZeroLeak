import { defineBackground } from 'wxt/sandbox';
import {
  DEFAULT_SECURITY_POLICY,
  type SecurityPolicy,
  type ZeroKnowledgeTelemetryEvent,
} from '@zeroleak/shared-types';
import { localSyncBus } from '@zeroleak/firebase-config';
import { analyzeUrlWithSandbox } from '../utils/phishing-client';

export default defineBackground(() => {
  console.log('[ZeroLeak Background] Service worker active.');

  const STORAGE_KEY = 'zeroleak_security_policy';
  const TELEMETRY_KEY = 'zeroleak_telemetry_history';

  // 1. Initialize default policy & context menus on install
  chrome.runtime.onInstalled.addListener(async () => {
    const existing = await chrome.storage.local.get(STORAGE_KEY);
    if (!existing[STORAGE_KEY]) {
      await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_SECURITY_POLICY });
      console.log('[ZeroLeak Background] Initialized default security policy.');
    }

    // Context Menu: Link inspection
    chrome.contextMenus.create({
      id: 'phishguard-scan-link',
      title: '🛡️ Kiểm tra liên kết an toàn với ZeroLeak Lens',
      contexts: ['link'],
    });

    // Context Menu: Screen QR scanning
    chrome.contextMenus.create({
      id: 'phishguard-scan-qr',
      title: '📷 Quét mã QR trên màn hình (ZeroLeak Lens)',
      contexts: ['page', 'image'],
    });
  });

  // 2. Handle Context Menu clicks
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;

    if (info.menuItemId === 'phishguard-scan-link' && info.linkUrl) {
      console.log('[ZeroLeak Background] Scanning link from context menu:', info.linkUrl);
      chrome.tabs.sendMessage(tab.id, {
        type: 'PHISHGUARD_SCAN_URL',
        url: info.linkUrl,
      });
    }

    if (info.menuItemId === 'phishguard-scan-qr') {
      console.log('[ZeroLeak Background] Triggering interactive QR scan');
      chrome.tabs.sendMessage(tab.id, {
        type: 'TRIGGER_QR_SCAN',
      }, () => {
        if (chrome.runtime.lastError) {
          chrome.scripting
            .executeScript({
              target: { tabId: tab.id! },
              files: ['content-scripts/content.js'],
            })
            .then(() => {
              setTimeout(() => {
                chrome.tabs.sendMessage(tab.id!, { type: 'TRIGGER_QR_SCAN' });
              }, 150);
            })
            .catch((err) => {
              console.warn('[ZeroLeak Background] Dynamic script injection not supported on this tab:', err);
            });
        }
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
              chrome.tabs
                .sendMessage(tab.id, {
                  type: 'POLICY_UPDATED',
                  policy: updatedPolicy,
                })
                .catch(() => {
                  // Ignore tabs without content scripts
                });
            }
          }
        });
        sendResponse({ status: 'ok' });
      });
      return true;
    }

    // Capture visible tab screenshot for QR decoding
    if (message?.type === 'CAPTURE_VISIBLE_TAB') {
      chrome.tabs
        .captureVisibleTab({ format: 'png' })
        .then((dataUrl) => {
          sendResponse({ dataUrl });
        })
        .catch((err) => {
          console.warn('[ZeroLeak Background] Capture tab failed:', err);
          sendResponse({ error: err.message });
        });
      return true;
    }

    // Analyze phishing URL via Cloud Sandbox (with hard timeout & local fallback)
    if (message?.type === 'ANALYZE_PHISHING_URL') {
      analyzeUrlWithSandbox(message.url, message.sourceContext || 'CONTEXT_MENU')
        .then((result) => {
          sendResponse({ result });
        })
        .catch((err) => {
          sendResponse({ error: err.message });
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
