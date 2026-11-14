import React, { useEffect, useState } from 'react';
import {
  DEFAULT_SECURITY_POLICY,
  type PolicyActionMode,
  type SecurityPolicy,
  type SensitiveDataType,
  type PhishingAnalysisResponse,
} from '@zeroleak/shared-types';
import {
  Shield,
  Lock,
  Eye,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Sliders,
  QrCode,
  Search,
  ExternalLink,
  Mic,
  Loader2,
} from 'lucide-react';
import { analyzeUrlWithSandbox } from '../../utils/phishing-client';
import { decodeQrFromImageSource } from '../../utils/qr-scanner';
import { PopupThreatReport } from '../../components/PopupThreatReport';

export default function App() {
  const [policy, setPolicy] = useState<SecurityPolicy>(DEFAULT_SECURITY_POLICY);
  const [loading, setLoading] = useState(true);
  const [savedBadge, setSavedBadge] = useState(false);
  const [urlToCheck, setUrlToCheck] = useState('');
  const [checkingUrl, setCheckingUrl] = useState(false);
  const [urlResult, setUrlResult] = useState<PhishingAnalysisResponse | null>(null);
  const [scanningQr, setScanningQr] = useState(false);
  const [qrStatusText, setQrStatusText] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [projectingToTab, setProjectingToTab] = useState(false);
  const [tabProjectError, setTabProjectError] = useState<string | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_POLICY' }, (response) => {
      if (response) {
        setPolicy(response);
      }
      setLoading(false);
    });
  }, []);

  const handleModeChange = (newMode: PolicyActionMode) => {
    const updated: SecurityPolicy = {
      ...policy,
      mode: newMode,
      updatedAt: new Date().toISOString(),
    };
    setPolicy(updated);
    savePolicy(updated);
  };

  const handleToggleType = (type: SensitiveDataType) => {
    const exists = policy.enabledTypes.includes(type);
    const updatedTypes = exists
      ? policy.enabledTypes.filter((t) => t !== type)
      : [...policy.enabledTypes, type];

    const updated: SecurityPolicy = {
      ...policy,
      enabledTypes: updatedTypes,
      updatedAt: new Date().toISOString(),
    };
    setPolicy(updated);
    savePolicy(updated);
  };

  const savePolicy = (updated: SecurityPolicy) => {
    chrome.runtime.sendMessage({ type: 'UPDATE_POLICY', policy: updated }, () => {
      setSavedBadge(true);
      setTimeout(() => setSavedBadge(false), 2000);
    });
  };

  const handleDirectTabQrScan = async () => {
    setScanningQr(true);
    setQrStatusText('Đang chụp màn hình tab...');
    setQrError(null);

    try {
      const dataUrl = await new Promise<string | null>((resolve) => {
        chrome.tabs.captureVisibleTab({ format: 'png' }, (result) => {
          if (chrome.runtime.lastError || !result) {
            resolve(null);
          } else {
            resolve(result);
          }
        });
      });

      if (!dataUrl) {
        setQrError('Không thể chụp ảnh tab này do giới hạn bảo mật của trình duyệt.');
        setScanningQr(false);
        return;
      }

      setQrStatusText('Đang giải mã mã QR...');
      const qrResult = await decodeQrFromImageSource(dataUrl);

      if (!qrResult || !qrResult.data) {
        setQrError('Không phát hiện thấy mã QR rõ ràng trên màn hình. Hãy đảm bảo mã QR nằm trong khung hiển thị.');
        setScanningQr(false);
        return;
      }

      const qrData = qrResult.data.trim();
      const isUrl = /^https?:\/\//i.test(qrData) || /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/i.test(qrData);

      if (isUrl) {
        const fullUrl = qrData.startsWith('http') ? qrData : `https://${qrData}`;
        setUrlToCheck(fullUrl);
        setCheckingUrl(true);
        setQrStatusText('Đang phân tích an toàn liên kết...');
        const analysis = await analyzeUrlWithSandbox(fullUrl, 'QR_CODE');
        setUrlResult(analysis);
      } else {
        setUrlResult({
          url: qrData,
          finalRedirectUrl: qrData,
          riskScore: 0,
          verdict: 'SAFE',
          impersonatedBrand: null,
          actualDomain: 'Nội dung QR (Văn bản)',
          hasPasswordInput: false,
          hasOtpInput: false,
          indicators: [`Nội dung mã QR: "${qrData}"`],
          executionTimeMs: 12,
        });
      }
    } catch (err: any) {
      setQrError('Lỗi trong quá trình quét QR: ' + (err?.message || 'Không xác định'));
    } finally {
      setScanningQr(false);
      setQrStatusText(null);
    }
  };

  const triggerQrScanOnTab = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    setQrError(null);

    // If tab URL is restricted scheme where content script cannot be injected (blob:, chrome:, about:, etc.)
    const isRestrictedScheme =
      tab.url?.startsWith('blob:') ||
      tab.url?.startsWith('chrome:') ||
      tab.url?.startsWith('chrome-extension:') ||
      tab.url?.startsWith('about:') ||
      tab.url?.startsWith('edge:');

    if (isRestrictedScheme) {
      // Execute Direct Capture & Scan immediately inside popup
      await handleDirectTabQrScan();
      return;
    }

    // Try sending message to existing content script
    chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_QR_SCAN' }, async () => {
      if (chrome.runtime.lastError) {
        // Content script not loaded yet (e.g. unrefreshed tab), attempt dynamic injection
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id! },
            files: ['content-scripts/content.js'],
          });
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id!, { type: 'TRIGGER_QR_SCAN' });
            window.close();
          }, 150);
        } catch {
          // If dynamic injection also fails, fallback to direct tab capture
          await handleDirectTabQrScan();
        }
      } else {
        window.close();
      }
    });
  };

  const handleQuickUrlCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlToCheck.trim()) return;

    setCheckingUrl(true);
    setUrlResult(null);
    try {
      const res = await analyzeUrlWithSandbox(urlToCheck.trim(), 'DIRECT_CHECK');
      setUrlResult(res);
    } catch {
      // Ignored
    } finally {
      setCheckingUrl(false);
    }
  };

  const handleShowOnActiveTab = async (analysis: PhishingAnalysisResponse) => {
    setProjectingToTab(true);
    setTabProjectError(null);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setTabProjectError('Không tìm thấy tab trình duyệt đang hoạt động.');
        setProjectingToTab(false);
        return;
      }

      // Kiểm tra nếu tab hiện tại là trang nội bộ bị trình duyệt cấm tiêm script
      const isRestricted =
        !tab.url ||
        tab.url.startsWith('chrome://') ||
        tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('edge://') ||
        tab.url.startsWith('about:') ||
        tab.url.startsWith('view-source:');

      if (isRestricted) {
        setTabProjectError(
          'Trang nội bộ này (chrome://) bị Chrome cấm hiển thị giao diện. Hãy chuyển sang một tab trang web thông thường (như Facebook, Google...) rồi bấm lại!'
        );
        setProjectingToTab(false);
        return;
      }

      // Thử gửi message tới content script đã chạy trên tab
      chrome.tabs.sendMessage(tab.id, { type: 'SHOW_ANALYSIS_MODAL', analysis }, async () => {
        if (chrome.runtime.lastError) {
          // Tab chưa có content script (do chưa F5 tab sau khi reload extension) -> tự động tiêm
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id! },
              files: ['content-scripts/content.js'],
            });

            // Chờ React Shadow DOM gắn vào trang rồi gửi lại
            setTimeout(() => {
              chrome.tabs.sendMessage(tab.id!, { type: 'SHOW_ANALYSIS_MODAL', analysis });
              setTimeout(() => window.close(), 120);
            }, 300);
          } catch (injectErr: any) {
            setTabProjectError('Không thể chiếu lên trang này: ' + (injectErr?.message || 'Giới hạn bảo mật'));
            setProjectingToTab(false);
          }
        } else {
          // Đã nhận thành công, đóng popup
          setTimeout(() => window.close(), 100);
        }
      });
    } catch (err: any) {
      setTabProjectError('Lỗi kết nối tab: ' + (err?.message || 'Không xác định'));
      setProjectingToTab(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-center text-slate-400">Đang tải cấu hình...</div>;
  }

  return (
    <div className="w-full max-w-[380px] text-xs pb-1">
      {/* Header */}
      <header className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">ZeroLeak</h1>
            <p className="text-[10px] text-slate-400">On-Device AI DLP &amp; Threat Security</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Active
        </div>
      </header>

      {/* Action Mode Selector */}
      <button
        onClick={() => { void chrome.tabs.create({ url: chrome.runtime.getURL('/voice.html') }); window.close(); }}
        className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
      >
        <Mic className="w-4 h-4" aria-hidden="true" /> Bảo vệ cuộc gọi — ZeroLeak Voice
      </button>
      <div className="mt-3">
        <label className="text-[11px] font-semibold text-slate-300 block mb-1.5">
          Chế độ Hành động (Policy Mode):
        </label>
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-900 rounded-xl border border-slate-800">
          <button
            onClick={() => handleModeChange('AUTO_TOKENIZE')}
            className={`py-1.5 px-2 rounded-lg font-medium text-[11px] transition-all flex flex-col items-center gap-1 ${
              policy.mode === 'AUTO_TOKENIZE'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Mã hóa 2 chiều</span>
          </button>

          <button
            onClick={() => handleModeChange('STRICT_BLOCK')}
            className={`py-1.5 px-2 rounded-lg font-medium text-[11px] transition-all flex flex-col items-center gap-1 ${
              policy.mode === 'STRICT_BLOCK'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Chặn cứng</span>
          </button>

          <button
            onClick={() => handleModeChange('AUDIT_ONLY')}
            className={`py-1.5 px-2 rounded-lg font-medium text-[11px] transition-all flex flex-col items-center gap-1 ${
              policy.mode === 'AUDIT_ONLY'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Chỉ ghi log</span>
          </button>
        </div>
      </div>

      {/* Quick Action: Screen QR Scanner */}
      <div className="mt-3">
        <button
          onClick={triggerQrScanOnTab}
          disabled={scanningQr}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 rounded-xl font-medium transition-all text-[11px] disabled:opacity-60"
        >
          {scanningQr ? (
            <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
          ) : (
            <QrCode className="w-3.5 h-3.5 text-emerald-400" />
          )}
          <span>{qrStatusText || 'Khoanh vùng quét mã QR trên màn hình'}</span>
        </button>

        {qrError && (
          <div className="mt-2 p-2 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-[10px] flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
            <span>{qrError}</span>
          </div>
        )}
      </div>

      {/* Quick URL Phishing Check */}
      <div className="mt-3">
        <form onSubmit={handleQuickUrlCheck} className="flex gap-1.5">
          <input
            type="text"
            placeholder="Kiểm tra link giả mạo..."
            value={urlToCheck}
            onChange={(e) => setUrlToCheck(e.target.value)}
            className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 text-[11px] placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            disabled={checkingUrl}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium rounded-lg text-[11px] flex items-center gap-1"
          >
            <Search className="w-3 h-3" />
            <span>{checkingUrl ? 'Quét...' : 'Soi'}</span>
          </button>
        </form>

        {urlResult && (
          <PopupThreatReport
            analysis={urlResult}
            onClose={() => {
              setUrlResult(null);
              setTabProjectError(null);
            }}
            onShowOnTab={() => handleShowOnActiveTab(urlResult)}
            isProjecting={projectingToTab}
            projectError={tabProjectError}
          />
        )}
      </div>

      {/* Enabled Types Filter */}
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
            <Sliders className="w-3 h-3 text-slate-400" />
            <span>Bộ lọc dữ liệu nhạy cảm:</span>
          </label>
          {savedBadge && (
            <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-medium animate-fade-in">
              <CheckCircle2 className="w-2.5 h-2.5" /> Đã lưu
            </span>
          )}
        </div>

        <div className="space-y-1 bg-slate-900/60 p-2 rounded-xl border border-slate-800 max-h-36 overflow-y-auto">
          {[
            { id: 'VN_CCCD', label: 'Căn cước công dân (12 số VN)' },
            { id: 'CREDIT_CARD', label: 'Thẻ tín dụng / Ngân hàng (Luhn)' },
            { id: 'API_SECRET', label: 'API Keys & Secrets (AIza, sk-, ghp...)' },
            { id: 'EMAIL', label: 'Địa chỉ Email' },
            { id: 'PHONE_VN', label: 'Số điện thoại Việt Nam' },
            { id: 'PERSON_NAME', label: 'Họ và tên riêng (Contextual NER)' },
            { id: 'ORGANIZATION', label: 'Tên Tổ chức / Doanh nghiệp' },
          ].map((item) => {
            const checked = policy.enabledTypes.includes(item.id as SensitiveDataType);
            return (
              <label
                key={item.id}
                className="flex items-center justify-between p-1 rounded-lg hover:bg-slate-800/60 cursor-pointer transition-colors"
              >
                <span className="text-slate-300 text-[11px]">{item.label}</span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => handleToggleType(item.id as SensitiveDataType)}
                  className="w-3.5 h-3.5 accent-emerald-500 rounded cursor-pointer"
                />
              </label>
            );
          })}
        </div>
      </div>

      {/* Footer Info */}
      <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <ExternalLink className="w-2.5 h-2.5" /> ZeroLeak Shield
        </span>
        <span>v1.0.0</span>
      </div>
    </div>
  );
}
