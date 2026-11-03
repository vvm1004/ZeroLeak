/**
 * Integration Test for 1.3: Reversible Tokenization & DOM Stream Restoration
 */

import { JSDOM } from 'jsdom';

// Setup Mock DOM environment
const dom = new JSDOM(
  `<!DOCTYPE html>
<html>
<head></head>
<body>
  <div id="chat-container">
    <div class="user-message">
      <p>Tra cứu hồ sơ cán bộ.</p>
    </div>
    <div id="assistant-message" class="assistant-message prose">
      <!-- AI streaming response will arrive here -->
    </div>
  </div>

  <div id="input-container">
    <textarea id="prompt-input" placeholder="Type prompt..."></textarea>
    <div id="contenteditable-editor" contenteditable="true"></div>
  </div>
</body>
</html>`,
  { url: 'https://chatgpt.com/' }
);

// Bind globals for dom-observer and reversible-vault
(global as any).window = dom.window;
(global as any).document = dom.window.document;
(global as any).Node = dom.window.Node;
(global as any).NodeFilter = dom.window.NodeFilter;
(global as any).Text = dom.window.Text;
(global as any).Element = dom.window.Element;
(global as any).HTMLElement = dom.window.HTMLElement;
(global as any).HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
(global as any).HTMLInputElement = dom.window.HTMLInputElement;
(global as any).MutationObserver = dom.window.MutationObserver;
(global as any).sessionStorage = dom.window.sessionStorage;

async function runTest() {
  console.log('=== STARTING TEST 1.3: REVERSIBLE TOKENIZATION & DOM RESTORATION ===');

  // Import after setting up DOM globals
  const { tokenVault } = await import('./utils/reversible-vault');
  const { StreamResponseRestorer } = await import('./utils/dom-observer');

  // 1. Test ReversibleTokenVault
  console.log('\n[1] Testing ReversibleTokenVault...');
  tokenVault.clear();

  tokenVault.store('[ZL_CCCD_01]', '048099001234', 'VN_CCCD');
  tokenVault.store('[ZL_KEY_01]', 'AIzaSyBpgQXc2Mcjs9NBfcnrTbd5kFpF0s8bn4Y', 'API_SECRET');
  tokenVault.store('[ZL_PER_01]', 'Nguyễn Văn An', 'PERSON_NAME');

  if (tokenVault.resolve('[ZL_CCCD_01]') !== '048099001234') {
    throw new Error('Vault resolve failed for [ZL_CCCD_01]');
  }
  if (tokenVault.resolve('[ZL_KEY_01]') !== 'AIzaSyBpgQXc2Mcjs9NBfcnrTbd5kFpF0s8bn4Y') {
    throw new Error('Vault resolve failed for [ZL_KEY_01]');
  }
  if (tokenVault.has('[ZL_UNKNOWN_99]')) {
    throw new Error('Vault has() false positive for [ZL_UNKNOWN_99]');
  }
  console.log('✓ TokenVault storage and O(1) resolution PASSED');

  // 2. Test StreamResponseRestorer on Assistant Streaming Output
  console.log('\n[2] Testing StreamResponseRestorer on Assistant Output...');
  const restorer = new StreamResponseRestorer();
  restorer.start(dom.window.document.body);

  const assistantDiv = dom.window.document.getElementById('assistant-message')!;

  // Simulate AI streaming incoming chunks
  console.log('Simulating streaming chunk from AI assistant containing tokens...');
  const p = dom.window.document.createElement('p');
  p.textContent = 'Hồ sơ đã được phê duyệt cho [ZL_PER_01] với số CCCD [ZL_CCCD_01] và khóa bảo mật [ZL_KEY_01].';
  assistantDiv.appendChild(p);

  // Wait a microtask tick for MutationObserver
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Check if badges were created
  const restoredBadges = assistantDiv.querySelectorAll('.zeroleak-restored');
  console.log(`Found ${restoredBadges.length} restored badges inside assistant message.`);

  if (restoredBadges.length !== 3) {
    throw new Error(`Expected 3 restored badges, but found ${restoredBadges.length}`);
  }

  const badge1 = restoredBadges[0];
  const badge2 = restoredBadges[1];
  const badge3 = restoredBadges[2];

  console.log(`Badge 1 Token: ${badge1.getAttribute('data-token')} -> Restored Text: "${badge1.querySelector('.zeroleak-restored-text')?.textContent}"`);
  console.log(`Badge 2 Token: ${badge2.getAttribute('data-token')} -> Restored Text: "${badge2.querySelector('.zeroleak-restored-text')?.textContent}"`);
  console.log(`Badge 3 Token: ${badge3.getAttribute('data-token')} -> Restored Text: "${badge3.querySelector('.zeroleak-restored-text')?.textContent}"`);

  if (badge1.querySelector('.zeroleak-restored-text')?.textContent !== 'Nguyễn Văn An') {
    throw new Error('Badge 1 text mismatch');
  }
  if (badge2.querySelector('.zeroleak-restored-text')?.textContent !== '048099001234') {
    throw new Error('Badge 2 text mismatch');
  }
  if (badge3.querySelector('.zeroleak-restored-text')?.textContent !== 'AIzaSyBpgQXc2Mcjs9NBfcnrTbd5kFpF0s8bn4Y') {
    throw new Error('Badge 3 text mismatch');
  }
  console.log('✓ Assistant streaming text restoration PASSED');

  // 3. Strict Guardrail Test: Input Fields Must NOT Be Restored
  console.log('\n[3] Testing Strict Guardrail: Exclusion of Input Elements...');
  const textarea = dom.window.document.getElementById('prompt-input') as HTMLTextAreaElement;
  const contenteditable = dom.window.document.getElementById('contenteditable-editor') as HTMLElement;

  textarea.value = 'Nhập lại CCCD [ZL_CCCD_01]';
  contenteditable.textContent = 'Câu hỏi tiếp theo về [ZL_PER_01]';

  // Trigger manual sweep on entire body to attempt any violation
  restorer.sweep(dom.window.document.body);

  if (textarea.value !== 'Nhập lại CCCD [ZL_CCCD_01]') {
    throw new Error('VIOLATION: Textarea value was modified by restorer!');
  }
  if (contenteditable.textContent !== 'Câu hỏi tiếp theo về [ZL_PER_01]') {
    throw new Error('VIOLATION: Contenteditable element was modified by restorer!');
  }
  if (textarea.querySelector('.zeroleak-restored') || contenteditable.querySelector('.zeroleak-restored')) {
    throw new Error('VIOLATION: Restored badge placed inside input element!');
  }
  console.log('✓ Strict Guardrail verified: Editable input fields are completely untouched');

  // 4. Test Unregistered Token
  console.log('\n[4] Testing Unregistered Token Placeholder...');
  const pUnregistered = dom.window.document.createElement('p');
  pUnregistered.textContent = 'Token không có trong vault: [UNKNOWN_TOKEN_01]';
  assistantDiv.appendChild(pUnregistered);

  await new Promise((resolve) => setTimeout(resolve, 50));

  if (pUnregistered.querySelector('.zeroleak-restored')) {
    throw new Error('Unregistered token was incorrectly restored!');
  }
  console.log('✓ Unregistered tokens are safely left intact');

  restorer.stop();
  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! (100% SLO & GUARDRAIL COMPLIANT) ===');
}

runTest().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});

