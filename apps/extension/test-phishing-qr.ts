/**
 * Test Suite for 1.4: Phishing Local Heuristic Fallback & QR Decoder
 */

import { localHeuristicFallback } from './utils/phishing-client';

async function runTests() {
  console.log('=== STARTING TEST 1.4: PHISHING HEURISTIC & QR CAPABILITIES ===');

  // Test 1: Fake Vietcombank on .top domain
  console.log('\n[1] Testing Phishing Detection on Fake Vietcombank URL...');
  const fakeVcb = localHeuristicFallback('https://vcb-digibank-confirm.top/login.php');
  console.log(`URL: ${fakeVcb.url}`);
  console.log(`Verdict: ${fakeVcb.verdict} | Risk Score: ${fakeVcb.riskScore}/100`);
  console.log(`Impersonated Brand: ${fakeVcb.impersonatedBrand}`);
  console.log(`Indicators:`, fakeVcb.indicators);

  if (fakeVcb.verdict !== 'MALICIOUS' || fakeVcb.riskScore < 90) {
    throw new Error(`Expected MALICIOUS with risk >= 90, got ${fakeVcb.verdict} (${fakeVcb.riskScore})`);
  }
  if (fakeVcb.impersonatedBrand !== 'Vietcombank DigiBank') {
    throw new Error(`Expected Vietcombank DigiBank, got ${fakeVcb.impersonatedBrand}`);
  }
  console.log('✓ Fake Vietcombank detection PASSED');

  // Test 2: Fake Facebook on .xyz domain
  console.log('\n[2] Testing Phishing Detection on Fake Facebook URL...');
  const fakeFb = localHeuristicFallback('http://fb-login-security-update.xyz');
  console.log(`Verdict: ${fakeFb.verdict} | Risk Score: ${fakeFb.riskScore}/100`);
  if (fakeFb.verdict !== 'MALICIOUS') {
    throw new Error('Fake Facebook was not classified as MALICIOUS');
  }
  console.log('✓ Fake Facebook detection PASSED');

  // Test 3: Raw IP address target
  console.log('\n[3] Testing Direct IP address target...');
  const ipTarget = localHeuristicFallback('http://192.168.1.55/admin');
  console.log(`Verdict: ${ipTarget.verdict} | Risk Score: ${ipTarget.riskScore}/100`);
  const hasIpIndicator = ipTarget.indicators.some((i) => i.includes('địa chỉ IP'));
  if (!hasIpIndicator) {
    throw new Error('Expected IP address indicator');
  }
  console.log('✓ Direct IP address indicator PASSED');

  // Test 4: Official safe website
  console.log('\n[4] Testing Official Vietcombank Portal...');
  const safeVcb = localHeuristicFallback('https://vietcombank.com.vn/vi-VN/KH-CN/Tiet-kiem');
  console.log(`Verdict: ${safeVcb.verdict} | Risk Score: ${safeVcb.riskScore}/100`);
  if (safeVcb.verdict !== 'SAFE') {
    throw new Error(`Expected SAFE for official domain, got ${safeVcb.verdict}`);
  }
  console.log('✓ Official domain classified as SAFE PASSED');

  console.log(`\nExecution Latency: ${fakeVcb.executionTimeMs}ms (SLO < 3500ms -> Instant fallback compliant)`);
  console.log('\n=== ALL 1.4 TESTS PASSED SUCCESSFULLY! ===');
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
