import { serve } from '@hono/node-server';
import { createApp } from '../src/app';
import { analyzeVoiceWithAcoustic } from '../src/voice-acoustic';
import { analyzeAudioScam } from '../src/voice-analyzer';

if (process.env.VOICE_E2E !== '1') throw new Error('Test server requires VOICE_E2E=1. Never use as a production analyzer.');
process.env.NODE_ENV = 'test'; delete process.env.VOICE_API_TOKEN; delete process.env.VOICE_ACOUSTIC_URL;
// Never open Google WebSockets from fixture tests, even if the shell has a real API key.
for (const key of ['GEMINI_MODEL_VOICE', 'GEMINI_MODEL_VOICE_LIVE_FALLBACK', 'GEMINI_MODEL_VOICE_FALLBACK', 'GEMINI_MODEL_VOICE_REVIEW']) process.env[key] = 'gemini-test-fixture';
let requests = 0;
const app = createApp({ analyzeVoice: async (input, signal) => {
  requests++;
  return analyzeVoiceWithAcoustic(input, signal, { content: (audio, childSignal) => analyzeAudioScam(audio, { signal: childSignal, generate: async () => ({ text: JSON.stringify({
    riskScore: 85, verdict: 'SUSPICIOUS', syntheticVoiceProbability: null,
    detectedTactics: ['OTP_OR_CREDENTIAL_ASK', 'URGENCY_PRESSURE'],
    tacticEvidence: ['OTP_OR_CREDENTIAL_ASK', 'URGENCY_PRESSURE'].map(tactic => ({ tactic, quote: 'Đọc mã OTP 123456 ngay' })),
    transcriptSnippet: 'Đọc mã OTP 123456 ngay để xác minh.',
    warningMessageVi: 'Không chia sẻ OTP. Hãy gọi lại qua số chính thức để xác minh.', audioQuality: 'CLEAR',
  }) }) }) });
} });
app.get('/test-stats', c => c.json({ requests }));
app.get('/voice-source', c => c.html(`<!doctype html><html lang="vi"><title>ZeroLeak Voice Test Source</title><body><button>Phát âm thanh thử</button><script>
document.querySelector('button').onclick = async () => {
  const context = new AudioContext(); const tone = context.createOscillator();
  const gain = context.createGain(); gain.gain.value = .25; tone.frequency.value = 220;
  tone.connect(gain).connect(context.destination); await context.resume(); tone.start();
};
</script></body></html>`));
serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 18080 });
console.log('VOICE E2E FIXTURE SERVER — Gemini responses are mocked.');
