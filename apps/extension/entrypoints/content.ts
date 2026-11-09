import { defineContentScript } from 'wxt/sandbox';
import React from 'react';
import ReactDOM from 'react-dom/client';
import type {
  ZeroKnowledgeTelemetryEvent,
  PhishingAnalysisResponse,
  PolicyActionMode,
} from '@zeroleak/shared-types';
import { replaceSelectionInEditableElement, isEditableElement } from '../utils/dom-replacer';
import { dlpClient } from '../utils/dlp-worker-client';
import { tokenVault } from '../utils/reversible-vault';
import { getStoredPolicy, isDomainProtected } from '../utils/policy-store';
import { NotificationToast, type ToastMessage } from '../components/NotificationToast';
import { TelemetryBadge } from '../components/TelemetryBadge';
import { PhishingModal } from '../components/PhishingModal';
import { streamRestorer } from '../utils/dom-observer';
import {
  activateInteractiveQrSnipper,
  decodeQrFromCrop,
} from '../utils/qr-scanner';
import { analyzeUrlWithSandbox } from '../utils/phishing-client';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',

  main(ctx) {
    console.log('[ZeroLeak] Content script initialized on', window.location.hostname);

    let activePolicy = null as Awaited<ReturnType<typeof getStoredPolicy>> | null;
    let toastUpdater: ((msg: ToastMessage | null) => void) | null = null;
    let latencyUpdater: ((latency: number | null) => void) | null = null;
    let countUpdater: ((count: number) => void) | null = null;
    let modeUpdater: ((mode: PolicyActionMode) => void) | null = null;
    let modalUpdater: ((modal: PhishingAnalysisResponse | null) => void) | null = null;

    // 1. Initialize Policy
    getStoredPolicy().then((policy) => {
      activePolicy = policy;
      if (modeUpdater) modeUpdater(policy.mode);
    });

    // Listen for policy updates broadcast from background service worker
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'POLICY_UPDATED') {
        activePolicy = message.policy;
        if (modeUpdater && activePolicy) modeUpdater(activePolicy.mode);
        console.log('[ZeroLeak] Live policy updated:', activePolicy?.mode);
      }
    });

    // 2. Mount Shadow DOM Root for Complete Style Isolation (Strict Guardrail 3)
    function mountShadowRootUi() {
      const host = document.createElement('zeroleak-shadow-host');
      host.style.position = 'fixed';
      host.style.zIndex = '2147483647';
      host.style.pointerEvents = 'none';
      host.style.top = '0';
      host.style.left = '0';
      host.style.width = '100vw';
      host.style.height = '100vh';

      const shadow = host.attachShadow({ mode: 'open' });
      const mountPoint = document.createElement('div');
      mountPoint.style.width = '100%';
      mountPoint.style.height = '100%';
      mountPoint.style.pointerEvents = 'none';
      shadow.appendChild(mountPoint);

      const UnifiedShadowApp = () => {
        const [toast, setToast] = React.useState<ToastMessage | null>(null);
        const [lastLatency, setLastLatency] = React.useState<number | null>(null);
        const [shieldedCount, setShieldedCount] = React.useState<number>(tokenVault.size());
        const [currentMode, setCurrentMode] = React.useState<PolicyActionMode>(
          activePolicy?.mode || 'AUTO_TOKENIZE'
        );
        const [analysisModal, setAnalysisModal] = React.useState<PhishingAnalysisResponse | null>(null);

        toastUpdater = setToast;
        latencyUpdater = setLastLatency;
        countUpdater = setShieldedCount;
        modeUpdater = setCurrentMode;
        modalUpdater = setAnalysisModal;

        React.useEffect(() => {
          const unsubscribe = tokenVault.subscribe(() => {
            setShieldedCount(tokenVault.size());
          });
          return unsubscribe;
        }, []);

        return React.createElement(
          React.Fragment,
          null,
          React.createElement(NotificationToast, {
            message: toast,
            onDismiss: () => setToast(null),
          }),
          React.createElement(TelemetryBadge, {
            policyMode: currentMode,
            latencyMs: lastLatency,
            shieldedCount: shieldedCount,
            onScanQrClick: handleTriggerQrScan,
            onClearVaultClick: () => {
              tokenVault.clear();
              setShieldedCount(0);
              showToast({
                id: String(Date.now()),
                type: 'AUDIT',
                title: 'Đã xóa Vault',
                detail: 'Bộ nhớ mã giả On-Device đã được dọn sạch.',
              });
            },
          }),
          React.createElement(PhishingModal, {
            analysis: analysisModal,
            onClose: () => setAnalysisModal(null),
          })
        );
      };

      const root = ReactDOM.createRoot(mountPoint);
      root.render(React.createElement(UnifiedShadowApp));

      const appendHost = () => {
        if (document.body && !document.body.contains(host)) {
          document.body.appendChild(host);
        }
      };

      if (document.body) {
        appendHost();
      } else {
        window.addEventListener('DOMContentLoaded', appendHost);
      }
    }

    mountShadowRootUi();

    // 3. Initialize Reversible Stream Response Restorer (MutationObserver)
    const initRestorer = () => {
      const root = document.body || document.documentElement;
      if (root) {
        streamRestorer.start(root);
      }
    };

    if (document.body) {
      initRestorer();
    } else {
      window.addEventListener('DOMContentLoaded', initRestorer, { once: true });
    }

    function showToast(msg: ToastMessage) {
      if (toastUpdater) {
        toastUpdater(msg);
      }
    }

    function updateMetrics(latencyMs: number, matchesCount: number) {
      if (latencyUpdater) latencyUpdater(latencyMs);
      if (countUpdater) countUpdater(tokenVault.size());
    }

    function emitTelemetry(
      actionTaken: 'AUTO_TOKENIZE' | 'STRICT_BLOCK' | 'AUDIT_ONLY',
      types: any[],
      count: number,
      latencyMs: number
    ) {
      const telemetry: ZeroKnowledgeTelemetryEvent = {
        id: 'evt_' + Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toISOString(),
        targetDomain: window.location.hostname,
        actionTaken,
        detectedTypes: types,
        matchCount: count,
        scanLatencyMs: latencyMs,
      };

      try {
        chrome.runtime.sendMessage({
          type: 'TELEMETRY_LOG',
          event: telemetry,
        });
      } catch {
        // Safe catch if background service worker is temporarily inactive
      }
    }

    // -------------------------------------------------------------------------
    // 4. QR SCANNER & PHISHING WORKFLOWS
    // -------------------------------------------------------------------------

    async function handleTriggerQrScan() {
      showToast({
        id: String(Date.now()),
        type: 'AUDIT',
        title: 'ZeroLeak Lens: Quét mã QR',
        detail: 'Hãy khoanh vùng mã QR trên màn hình cần kiểm tra.',
      });

      const region = await activateInteractiveQrSnipper();
      if (!region) {
        return;
      }

      showToast({
        id: String(Date.now()),
        type: 'AUDIT',
        title: 'Đang chụp & giải mã QR...',
        detail: 'ZeroLeak đang đọc dữ liệu từ ảnh chụp màn hình...',
      });

      chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' }, async (response) => {
        if (!response?.dataUrl) {
          showToast({
            id: String(Date.now()),
            type: 'BLOCKED',
            title: 'Lỗi chụp màn hình',
            detail: 'Không thể chụp ảnh màn hình để giải mã QR.',
          });
          return;
        }

        const qrResult = await decodeQrFromCrop(response.dataUrl, region);
        if (!qrResult || !qrResult.data) {
          showToast({
            id: String(Date.now()),
            type: 'BLOCKED',
            title: 'Không tìm thấy mã QR',
            detail: 'Vùng chọn không chứa mã QR hợp lệ. Vui lòng thử lại.',
          });
          return;
        }

        const qrData = qrResult.data.trim();
        console.log('[ZeroLeak QR] Decoded content:', qrData);

        const isUrl = /^https?:\/\//i.test(qrData) || /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/i.test(qrData);
        if (isUrl) {
          const fullUrl = qrData.startsWith('http') ? qrData : `https://${qrData}`;
          showToast({
            id: String(Date.now()),
            type: 'AUDIT',
            title: 'Đang phân tích liên kết QR',
            detail: `Gửi đến Cloud Sandbox: ${fullUrl}`,
          });
          const analysis = await analyzeUrlWithSandbox(fullUrl, 'QR_CODE');
          if (modalUpdater) modalUpdater(analysis);
        } else {
          showToast({
            id: String(Date.now()),
            type: 'TOKENIZED',
            title: 'Nội dung mã QR (Văn bản)',
            detail: qrData.length > 80 ? qrData.substring(0, 80) + '...' : qrData,
          });
        }
      });
    }

    // Handle messages sent from Context Menu or Background
    chrome.runtime.onMessage.addListener(async (message) => {
      if (message?.type === 'PHISHGUARD_SCAN_URL' && message.url) {
        showToast({
          id: String(Date.now()),
          type: 'AUDIT',
          title: 'ZeroLeak Lens: Threat Scanner',
          detail: `Đang kiểm tra mức độ an toàn: ${message.url}`,
        });
        const analysis = await analyzeUrlWithSandbox(message.url, 'CONTEXT_MENU');
        if (modalUpdater) modalUpdater(analysis);
      }

      if (message?.type === 'TRIGGER_QR_SCAN') {
        handleTriggerQrScan();
      }
    });

    // -------------------------------------------------------------------------
    // 5. CAPTURE-PHASE EVENT INTERCEPTION
    // -------------------------------------------------------------------------

    const handlePaste = async (e: ClipboardEvent) => {
      if (!activePolicy) return;
      if (!isDomainProtected(window.location.hostname, activePolicy)) return;

      const rawText = e.clipboardData?.getData('text/plain');
      if (!rawText || rawText.trim().length === 0) return;

      // Synchronously halt default paste to enforce Strict Guardrail: Zero Raw PII Exfiltration
      e.preventDefault();
      e.stopImmediatePropagation();

      // Scan text using Multi-layer DLP Client (Worker or Main-thread)
      const result = await dlpClient.scan(rawText, activePolicy.enabledTypes);

      if (result.matches.length === 0) {
        replaceSelectionInEditableElement(rawText);
        updateMetrics(result.scanLatencyMs, 0);
        return;
      }

      console.log(
        `[ZeroLeak] Intercepted ${result.matches.length} sensitive items in ${result.scanLatencyMs}ms (Mode: ${activePolicy.mode})`
      );

      const detectedTypes = Array.from(new Set(result.matches.map((m) => m.type)));
      updateMetrics(result.scanLatencyMs, result.matches.length);

      if (activePolicy.mode === 'STRICT_BLOCK') {
        showToast({
          id: String(Date.now()),
          type: 'BLOCKED',
          title: 'Đã chặn dán dữ liệu',
          detail: `Chính sách STRICT_BLOCK đã chặn ${result.matches.length} mục dữ liệu (${detectedTypes.join(', ')})`,
          latencyMs: result.scanLatencyMs,
          matchCount: result.matches.length,
        });

        emitTelemetry('STRICT_BLOCK', detectedTypes, result.matches.length, result.scanLatencyMs);
        return;
      }

      if (activePolicy.mode === 'AUTO_TOKENIZE') {
        tokenVault.storeMatches(result.matches);
        if (document.body) {
          streamRestorer.sweep(document.body);
        }

        const replaced = replaceSelectionInEditableElement(result.sanitizedText);

        showToast({
          id: String(Date.now()),
          type: 'TOKENIZED',
          title: 'ZeroLeak: Đã mã hóa PII',
          detail: `Đã thay thế ${result.matches.length} thông tin nhạy cảm thành mã giả an toàn.`,
          latencyMs: result.scanLatencyMs,
          matchCount: result.matches.length,
        });

        emitTelemetry('AUTO_TOKENIZE', detectedTypes, result.matches.length, result.scanLatencyMs);

        if (!replaced) {
          console.warn('[ZeroLeak] Could not automatically insert into element; fallback to clipboard rewrite');
        }
        return;
      }

      if (activePolicy.mode === 'AUDIT_ONLY') {
        replaceSelectionInEditableElement(rawText);
        showToast({
          id: String(Date.now()),
          type: 'AUDIT',
          title: 'Cảnh báo vi phạm (Audit Mode)',
          detail: `Phát hiện ${result.matches.length} thông tin nhạy cảm được dán vào trang web.`,
          latencyMs: result.scanLatencyMs,
          matchCount: result.matches.length,
        });
        emitTelemetry('AUDIT_ONLY', detectedTypes, result.matches.length, result.scanLatencyMs);
      }
    };

    const handleDrop = async (e: DragEvent) => {
      if (!activePolicy) return;
      if (!isDomainProtected(window.location.hostname, activePolicy)) return;

      const rawText = e.dataTransfer?.getData('text/plain');
      if (!rawText || rawText.trim().length === 0) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      const result = await dlpClient.scan(rawText, activePolicy.enabledTypes);
      if (result.matches.length === 0) {
        replaceSelectionInEditableElement(rawText);
        updateMetrics(result.scanLatencyMs, 0);
        return;
      }

      const detectedTypes = Array.from(new Set(result.matches.map((m) => m.type)));
      updateMetrics(result.scanLatencyMs, result.matches.length);

      if (activePolicy.mode === 'STRICT_BLOCK') {
        showToast({
          id: String(Date.now()),
          type: 'BLOCKED',
          title: 'Đã chặn thả văn bản',
          detail: `Chính sách bảo mật đã chặn kéo thả ${result.matches.length} dữ liệu nhạy cảm.`,
          latencyMs: result.scanLatencyMs,
        });
        emitTelemetry('STRICT_BLOCK', detectedTypes, result.matches.length, result.scanLatencyMs);
        return;
      }

      if (activePolicy.mode === 'AUTO_TOKENIZE') {
        tokenVault.storeMatches(result.matches);
        if (document.body) {
          streamRestorer.sweep(document.body);
        }
        replaceSelectionInEditableElement(result.sanitizedText);
        showToast({
          id: String(Date.now()),
          type: 'TOKENIZED',
          title: 'ZeroLeak: Đã mã hóa PII kéo thả',
          detail: `Đã thay thế an toàn ${result.matches.length} mục dữ liệu.`,
          latencyMs: result.scanLatencyMs,
        });
        emitTelemetry('AUTO_TOKENIZE', detectedTypes, result.matches.length, result.scanLatencyMs);
      }
    };

    const handleKeyDown = async (e: KeyboardEvent) => {
      if (!activePolicy || activePolicy.mode !== 'STRICT_BLOCK') return;
      if (e.key !== 'Enter' || e.shiftKey) return;

      const activeEl = document.activeElement;
      if (!isEditableElement(activeEl)) return;

      let currentText = '';
      if (activeEl instanceof HTMLTextAreaElement || activeEl instanceof HTMLInputElement) {
        currentText = activeEl.value;
      } else if (activeEl instanceof HTMLElement && activeEl.isContentEditable) {
        currentText = activeEl.innerText || activeEl.textContent || '';
      }

      if (!currentText.trim()) return;

      const result = await dlpClient.scan(currentText, activePolicy.enabledTypes);
      if (result.matches.length > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();

        showToast({
          id: String(Date.now()),
          type: 'BLOCKED',
          title: 'Khóa phím gửi (STRICT_BLOCK)',
          detail: 'Khung nhập liệu chứa dữ liệu nhạy cảm chưa được mã hóa. Không thể gửi!',
          latencyMs: result.scanLatencyMs,
        });
      }
    };

    // Register all listeners on the window object at CAPTURE PHASE (useCapture = true)
    window.addEventListener('paste', handlePaste, true);
    window.addEventListener('drop', handleDrop, true);
    window.addEventListener('keydown', handleKeyDown, true);

    ctx.onInvalidated(() => {
      streamRestorer.stop();
      window.removeEventListener('paste', handlePaste, true);
      window.removeEventListener('drop', handleDrop, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    });
  },
});
