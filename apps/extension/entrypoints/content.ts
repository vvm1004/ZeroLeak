import { defineContentScript } from 'wxt/sandbox';
import React from 'react';
import ReactDOM from 'react-dom/client';
import type { ZeroKnowledgeTelemetryEvent } from '@zeroleak/shared-types';
import { replaceSelectionInEditableElement, isEditableElement } from '../utils/dom-replacer';
import { scanDeterministicDlp } from '../utils/deterministic-dlp';
import { tokenVault } from '../utils/reversible-vault';
import { getStoredPolicy, isDomainProtected } from '../utils/policy-store';
import { NotificationToast, type ToastMessage } from '../components/NotificationToast';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',

  main(ctx) {
    console.log('[ZeroLeak] Content script initialized on', window.location.hostname);

    let activePolicy = null as Awaited<ReturnType<typeof getStoredPolicy>> | null;
    let toastUpdater: ((msg: ToastMessage | null) => void) | null = null;

    // 1. Initialize Policy
    getStoredPolicy().then((policy) => {
      activePolicy = policy;
    });

    // Listen for policy updates broadcast from background service worker
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'POLICY_UPDATED') {
        activePolicy = message.policy;
        console.log('[ZeroLeak] Live policy updated:', activePolicy?.mode);
      }
    });

    // 2. Mount Shadow DOM UI for isolated toasts
    function mountShadowToast() {
      const host = document.createElement('zeroleak-toast-host');
      host.style.position = 'fixed';
      host.style.zIndex = '2147483647';
      host.style.pointerEvents = 'none';
      host.style.top = '0';
      host.style.left = '0';
      host.style.width = '100vw';
      host.style.height = '100vh';

      const shadow = host.attachShadow({ mode: 'open' });
      const mountPoint = document.createElement('div');
      shadow.appendChild(mountPoint);

      const ToastWrapper = () => {
        const [toast, setToast] = React.useState<ToastMessage | null>(null);
        toastUpdater = setToast;
        return React.createElement(NotificationToast, {
          message: toast,
          onDismiss: () => setToast(null),
        });
      };

      const root = ReactDOM.createRoot(mountPoint);
      root.render(React.createElement(ToastWrapper));

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

    mountShadowToast();

    function showToast(msg: ToastMessage) {
      if (toastUpdater) {
        toastUpdater(msg);
      }
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
    // 3. CAPTURE-PHASE EVENT INTERCEPTION
    // -------------------------------------------------------------------------

    /**
     * Intercepts paste events at Capture Phase before SPA / ProseMirror handles them
     */
    const handlePaste = (e: ClipboardEvent) => {
      if (!activePolicy) return;
      if (!isDomainProtected(window.location.hostname, activePolicy)) return;

      const rawText = e.clipboardData?.getData('text/plain');
      if (!rawText || rawText.trim().length === 0) return;

      // Scan text with deterministic DLP engine
      const result = scanDeterministicDlp(rawText, activePolicy.enabledTypes);

      if (result.matches.length === 0) {
        // No sensitive data detected; let natural paste proceed
        return;
      }

      console.log(
        `[ZeroLeak] Intercepted ${result.matches.length} sensitive items in ${result.scanLatencyMs}ms (Mode: ${activePolicy.mode})`
      );

      // Stop native paste completely
      e.preventDefault();
      e.stopImmediatePropagation();

      const detectedTypes = Array.from(new Set(result.matches.map((m) => m.type)));

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
        // Store mappings locally in the reversible vault
        tokenVault.storeMatches(result.matches);

        // Replace content in editable target
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
        // Allow text to paste normally but log telemetry
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

    /**
     * Intercepts drop events at Capture Phase (drag-and-drop text)
     */
    const handleDrop = (e: DragEvent) => {
      if (!activePolicy) return;
      if (!isDomainProtected(window.location.hostname, activePolicy)) return;

      const rawText = e.dataTransfer?.getData('text/plain');
      if (!rawText || rawText.trim().length === 0) return;

      const result = scanDeterministicDlp(rawText, activePolicy.enabledTypes);
      if (result.matches.length === 0) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      const detectedTypes = Array.from(new Set(result.matches.map((m) => m.type)));

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

    /**
     * Intercepts Enter keydown to block accidental submission when in STRICT_BLOCK mode
     */
    const handleKeyDown = (e: KeyboardEvent) => {
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

      const result = scanDeterministicDlp(currentText, activePolicy.enabledTypes);
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
      window.removeEventListener('paste', handlePaste, true);
      window.removeEventListener('drop', handleDrop, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    });
  },
});
