/**
 * Stream Response Restorer (ZeroLeak Reversible Restoration)
 *
 * Uses MutationObserver to monitor AI streaming responses (ChatGPT, Claude, Gemini, etc.)
 * Detects token placeholders like [ZL_CCCD_01], [ZL_KEY_01], [ZL_PER_01]
 * and reversibly replaces them on the fly with real values wrapped in an isolated,
 * beautiful emerald green badge.
 *
 * Strict Guardrail 1: 100% On-Device, real values never leave the browser.
 * Strict Guardrail 2: Absolutely NEVER restores text inside editable inputs/textareas
 * to prevent accidental re-leaks on subsequent prompt submissions.
 */

import {
  type SensitiveDataType,
  type TokenVaultEntry,
  TOKEN_PREFIX_TO_TYPE,
} from '@zeroleak/shared-types';
import { tokenVault } from './reversible-vault';

export { TOKEN_PREFIX_TO_TYPE };

export const TOKEN_PATTERN = /\[([A-Z0-9_]{3,25}_\d{2})\]/g;

export const FRIENDLY_TYPE_NAMES: Record<SensitiveDataType, string> = {
  VN_CCCD: 'CCCD Việt Nam',
  CREDIT_CARD: 'Thẻ ngân hàng',
  API_SECRET: 'Khóa bí mật API',
  EMAIL: 'Địa chỉ Email',
  PHONE_VN: 'Số điện thoại VN',
  PERSON_NAME: 'Họ và tên',
  ORGANIZATION: 'Tổ chức / Doanh nghiệp',
};

const EXCLUDED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'INPUT',
  'SVG',
  'HEAD',
  'META',
  'TITLE',
]);

/**
 * Checks whether a node is inside an editable input or rich-text editor
 */
export function isInsideEditableContainer(node: Node | null): boolean {
  if (!node) return false;

  let current: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;

  while (current && current !== document.body && current !== document.documentElement) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as HTMLElement;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
      const ce = el.getAttribute('contenteditable');
      if (el.isContentEditable || (ce !== null && ce !== 'false')) return true;
      if (el.getAttribute('role') === 'textbox') return true;
      if (el.getAttribute('data-zeroleak-input') === 'true') return true;
      if (
        el.classList.contains('ProseMirror') ||
        el.classList.contains('monaco-editor') ||
        el.classList.contains('cm-editor') ||
        el.hasAttribute('data-slate-editor')
      ) {
        return true;
      }
    }
    current = current.parentElement;
  }
  return false;
}

/**
 * Checks whether a node is already inside a ZeroLeak restored badge to prevent loop
 */
export function isInsideRestoredBadge(node: Node | null): boolean {
  if (!node) return false;
  let current: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;

  while (current && current !== document.body && current !== document.documentElement) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as HTMLElement;
      if (
        el.getAttribute('data-zeroleak-restored') === 'true' ||
        el.classList.contains('zeroleak-restored')
      ) {
        return true;
      }
    }
    current = current.parentElement;
  }
  return false;
}

/**
 * Creates a styled green restored badge element
 */
export function createRestoredBadge(token: string, entry?: TokenVaultEntry): HTMLElement {
  const span = document.createElement('span');
  span.className = 'zeroleak-restored';
  span.setAttribute('data-zeroleak-restored', 'true');
  span.setAttribute('data-token', token);

  const originalValue = entry?.originalValue || token;
  let type = entry?.type;
  if (!type) {
    const rawToken = token.replace(/^\[|\]$/g, '');
    const prefix = rawToken.replace(/_\d+$/, '');
    type = TOKEN_PREFIX_TO_TYPE[prefix] || 'PERSON_NAME';
  }
  span.setAttribute('data-type', type);

  const friendlyType = FRIENDLY_TYPE_NAMES[type] || type;
  span.title = `🛡️ Đã khôi phục cục bộ bởi ZeroLeak (${friendlyType})\nMã gốc: ${token} ➔ Dữ liệu thật chỉ hiển thị trên máy bạn`;

  // Mini lock icon SVG + sanitized text display
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'zeroleak-restored-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', '3');
  rect.setAttribute('y', '11');
  rect.setAttribute('width', '18');
  rect.setAttribute('height', '11');
  rect.setAttribute('rx', '2');
  rect.setAttribute('ry', '2');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M7 11V7a5 5 0 0 1 10 0v4');

  svg.appendChild(rect);
  svg.appendChild(path);

  const textSpan = document.createElement('span');
  textSpan.className = 'zeroleak-restored-text';
  textSpan.textContent = originalValue;

  span.appendChild(svg);
  span.appendChild(textSpan);

  return span;
}

/**
 * Injects persistent stylesheet for .zeroleak-restored into the active page
 */
export function ensureStylesInjected(doc: Document = document): void {
  const styleId = 'zeroleak-restored-styles';
  if (doc.getElementById(styleId)) return;

  const style = doc.createElement('style');
  style.id = styleId;
  style.textContent = `
    .zeroleak-restored {
      display: inline-flex !important;
      align-items: center !important;
      gap: 3.5px !important;
      background-color: rgba(16, 185, 129, 0.12) !important;
      border: 1px solid rgba(16, 185, 129, 0.45) !important;
      border-radius: 4px !important;
      padding: 0.5px 5px !important;
      margin: 0 1.5px !important;
      font-family: inherit !important;
      font-size: 0.95em !important;
      font-weight: 500 !important;
      color: #047857 !important;
      cursor: help !important;
      vertical-align: baseline !important;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
      box-decoration-break: clone !important;
      -webkit-box-decoration-break: clone !important;
      line-height: 1.35 !important;
    }

    .zeroleak-restored:hover {
      background-color: rgba(16, 185, 129, 0.24) !important;
      border-color: #10b981 !important;
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.4) !important;
      transform: translateY(-0.5px) !important;
    }

    .zeroleak-restored-icon {
      display: inline-block !important;
      width: 12px !important;
      height: 12px !important;
      flex-shrink: 0 !important;
      color: #059669 !important;
    }

    .zeroleak-restored-text {
      color: inherit !important;
      font-weight: 600 !important;
    }

    @media (prefers-color-scheme: dark) {
      .zeroleak-restored {
        background-color: rgba(16, 185, 129, 0.2) !important;
        border-color: rgba(52, 211, 153, 0.5) !important;
        color: #34d399 !important;
      }
      .zeroleak-restored-icon {
        color: #34d399 !important;
      }
      .zeroleak-restored:hover {
        background-color: rgba(16, 185, 129, 0.32) !important;
        box-shadow: 0 0 10px rgba(52, 211, 153, 0.5) !important;
      }
    }
  `;

  if (doc.head) {
    doc.head.appendChild(style);
  } else if (doc.documentElement) {
    doc.documentElement.appendChild(style);
  }
}

/**
 * Replaces token placeholders within a single TextNode
 * Returns true if replacement was performed.
 */
export function replaceTokensInTextNode(textNode: Text): boolean {
  const content = textNode.nodeValue;
  if (!content || !content.includes('[') || !content.includes(']')) {
    return false;
  }

  // Check parent constraints
  const parent = textNode.parentNode;
  if (!parent) return false;
  if (parent.nodeType === Node.ELEMENT_NODE) {
    const parentTag = (parent as Element).tagName;
    if (EXCLUDED_TAGS.has(parentTag)) return false;
  }
  if (isInsideEditableContainer(textNode)) return false;
  if (isInsideRestoredBadge(textNode)) return false;

  // Find all tokens in text
  TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  const matches: Array<{ token: string; index: number }> = [];

  while ((match = TOKEN_PATTERN.exec(content)) !== null) {
    const token = match[0];
    if (tokenVault.has(token)) {
      matches.push({ token, index: match.index });
    }
  }

  if (matches.length === 0) return false;

  const doc = textNode.ownerDocument || document;
  const fragment = doc.createDocumentFragment();
  let lastIndex = 0;

  for (const m of matches) {
    // 1. Text before token
    if (m.index > lastIndex) {
      fragment.appendChild(doc.createTextNode(content.substring(lastIndex, m.index)));
    }

    // 2. Restored Badge
    const entry = tokenVault.getEntry(m.token);
    const badge = createRestoredBadge(m.token, entry);
    fragment.appendChild(badge);

    lastIndex = m.index + m.token.length;
  }

  // 3. Remainder text after last token
  if (lastIndex < content.length) {
    fragment.appendChild(doc.createTextNode(content.substring(lastIndex)));
  }

  parent.replaceChild(fragment, textNode);
  return true;
}

/**
 * StreamResponseRestorer class orchestrates MutationObserver monitoring
 */
export class StreamResponseRestorer {
  private observer: MutationObserver | null = null;
  private isObserving = false;

  /**
   * Starts observing the DOM for token occurrences
   */
  public start(root?: Node): void {
    if (this.isObserving) return;

    const targetRoot = root || (typeof document !== 'undefined' ? document.body || document.documentElement : null);
    if (!targetRoot) return;

    ensureStylesInjected(targetRoot.ownerDocument || document);

    // Initial sweep for existing rendered nodes
    this.sweep(targetRoot);

    this.observer = new MutationObserver((mutations) => {
      this.handleMutations(mutations);
    });

    this.observer.observe(targetRoot, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    this.isObserving = true;
    console.log('[ZeroLeak] StreamResponseRestorer active');
  }

  /**
   * Stops observing
   */
  public stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.isObserving = false;
  }

  /**
   * Sweeps an entire subtree for tokens
   */
  public sweep(rootNode: Node): void {
    if (isInsideEditableContainer(rootNode) || isInsideRestoredBadge(rootNode)) {
      return;
    }

    const doc = rootNode.ownerDocument || document;
    const walker = doc.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const val = node.nodeValue;
        if (!val || !val.includes('[') || !val.includes(']')) {
          return NodeFilter.FILTER_REJECT;
        }
        if (isInsideEditableContainer(node) || isInsideRestoredBadge(node)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const candidates: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      candidates.push(current as Text);
      current = walker.nextNode();
    }

    for (const textNode of candidates) {
      replaceTokensInTextNode(textNode);
    }
  }

  private handleMutations(mutations: MutationRecord[]): void {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        const target = mutation.target;
        if (target && target.nodeType === Node.TEXT_NODE) {
          replaceTokensInTextNode(target as Text);
        }
      } else if (mutation.type === 'childList') {
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const added = mutation.addedNodes[i];
          if (added.nodeType === Node.TEXT_NODE) {
            replaceTokensInTextNode(added as Text);
          } else if (added.nodeType === Node.ELEMENT_NODE) {
            this.sweep(added);
          }
        }
      }
    }
  }
}

export const streamRestorer = new StreamResponseRestorer();
