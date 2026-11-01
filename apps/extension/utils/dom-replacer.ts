/**
 * DOM Replacer Utility for ZeroLeak
 * Handles text insertion across traditional inputs, textareas, and rich-text/ProseMirror editors.
 * Preserves Undo Stack, React Virtual DOM, and ProseMirror state.
 */

export function replaceSelectionInEditableElement(sanitizedText: string): boolean {
  const activeEl = document.activeElement as HTMLElement | null;
  if (!activeEl) return false;

  // Case 1: Standard HTMLInputElement or HTMLTextAreaElement
  if (activeEl instanceof HTMLTextAreaElement || activeEl instanceof HTMLInputElement) {
    const start = activeEl.selectionStart ?? activeEl.value.length;
    const end = activeEl.selectionEnd ?? activeEl.value.length;
    const before = activeEl.value.slice(0, start);
    const after = activeEl.value.slice(end);

    activeEl.value = before + sanitizedText + after;
    const newCursorPos = start + sanitizedText.length;
    activeEl.setSelectionRange(newCursorPos, newCursorPos);

    // Dispatch input & change events for React/Vue reactive state synchronization
    activeEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    activeEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    return true;
  }

  // Case 2: ContentEditable elements (ChatGPT, Claude, Gemini, Gmail, ProseMirror, Lexical)
  if (activeEl.isContentEditable || document.designMode === 'on') {
    // execCommand('insertText') is the gold standard for preserving Undo stack & ProseMirror state
    const success = document.execCommand('insertText', false, sanitizedText);
    if (success) {
      return true;
    }

    // Fallback: Use standard DOM Selection & Range API
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const textNode = document.createTextNode(sanitizedText);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      selection.removeAllRanges();
      selection.addRange(range);

      activeEl.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: sanitizedText,
        })
      );
      return true;
    }
  }

  return false;
}

/**
 * Checks if an element is a text input field or contenteditable editor
 */
export function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const type = el.type.toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image'].includes(type);
  }
  if ((el as HTMLElement).isContentEditable) return true;
  if (el.getAttribute('role') === 'textbox') return true;
  return false;
}
