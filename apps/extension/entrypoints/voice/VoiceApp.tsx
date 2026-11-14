import { VOICE_ANALYSIS_TIMEOUTS } from '@zeroleak/shared-types';
import React, { useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, FileAudio, LoaderCircle, Mic, Shield, Square } from 'lucide-react';
import type { VoiceScamAnalysisResult } from '@zeroleak/shared-types';
import { VoiceCapture, type VoiceSource } from '../../utils/voice-capture';
import { audioRms, readVoiceFile, VOICE_SAMPLE_RATE } from '../../utils/voice-audio';
import { analyzeVoice, DEFAULT_VOICE_SETTINGS, voiceEndpoint, type VoiceSettings } from '../../utils/voice-client';
import { EMPTY_VOICE_SESSION, recordVoiceEntry, VOICE_HISTORY_LIMIT, type VoiceEntryMeta } from '../../utils/voice-session';

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
  const [captureMode, setCaptureMode] = useState<'sample' | 'continuous'>('sample');
  const [capturing, setCapturing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileProgress, setFileProgress] = useState<{ name: string; stage: 'reading' | 'analyzing' } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [notice, setNotice] = useState('Sẵn sàng kiểm tra đoạn âm thanh đầu tiên.');
  const [error, setError] = useState('');
  const [result, setResult] = useState<VoiceScamAnalysisResult | null>(null);
  const [session, setSession] = useState(EMPTY_VOICE_SESSION);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const capture = useRef<VoiceCapture | null>(null);
  const request = useRef<AbortController | null>(null);
  const requestMeta = useRef<VoiceEntryMeta | null>(null);
  const nextEntry = useRef(0);
  const run = useRef(0);
  const pendingWindow = useRef<Float32Array | null>(null);
  const finalWindow = useRef<Float32Array | null>(null);
  const capturedSeconds = useRef(0);
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
    const stopBeforeClose = () => { run.current++; pendingWindow.current = null; finalWindow.current = null; request.current?.abort(); capture.current?.stop(); };
    window.addEventListener('pagehide', stopBeforeClose);
    return () => {
      mounted.current = false; window.removeEventListener('pagehide', stopBeforeClose); stopBeforeClose();
    };
  }, []);

  const cancel = () => {
    if (requestMeta.current) {
      const meta = requestMeta.current;
      setSession(previous => recordVoiceEntry(previous, { ...meta, status: 'CANCELLED', message: 'Đã hủy phân tích; đoạn này chưa được đánh giá.' }));
      requestMeta.current = null;
    }
    run.current++; pendingWindow.current = null; finalWindow.current = null; request.current?.abort(); request.current = null; capture.current?.stop();
    setCapturing(false); setStarting(false); setBusy(false); setFileProgress(null);
    setNotice(fileProgress ? 'Đã hủy phân tích file. Bạn có thể chọn file khác.' : 'Đã hủy kiểm tra. Không gửi thêm âm thanh.');
  };

  const submit = async (samples: Float32Array, currentRun: number, mode: 'realtime' | 'review' = 'realtime') => {
    if (run.current !== currentRun) return;
    if (audioRms(samples) < 0.001) {
      if (!request.current) setNotice('Âm thanh đang nhỏ hoặc im lặng; chưa gửi đoạn này.');
      return;
    }
    if (request.current) {
      // At most one pending live window: prefer recent context over an old backlog.
      if (mode === 'realtime') {
        if (pendingWindow.current) setSession(previous => ({ ...previous, skipped: previous.skipped + 1 }));
        pendingWindow.current = samples;
      }
      return;
    }
    const controller = new AbortController(); request.current = controller;
    const meta: VoiceEntryMeta = { id: ++nextEntry.current, source: mode === 'review' ? 'file' : source, durationSeconds: samples.length / VOICE_SAMPLE_RATE };
    requestMeta.current = meta;
    setBusy(true); setError(''); setNotice(mode === 'review' ? 'Đang phân tích file… Có thể chờ đến 15 giây.' : `Đang phân tích đoạn âm thanh… Có thể chờ đến ${VOICE_ANALYSIS_TIMEOUTS.realtime.model / 1000} giây.`);
    try {
      const next = await analyzeVoice(samples, settings, controller.signal, mode);
      if (!mounted.current || run.current !== currentRun) return;
      setSession(previous => recordVoiceEntry(previous, { ...meta, status: 'RESULT', result: next }));
      setResult(next); setProcessed(count => count + 1); setNotice(mode === 'review' ? `Đã nhận kết quả cho toàn bộ ${(samples.length / 16000).toFixed(1)} giây của file đã gửi.` : 'Đã nhận kết quả cho đoạn âm thanh gần nhất.');
    } catch (err) {
      if (mounted.current && run.current === currentRun && !controller.signal.aborted) {
        setSession(previous => recordVoiceEntry(previous, { ...meta, status: 'ERROR', message: err instanceof Error ? err.message : 'Chưa phân tích được âm thanh.' }));
        setResult(null);
        setError(err instanceof Error ? err.message : 'Chưa phân tích được âm thanh.');
        setNotice('Đoạn vừa rồi chưa được đánh giá.');
      }
    } finally {
      if (request.current === controller) { request.current = null; requestMeta.current = null; }
      if (mounted.current && run.current === currentRun) {
        setBusy(false);
        const next = pendingWindow.current ?? finalWindow.current;
        if (pendingWindow.current) pendingWindow.current = null; else finalWindow.current = null;
        if (next) void submit(next, currentRun);
      }
    }
  };

  const finishCapture = (tail?: Float32Array | null) => {
    const samples = tail === undefined ? capture.current?.finish() : tail;
    setCapturing(false); setStarting(false);
    if (samples && samples.length >= VOICE_SAMPLE_RATE / 2) {
      if (request.current && pendingWindow.current) finalWindow.current = samples;
      else void submit(samples, run.current);
    } else if (request.current || pendingWindow.current) {
      setNotice('Đã dừng thu. Đang chờ kết quả cho âm thanh đã gửi…');
    } else if (capturedSeconds.current < .5) {
      setError('Đoạn thu quá ngắn. Hãy thu ít nhất 0,5 giây rồi phân tích.');
      setNotice('Chưa đủ âm thanh để phân tích.');
    } else {
      setNotice('Đã dừng thu âm. Bạn có thể kiểm tra đoạn khác.');
    }
  };

  const prepare = () => {
    voiceEndpoint(settings.apiBase);
    pendingWindow.current = null; finalWindow.current = null; request.current?.abort(); request.current = null;
    // Persist only the service address. The access token stays in this page's memory.
    void chrome.storage.local.set({ zeroleak_voice_settings: { apiBase: settings.apiBase } }).catch(() => {});
    capturedSeconds.current = 0; nextEntry.current = 0; requestMeta.current = null; setSession(EMPTY_VOICE_SESSION);
    setResult(null); setProcessed(0); setElapsed(0); setError(''); setFileProgress(null);
    return ++run.current;
  };

  const start = async () => {
    let currentRun: number;
    try { currentRun = prepare(); } catch (err) { setError((err as Error).message); return; }
    setStarting(true); setNotice('Chọn nguồn âm thanh và cấp quyền để bắt đầu.');
    try {
      await capture.current!.start(source, {
        onWindow: samples => {
          if (run.current !== currentRun) return;
          if (captureMode === 'sample') {
            capture.current?.stop(); setCapturing(false); setStarting(false);
            capturedSeconds.current = 5; setElapsed(5);
          }
          void submit(samples, currentRun);
        },
        onProgress: seconds => { capturedSeconds.current = seconds; setElapsed(seconds); }, onAnalyser: value => { if (mounted.current) setAnalyser(value); },
        onEnded: samples => { if (mounted.current && run.current === currentRun) finishCapture(samples); },
      });
      if (mounted.current && run.current === currentRun) {
        setCapturing(true); setStarting(false); setNotice(captureMode === 'sample'
          ? 'Đang thu một đoạn 5 giây. Hệ thống sẽ tự dừng thu rồi phân tích.'
          : import.meta.env.VITE_VOICE_OVERLAP === '1'
          ? 'Đang thu thử cửa sổ chồng lấp: sau 5 giây đầu, kiểm tra mỗi 2,5 giây; có thể dùng gần gấp đôi lượt phân tích.'
          : 'Đang thu. Mỗi đoạn 5 giây sẽ được phân tích riêng.');
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
    setBusy(true); setFileProgress({ name: file.name, stage: 'reading' }); setNotice('Đang đọc file âm thanh…');
    try {
      const samples = await readVoiceFile(file, true);
      if (run.current === currentRun && mounted.current) {
        setFileProgress({ name: file.name, stage: 'analyzing' });
        await submit(samples, currentRun, 'review');
      }
    } catch (err) {
      if (mounted.current && run.current === currentRun) {
        setError(err instanceof Error ? err.message : 'Không đọc được file âm thanh. Hãy thử WAV hoặc MP3.');
        setNotice('File vừa chọn chưa được đánh giá.');
      }
    } finally { if (mounted.current && run.current === currentRun) { setBusy(false); setFileProgress(null); } }
  };

  const active = capturing || starting || busy;
  const processing = Boolean(fileProgress || busy);
  const showProcessing = Boolean(fileProgress || (busy && !result));
  const activeStep = fileProgress?.stage === 'reading' || starting || (capturing && !busy) ? 1 : busy ? 2 : (result || error) ? 3 : 1;
  const queuedCount = Number(Boolean(pendingWindow.current)) + Number(Boolean(finalWindow.current));
  const windowSeconds = captureMode === 'sample' ? Math.min(elapsed, 5) : elapsed % 5;
  return <main className="voice-app">
    <header className="page-header">
      <a className="brand" href="popup.html"><Shield size={24} aria-hidden="true" /> ZeroLeak <span>Voice</span></a>
      <span className="session-status"><span className={capturing ? 'status-dot recording' : 'status-dot'} />{capturing ? (busy ? 'Đang thu và phân tích' : 'Đang thu âm') : processing ? (fileProgress?.stage === 'reading' ? 'Đang đọc file' : 'Đang phân tích') : result ? 'Đã có kết quả' : 'Sẵn sàng'}</span>
    </header>
    <div className="intro"><h1>Nghe cuộc gọi. Nhìn rõ dấu hiệu.</h1><p>Kiểm tra lời thoại đáng ngờ và dấu hiệu giọng tổng hợp trong từng đoạn âm thanh ngắn.</p></div>
    <ol className="analysis-steps" aria-label="Các bước kiểm tra">
      {['Nhận âm thanh', 'Phân tích', 'Kết quả'].map((label, index) => <li key={label} aria-current={activeStep === index + 1 ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}
    </ol>
    <div className="workspace">
      <section className="capture-panel" aria-labelledby="capture-title">
        <h2 id="capture-title">Nguồn âm thanh</h2>
        <fieldset className="source-selector" disabled={active || !ready}>
          <legend className="sr-only">Chọn nguồn thu âm</legend>
          <label><input type="radio" name="source" checked={source === 'tab'} onChange={() => setSource('tab')} /><span>Âm thanh từ tab</span><small>Cuộc gọi hoặc video trong trình duyệt</small></label>
          <label><input type="radio" name="source" checked={source === 'microphone'} onChange={() => setSource('microphone')} /><span>Micro của bạn</span><small>Thu thử một tình huống trực tiếp</small></label>
        </fieldset>
        <p className="help">{source === 'tab' ? 'Trong hộp chia sẻ, chọn Thẻ Chrome và bật “Chia sẻ âm thanh”.' : 'Micro sẽ gửi cả tiếng nói và âm thanh xung quanh mà nó thu được.'}</p>
        <fieldset className="capture-mode" disabled={active || !ready}>
          <legend>Cách thu âm</legend>
          <label><input type="radio" name="capture-mode" checked={captureMode === 'sample'} onChange={() => setCaptureMode('sample')} />Một đoạn 5 giây</label>
          <label><input type="radio" name="capture-mode" checked={captureMode === 'continuous'} onChange={() => setCaptureMode('continuous')} />Theo dõi liên tục</label>
        </fieldset>
        <p className="help">{captureMode === 'sample' ? 'Tự dừng thu sau 5 giây rồi chờ kết quả. Bạn cũng có thể dừng sớm để phân tích.' : 'Phân tích từng đoạn 5 giây cho đến khi bạn dừng. Dừng thu vẫn giữ yêu cầu đang phân tích.'}</p>
        <div className="audio-monitor"><Waveform analyser={analyser} verdict={session.alert?.result.verdict ?? result?.verdict} /><div className="monitor-caption"><span>{capturing ? `${Math.floor(elapsed)}s đã thu` : elapsed > 0 ? 'Đã dừng thu âm' : 'Sóng âm đầu vào'}</span><span>{processed} đoạn đã kiểm tra</span></div></div>
        {capturing && <div className="capture-feedback">
          <p>{captureMode === 'sample' ? `Còn ${Math.max(0, Math.ceil(5 - elapsed))} giây · sẽ tự dừng thu` : `Đang thu đoạn tiếp theo · ${Math.floor(windowSeconds)} / 5 giây`}</p>
          <progress aria-label="Thời lượng đoạn đang thu" max={5} value={windowSeconds} />
        </div>}
        {session.alert && <p className="session-wave-note">Màu sóng phản ánh cảnh báo đã ghi nhận trong phiên. <a href="#session-warning">Xem bằng chứng</a></p>}
        <div className="primary-actions">
          {starting ? <button className="button stop" onClick={cancel}><Square size={16} />Hủy bắt đầu</button>
            : capturing ? <button className="button stop" onClick={() => finishCapture()}><Square size={16} />Dừng thu và phân tích</button>
            : <button className="button primary" disabled={busy || !ready} onClick={() => void start()}>{busy && !fileProgress ? <><LoaderCircle size={17} className="loading-spinner" aria-hidden="true" />Đang phân tích…</> : <><Mic size={17} />Bắt đầu kiểm tra</>}</button>}
          <button className="button secondary" disabled={active || !ready} onClick={() => fileInput.current?.click()}>
            {fileProgress ? <><LoaderCircle size={17} className="loading-spinner" aria-hidden="true" />{fileProgress.stage === 'reading' ? 'Đang đọc file…' : 'Đang phân tích…'}</> : <><FileAudio size={17} />Chọn file thử</>}
          </button>
          <input ref={fileInput} className="sr-only" aria-label="Chọn file âm thanh để phân tích" type="file" accept="audio/*,.wav,.mp3,.webm,.ogg,.m4a" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} />
        </div>
        <p className="help">Chọn file dài tối đa 15 giây, dung lượng tối đa 10 MB. Kết quả có thể cần đến 15 giây xử lý.</p>
        {busy && !capturing && <button className="text-button" onClick={cancel}>Hủy phân tích</button>}
        <p className="privacy"><Shield size={15} aria-hidden="true" />Khi bạn bắt đầu, âm thanh được gửi tới dịch vụ phân tích và Gemini. ZeroLeak không lưu bản thu vào nhật ký.</p>
        <details className="connection"><summary>Kết nối dịch vụ</summary><label>Địa chỉ dịch vụ<input type="url" value={settings.apiBase} disabled={active} onChange={event => setSettings({ ...settings, apiBase: event.target.value })} placeholder="http://localhost:8080" /></label><label>Mã truy cập <span>(nếu máy chủ yêu cầu)</span><input type="password" autoComplete="off" value={settings.token} disabled={active} onChange={event => setSettings({ ...settings, token: event.target.value })} /></label></details>
      </section>
      <section className={`result-panel ${result ? result.verdict.toLowerCase() : ''}`} aria-labelledby="result-title">
        {session.alert && <aside id="session-warning" className="session-warning" aria-label="Cảnh báo đã ghi nhận trong phiên" aria-live="polite">
          <div className="session-warning-title"><AlertTriangle size={20} aria-hidden="true" /><h3>Phiên này đã có cảnh báo</h3></div>
          <p>Lượt {session.alert.id} · {session.alert.result.riskScore}/100 điểm rủi ro của đoạn đã cảnh báo</p>
          <blockquote>{session.alert.result.tacticEvidence?.[0]?.quote}</blockquote>
          <p className="session-action">{session.alert.result.warningMessageVi}</p>
          <small>Được giữ để kiểm tra ngữ cảnh; không phải kết luận cho toàn bộ cuộc gọi.</small>
        </aside>}
        {session.acousticAlert && (session.acousticAlert.id !== session.lastId || !result) && <aside className="session-acoustic-warning acoustic-panel acoustic-warning" aria-label="Dấu hiệu giọng tổng hợp đã ghi nhận" aria-live="polite">
          <h3>Phiên này đã có dấu hiệu giọng tổng hợp</h3>
          <p>Lượt {session.acousticAlert.id} · điểm detector {Math.round(session.acousticAlert.analysis.score! * 100)}/100, chưa hiệu chuẩn.</p>
          <p className="help">Đây là kết quả của đoạn trước, được giữ để bạn kiểm tra lại. Không tự kết luận có lừa đảo hoặc xác minh danh tính người gọi.</p>
        </aside>}
        <div className="result-heading"><h2 id="result-title">{showProcessing ? (fileProgress ? 'Phân tích file' : 'Phân tích đoạn thu') : (capturing || starting) && !result ? 'Thu âm thanh' : 'Kết quả gần nhất'}</h2><Activity size={19} className={busy ? 'loading-spinner' : undefined} aria-hidden="true" /></div>
        <p className={showProcessing ? 'sr-only' : 'live-status'} role="status" aria-live="polite">{notice}</p>
        {busy && queuedCount > 0 && <p className="help">Còn {queuedCount} đoạn chờ phân tích.</p>}
        {error && <div className="error-message" role="alert"><AlertTriangle size={18} /><span>{error}</span></div>}
        {showProcessing ? <div className="file-processing" role="group" aria-label={fileProgress ? 'Đang xử lý file âm thanh' : 'Đang xử lý đoạn thu'} aria-busy="true">
          <div className="file-processing-heading">
            <LoaderCircle size={24} className="loading-spinner" aria-hidden="true" />
            <div><h3>{fileProgress?.stage === 'reading' ? 'Đang đọc file âm thanh' : 'Đang phân tích âm thanh'}</h3><p className="processing-filename">{fileProgress?.name ?? (source === 'tab' ? 'Âm thanh từ tab' : 'Micro của bạn')}</p></div>
          </div>
          <p className="processing-description">{fileProgress?.stage === 'reading' ? 'Đang chuẩn bị file để phân tích.' : fileProgress ? 'Đang kiểm tra lời thoại và dấu hiệu đáng ngờ. Có thể cần đến 15 giây để nhận kết quả.' : `${capturing ? 'Vẫn đang thu đoạn tiếp theo.' : 'Đã dừng thu âm.'} Đang chờ Gemini phân tích đoạn đã gửi, tối đa ${VOICE_ANALYSIS_TIMEOUTS.realtime.model / 1000} giây cho mỗi đoạn.`}</p>
          <div className="processing-skeleton" aria-hidden="true"><span /><span /><span /></div>
        </div> : (capturing || starting) && !result ? <div className="result-guide">
          <Mic size={32} strokeWidth={1.5} aria-hidden="true" />
          <h3>{starting ? 'Chờ cấp quyền thu âm' : captureMode === 'sample' ? 'Đang nhận âm thanh' : 'Đang theo dõi âm thanh'}</h3>
          <p>{starting ? 'Chọn nguồn và cấp quyền để bắt đầu. Chưa thu âm thanh ở bước này.' : captureMode === 'sample' ? 'Nói hoặc phát âm thanh ngay bây giờ. Thu đủ 5 giây sẽ tự ngừng và chuyển sang phân tích.' : 'Mỗi đoạn 5 giây sẽ được gửi phân tích. Bạn có thể dừng thu bất cứ lúc nào và tiếp tục chờ kết quả.'}</p>
        </div> : result ? <>
          <div className="verdict" aria-live="polite"><h3>{verdictNames[result.verdict]}</h3><div className="risk-number">{result.riskScore === null ? '—' : result.riskScore}<span>/100 điểm rủi ro</span></div></div>
          <p className="warning">{result.warningMessageVi}</p>
          {result.acousticAnalysis && <section className={`acoustic-panel ${result.acousticAnalysis.status === 'AVAILABLE' && result.acousticAnalysis.verdict === 'SYNTHETIC_SUSPECTED' ? 'acoustic-warning' : ''}`} aria-label="Đánh giá giọng nói trên máy">
            <h4>Giọng nói · kiểm tra trên máy</h4>
            <p className="acoustic-verdict" aria-live="polite">{result.acousticAnalysis.status === 'AVAILABLE' ? acousticNames[result.acousticAnalysis.verdict] : 'Bộ kiểm tra giọng nói chưa sẵn sàng'}</p>
            {result.acousticAnalysis.status === 'AVAILABLE' && (result.acousticAnalysis.windowCount ?? 1)>1 && <p className="help">Đã kiểm tra {result.acousticAnalysis.audioDurationSeconds?.toFixed(1)} giây, chia thành {result.acousticAnalysis.windowCount} đoạn. Điểm là mức cao nhất có bằng chứng; đoạn im lặng hoặc thiếu lời nói không được coi là giọng thật.</p>}
            <p className="help">{result.acousticAnalysis.status === 'AVAILABLE' && (result.acousticAnalysis.score === null ? 'Chưa đủ lời nói rõ để chấm điểm. ' : `Điểm detector ${Math.round(result.acousticAnalysis.score * 100)}/100, chưa hiệu chuẩn. `)}Giọng AI có thể được dùng hợp pháp. Điểm thấp không xác minh người gọi là thật; hãy kiểm chứng yêu cầu qua kênh đã biết.</p>
          </section>}
          {result.analysisTransport && <p className="help">Model phân tích nội dung: <strong>{result.analysisModel}</strong> · {result.analysisTransport === 'LIVE_API' ? 'Live API' : 'Flash API'}{result.fallbackUsed ? ' · Đang dùng model dự phòng' : ''}</p>}
          {result.providerAttempts && result.providerAttempts.length > 0 && <details className="evidence"><summary>Các model đã thử</summary><ul>{result.providerAttempts.map((attempt, index) => <li key={index}>{attempt.model}: {attempt.status === 'SUCCEEDED' ? 'Đã phân tích' : attempt.status === 'SKIPPED' ? 'Đang tạm nghỉ' : 'Chưa phân tích được'}</li>)}</ul></details>}

          {result.contentAnalysis?.status === 'UNAVAILABLE' && <p className="help" aria-live="polite">{result.contentAnalysis.reason === 'RATE_LIMITED' ? 'Gemini đã chạm giới hạn sử dụng. Hãy thử lại sau.' : result.contentAnalysis.reason === 'TIMEOUT' ? 'Gemini chưa trả kết quả trong thời gian cho phép.' : result.contentAnalysis.reason === 'NOT_CONFIGURED' ? 'Máy chủ chưa được cấu hình Gemini.' : 'Dịch vụ Gemini hiện chưa phân tích được nội dung.'} Kết quả âm học bên dưới vẫn được hiển thị riêng.</p>}
          {result.detectedTactics.length > 0 && <ul className="tactics">{result.detectedTactics.map(tactic => <li key={tactic}><span>{tacticNames[tactic] ?? tactic}</span>{result.tacticEvidence?.find(item => item.tactic === tactic) && <blockquote>{result.tacticEvidence.find(item => item.tactic === tactic)!.quote}</blockquote>}</li>)}</ul>}
          {result.transcriptSnippet && <div className="evidence"><h3>Đoạn lời thoại được nhận diện</h3><blockquote>{result.transcriptSnippet}</blockquote></div>}

          <dl className="result-details">{!result.acousticAnalysis && <div><dt>Dấu hiệu giọng tổng hợp</dt><dd>{result.syntheticVoiceProbability === null ? 'Chưa đủ bằng chứng' : `${Math.round(result.syntheticVoiceProbability * 100)}% · ước lượng mô hình`}</dd></div>}<div><dt>Chất lượng âm thanh</dt><dd>{result.audioQuality === 'CLEAR' ? 'Rõ' : result.audioQuality === 'LIMITED' ? 'Hạn chế' : 'Chưa đánh giá được'}</dd></div><div><dt>Thời gian phân tích</dt><dd>{result.executionTimeMs} ms</dd></div></dl>
        </> : <div className="result-guide"><Shield size={32} strokeWidth={1.5} /><h3>Bắt đầu bằng một đoạn âm thanh</h3><p>Chọn nguồn thu và cách thu âm, hoặc chọn file có sẵn dài tối đa 15 giây. Chế độ một đoạn sẽ tự dừng thu sau 5 giây để phân tích.</p><p>Kết quả sẽ chỉ ra nội dung đáng ngờ và lý do cảnh báo để bạn tự kiểm tra lại.</p></div>}
        <p className="limits">Đánh giá tự động chưa xác minh danh tính người gọi. Ước lượng giọng tổng hợp chưa được hiệu chuẩn; kết quả ít rủi ro không bảo đảm cuộc gọi an toàn.</p>
      </section>
    </div>
    {session.entries.length > 0 && <section className="session-history" aria-labelledby="session-history-title">
      <div className="session-history-heading"><h2 id="session-history-title">Diễn biến phiên kiểm tra</h2><p>{session.received} kết quả{session.failed > 0 && ` · ${session.failed} lượt lỗi / timeout`}{session.cancelled > 0 && ` · ${session.cancelled} lượt đã hủy`}</p></div>
      {session.skipped > 0 && <p className="session-coverage">{session.skipped} đoạn chưa gửi do dịch vụ bận. Phiên này chưa được phân tích đầy đủ.</p>}
      <ol className="session-timeline" aria-label="Lịch sử các lượt phân tích">{session.entries.map(entry => <li key={entry.id}>
        <div className="timeline-summary"><strong>Lượt {entry.id}</strong><span>{entry.source === 'file' ? 'File âm thanh' : entry.source === 'tab' ? 'Âm thanh từ tab' : 'Micro của bạn'} · {entry.durationSeconds.toFixed(1)} giây</span><span className={`timeline-state ${entry.status === 'RESULT' ? entry.result.verdict.toLowerCase() : 'unavailable'}`}>{entry.status === 'RESULT' ? verdictNames[entry.result.verdict] : entry.status === 'ERROR' ? 'Chưa đánh giá được' : 'Đã hủy'}</span></div>
        {entry.status === 'RESULT' ? <details><summary>Xem chi tiết lượt {entry.id}</summary>
          {entry.result.acousticAnalysis && <p className="history-acoustic">Giọng nói: {entry.result.acousticAnalysis.status === 'AVAILABLE' ? acousticNames[entry.result.acousticAnalysis.verdict] : 'Chưa đánh giá được'}{entry.result.acousticAnalysis.status === 'AVAILABLE' && entry.result.acousticAnalysis.score !== null ? ` · ${Math.round(entry.result.acousticAnalysis.score * 100)}/100, chưa hiệu chuẩn` : ''}</p>}
          {entry.result.transcriptSnippet && <blockquote>{entry.result.transcriptSnippet}</blockquote>}
          {entry.result.tacticEvidence && entry.result.tacticEvidence.length > 0 && <ul>{entry.result.tacticEvidence.map((item,index) => <li key={index}><strong>{tacticNames[item.tactic]}</strong>: {item.quote}</li>)}</ul>}
          <p>{entry.result.warningMessageVi}</p><small>{entry.result.analysisModel} · {entry.result.riskScore === null ? 'Chưa đủ thông tin để chấm điểm' : `${entry.result.riskScore}/100 điểm rủi ro nội dung`}</small>
        </details> : <p className="timeline-error">{entry.message}</p>}
      </li>)}</ol>
      <p className="help">Chỉ giữ {VOICE_HISTORY_LIMIT} lượt mới nhất trong bộ nhớ trang, không lưu bản thu. Cảnh báo cao nhất có bằng chứng được giữ riêng. Bắt đầu kiểm tra mới hoặc chọn file mới sẽ xóa lịch sử phiên này.</p>
    </section>}
    <footer className="page-footer">Giữ tab này mở khi kiểm tra. Bạn có thể chuyển sang tab cuộc gọi và quay lại xem kết quả.</footer>
  </main>;
}
