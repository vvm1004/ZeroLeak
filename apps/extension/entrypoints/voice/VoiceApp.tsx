import React, { useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, FileAudio, Mic, Shield, Square } from 'lucide-react';
import type { VoiceScamAnalysisResult } from '@zeroleak/shared-types';
import { VoiceCapture, type VoiceSource } from '../../utils/voice-capture';
import { audioRms, readVoiceFile } from '../../utils/voice-audio';
import { analyzeVoice, DEFAULT_VOICE_SETTINGS, voiceEndpoint, type VoiceSettings } from '../../utils/voice-client';

const tacticNames = {
  CEO_FRAUD: 'Giả danh lãnh đạo', AUTHORITY_IMPERSONATION: 'Giả danh cơ quan / ngân hàng',
  OTP_OR_CREDENTIAL_ASK: 'Yêu cầu OTP / mật khẩu', URGENCY_PRESSURE: 'Thúc ép hành động khẩn cấp',
};
const verdictNames = { SAFE: 'Chưa thấy kịch bản lừa đảo', SUSPICIOUS: 'Có dấu hiệu cần thận trọng', DEEPFAKE_SCAM: 'Nguy cơ lừa đảo qua cuộc gọi', UNKNOWN: 'Chưa đánh giá được nội dung' };
const acousticNames = { SYNTHETIC_SUSPECTED: 'Có dấu hiệu giọng tổng hợp', NO_SYNTHETIC_EVIDENCE: 'Chưa thấy bằng chứng giọng tổng hợp', UNKNOWN: 'Tín hiệu giọng nói chưa đủ chắc chắn' };

function Waveform({ analyser, verdict }: { analyser: AnalyserNode | null; verdict?: VoiceScamAnalysisResult['verdict'] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const surface = canvas.current;
    const context = surface?.getContext('2d');
    if (!surface || !context) return;
    let frame = 0;
    const values = new Uint8Array(analyser?.fftSize ?? 256);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const draw = () => {
      context.clearRect(0, 0, surface.width, surface.height);
      if (analyser && !reduced) analyser.getByteTimeDomainData(values); else values.fill(128);
      context.strokeStyle = verdict === 'DEEPFAKE_SCAM' ? '#fb7185' : verdict === 'SUSPICIOUS' ? '#fbbf24' : verdict === 'UNKNOWN' ? '#94a3b8' : analyser ? '#34d399' : '#64748b'; context.lineWidth = 2; context.beginPath();
      for (let i = 0; i < values.length; i++) {
        const x = i * surface.width / (values.length - 1), y = values[i] / 255 * surface.height;
        if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.stroke();
      if (analyser && !reduced) frame = requestAnimationFrame(draw);
    };
    draw(); return () => cancelAnimationFrame(frame);
  }, [analyser, verdict]);
  return <canvas ref={canvas} width={800} height={120} className="waveform" role="img" aria-label={analyser ? 'Sóng âm đầu vào đang thu' : 'Chưa thu âm'} />;
}

export default function VoiceApp() {
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [ready, setReady] = useState(false);
  const [source, setSource] = useState<VoiceSource>('tab');
  const [capturing, setCapturing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [reviewFile, setReviewFile] = useState(false);
  const [notice, setNotice] = useState('Sẵn sàng kiểm tra đoạn âm thanh đầu tiên.');
  const [error, setError] = useState('');
  const [result, setResult] = useState<VoiceScamAnalysisResult | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const capture = useRef<VoiceCapture | null>(null);
  const request = useRef<AbortController | null>(null);
  const run = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    capture.current = new VoiceCapture();
    void (async () => {
      try {
        const saved = await chrome.storage.local.get('zeroleak_voice_settings');
        if (!mounted.current) return;
        const value = saved.zeroleak_voice_settings;
        if (value && typeof value.apiBase === 'string') setSettings({ apiBase: value.apiBase, token: '' });
      } finally { if (mounted.current) setReady(true); }
    })().catch(() => {});
    const stopBeforeClose = () => { run.current++; request.current?.abort(); capture.current?.stop(); };
    window.addEventListener('pagehide', stopBeforeClose);
    return () => {
      mounted.current = false; window.removeEventListener('pagehide', stopBeforeClose); stopBeforeClose();
    };
  }, []);

  const stop = () => {
    run.current++; request.current?.abort(); request.current = null; capture.current?.stop();
    setCapturing(false); setStarting(false); setBusy(false); setNotice('Đã dừng thu âm. Không gửi thêm âm thanh.');
  };

  const submit = async (samples: Float32Array, currentRun: number, mode: 'realtime' | 'review' = 'realtime') => {
    if (run.current !== currentRun || request.current) return;
    if (audioRms(samples) < 0.001) { setNotice('Âm thanh đang nhỏ hoặc im lặng; chưa gửi đoạn này.'); return; }
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setNotice(mode === 'review' ? 'Đang phân tích kỹ file… Có thể chờ đến 15 giây.' : 'Đang phân tích đoạn âm thanh…');
    try {
      const next = await analyzeVoice(samples, settings, controller.signal, mode);
      if (!mounted.current || run.current !== currentRun) return;
      setResult(next); setProcessed(count => count + 1); setNotice('Đã nhận kết quả cho đoạn âm thanh gần nhất.');
    } catch (err) {
      if (mounted.current && run.current === currentRun && !controller.signal.aborted) {
        setResult(null);
        setError(err instanceof Error ? err.message : 'Chưa phân tích được âm thanh.');
        setNotice('Đoạn vừa rồi chưa được đánh giá.');
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (mounted.current && run.current === currentRun) setBusy(false);
    }
  };

  const prepare = () => {
    voiceEndpoint(settings.apiBase);
    // Persist only the service address. The access token stays in this page's memory.
    void chrome.storage.local.set({ zeroleak_voice_settings: { apiBase: settings.apiBase } }).catch(() => {});
    setResult(null); setProcessed(0); setElapsed(0); setError('');
    return ++run.current;
  };

  const start = async () => {
    let currentRun: number;
    try { currentRun = prepare(); } catch (err) { setError((err as Error).message); return; }
    setStarting(true); setNotice('Chọn nguồn âm thanh và cấp quyền để bắt đầu.');
    try {
      await capture.current!.start(source, {
        onWindow: samples => { void submit(samples, currentRun); },
        onProgress: seconds => setElapsed(seconds), onAnalyser: value => { if (mounted.current) setAnalyser(value); },
        onEnded: () => { if (mounted.current && run.current === currentRun) stop(); },
      });
      if (mounted.current && run.current === currentRun) {
        setCapturing(true); setStarting(false); setNotice('Đang thu. Mỗi đoạn 5 giây sẽ được phân tích riêng.');
      }
    } catch (err) {
      if (mounted.current && run.current === currentRun) {
        setStarting(false); setCapturing(false);
        const name = (err as DOMException).name;
        setError(name === 'NotAllowedError' ? 'Chưa được cấp quyền thu âm. Bạn có thể thử lại hoặc chọn file.' : err instanceof Error ? err.message : 'Không khởi động được thu âm.');
        setNotice('Chưa bắt đầu thu âm.');
      }
    }
  };

  const upload = async (file: File) => {
    let currentRun: number;
    try { currentRun = prepare(); } catch (err) { setError((err as Error).message); return; }
    setBusy(true); setNotice('Đang đọc 5 giây đầu của file trên thiết bị…');
    try {
      const samples = await readVoiceFile(file);
      if (run.current === currentRun && mounted.current) await submit(samples, currentRun, reviewFile ? 'review' : 'realtime');
    } catch (err) {
      if (mounted.current && run.current === currentRun) setError(err instanceof Error ? err.message : 'Không đọc được file âm thanh. Hãy thử WAV hoặc MP3.');
    } finally { if (mounted.current && run.current === currentRun) setBusy(false); }
  };

  const active = capturing || starting || busy;
  return <main className="voice-app">
    <header className="page-header">
      <a className="brand" href="popup.html"><Shield size={24} aria-hidden="true" /> ZeroLeak <span>Voice</span></a>
      <span className="session-status"><span className={capturing ? 'status-dot recording' : 'status-dot'} />{capturing ? 'Đang thu âm' : 'Chưa thu âm'}</span>
    </header>
    <div className="intro"><h1>Nghe cuộc gọi. Nhìn rõ dấu hiệu.</h1><p>Kiểm tra lời thoại đáng ngờ và dấu hiệu giọng tổng hợp trong từng đoạn âm thanh ngắn.</p></div>
    <div className="workspace">
      <section className="capture-panel" aria-labelledby="capture-title">
        <h2 id="capture-title">Nguồn âm thanh</h2>
        <fieldset className="source-selector" disabled={active || !ready}>
          <legend className="sr-only">Chọn nguồn thu âm</legend>
          <label><input type="radio" name="source" checked={source === 'tab'} onChange={() => setSource('tab')} /><span>Âm thanh từ tab</span><small>Cuộc gọi hoặc video trong trình duyệt</small></label>
          <label><input type="radio" name="source" checked={source === 'microphone'} onChange={() => setSource('microphone')} /><span>Micro của bạn</span><small>Thu thử một tình huống trực tiếp</small></label>
        </fieldset>
        <p className="help">{source === 'tab' ? 'Trong hộp chia sẻ, chọn Thẻ Chrome và bật “Chia sẻ âm thanh”.' : 'Micro sẽ gửi cả tiếng nói và âm thanh xung quanh mà nó thu được.'}</p>
        <div className="audio-monitor"><Waveform analyser={analyser} verdict={result?.verdict} /><div className="monitor-caption"><span>{capturing ? `${elapsed}s đã thu` : 'Sóng âm đầu vào'}</span><span>{processed} đoạn đã kiểm tra</span></div></div>
        <div className="primary-actions">
          {capturing || starting ? <button className="button stop" onClick={stop}><Square size={16} />Dừng thu âm</button>
            : <button className="button primary" disabled={busy || !ready} onClick={() => void start()}><Mic size={17} />Bắt đầu kiểm tra</button>}
          <button className="button secondary" disabled={active || !ready} onClick={() => fileInput.current?.click()}><FileAudio size={17} />Chọn file thử</button>
          <input ref={fileInput} className="sr-only" aria-label="Chọn file âm thanh để phân tích 5 giây đầu" type="file" accept="audio/*,.wav,.mp3,.webm,.ogg,.m4a" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} />
        </div>
        <label className="help"><input type="checkbox" checked={reviewFile} disabled={active || !ready} onChange={event => setReviewFile(event.target.checked)} /> Phân tích kỹ file (thử nghiệm, tối đa 15 giây)</label>
        <p className="help">Chỉ áp dụng khi chọn file, cho Gemini thêm thời gian; không bảo đảm kết quả chính xác hơn. Thu micro/tab vẫn dùng chế độ nhanh.</p>
        {busy && !capturing && <button className="text-button" onClick={stop}>Hủy phân tích</button>}
        <p className="privacy"><Shield size={15} aria-hidden="true" />Khi bạn bắt đầu, âm thanh được gửi tới dịch vụ phân tích và Gemini. ZeroLeak không lưu bản thu vào nhật ký.</p>
        <details className="connection"><summary>Kết nối dịch vụ</summary><label>Địa chỉ dịch vụ<input type="url" value={settings.apiBase} disabled={active} onChange={event => setSettings({ ...settings, apiBase: event.target.value })} placeholder="http://localhost:8080" /></label><label>Mã truy cập <span>(nếu máy chủ yêu cầu)</span><input type="password" autoComplete="off" value={settings.token} disabled={active} onChange={event => setSettings({ ...settings, token: event.target.value })} /></label></details>
      </section>
      <section className={`result-panel ${result ? result.verdict.toLowerCase() : ''}`} aria-labelledby="result-title">
        <div className="result-heading"><h2 id="result-title">Kết quả gần nhất</h2><Activity size={19} aria-hidden="true" /></div>
        <p className="live-status" role="status" aria-live="polite">{notice}</p>
        {error && <div className="error-message" role="alert"><AlertTriangle size={18} /><span>{error}</span></div>}
        {result ? <>
          <div className="verdict" aria-live="polite"><h3>{verdictNames[result.verdict]}</h3><div className="risk-number">{result.riskScore === null ? '—' : result.riskScore}<span>/100 điểm rủi ro</span></div></div>
          <p className="warning">{result.warningMessageVi}</p>
          {result.analysisTransport && <p className="help">Model phân tích nội dung: <strong>{result.analysisModel}</strong> · {result.analysisTransport === 'LIVE_API' ? 'Live API' : 'Flash API'}{result.fallbackUsed ? ' · Đang dùng model dự phòng' : ''}</p>}
          {result.providerAttempts && result.providerAttempts.length > 0 && <details className="evidence"><summary>Các model đã thử</summary><ul>{result.providerAttempts.map((attempt, index) => <li key={index}>{attempt.model}: {attempt.status === 'SUCCEEDED' ? 'Đã phân tích' : attempt.status === 'SKIPPED' ? 'Đang tạm nghỉ' : 'Chưa phân tích được'}</li>)}</ul></details>}

          {result.contentAnalysis?.status === 'UNAVAILABLE' && <p className="help" aria-live="polite">{result.contentAnalysis.reason === 'RATE_LIMITED' ? 'Gemini đã chạm giới hạn sử dụng. Hãy thử lại sau.' : result.contentAnalysis.reason === 'TIMEOUT' ? 'Gemini chưa trả kết quả trong thời gian cho phép.' : result.contentAnalysis.reason === 'NOT_CONFIGURED' ? 'Máy chủ chưa được cấu hình Gemini.' : 'Dịch vụ Gemini hiện chưa phân tích được nội dung.'} Kết quả âm học bên dưới vẫn được hiển thị riêng.</p>}
          {result.detectedTactics.length > 0 && <ul className="tactics">{result.detectedTactics.map(tactic => <li key={tactic}><span>{tacticNames[tactic] ?? tactic}</span>{result.tacticEvidence?.find(item => item.tactic === tactic) && <blockquote>{result.tacticEvidence.find(item => item.tactic === tactic)!.quote}</blockquote>}</li>)}</ul>}
          {result.transcriptSnippet && <div className="evidence"><h3>Đoạn lời thoại được nhận diện</h3><blockquote>{result.transcriptSnippet}</blockquote></div>}
          {result.acousticAnalysis && <div className="evidence">
            <h3>Kiểm tra tín hiệu giọng nói</h3>
            <p className="warning" aria-live="polite">{result.acousticAnalysis.status === 'AVAILABLE' ? acousticNames[result.acousticAnalysis.verdict] : 'Bộ kiểm tra giọng nói chưa sẵn sàng'}</p>
            <p className="help">{result.acousticAnalysis.status === 'AVAILABLE' && (result.acousticAnalysis.score === null ? 'Chưa đủ lời nói rõ để chấm điểm. ' : `Điểm mô hình ${Math.round(result.acousticAnalysis.score * 100)}/100, chưa hiệu chuẩn. `)}Kết quả này không xác minh danh tính người gọi và không tự kết luận có lừa đảo.</p>
          </div>}
          <dl className="result-details">{!result.acousticAnalysis && <div><dt>Dấu hiệu giọng tổng hợp</dt><dd>{result.syntheticVoiceProbability === null ? 'Chưa đủ bằng chứng' : `${Math.round(result.syntheticVoiceProbability * 100)}% · ước lượng mô hình`}</dd></div>}<div><dt>Chất lượng âm thanh</dt><dd>{result.audioQuality === 'CLEAR' ? 'Rõ' : result.audioQuality === 'LIMITED' ? 'Hạn chế' : 'Chưa đánh giá được'}</dd></div><div><dt>Thời gian phân tích</dt><dd>{result.executionTimeMs} ms</dd></div></dl>
        </> : <div className="result-guide"><Shield size={32} strokeWidth={1.5} /><h3>Bắt đầu bằng một đoạn âm thanh</h3><p>Thu từ tab hoặc chọn file. Với file thử, chỉ 5 giây đầu được gửi để phân tích.</p><p>Kết quả sẽ chỉ ra nội dung đáng ngờ và lý do cảnh báo để bạn tự kiểm tra lại.</p></div>}
        <p className="limits">Đánh giá tự động chưa xác minh danh tính người gọi. Ước lượng giọng tổng hợp chưa được hiệu chuẩn; kết quả ít rủi ro không bảo đảm cuộc gọi an toàn.</p>
      </section>
    </div>
    <footer className="page-footer">Giữ tab này mở khi kiểm tra. Bạn có thể chuyển sang tab cuộc gọi và quay lại xem kết quả.</footer>
  </main>;
}
