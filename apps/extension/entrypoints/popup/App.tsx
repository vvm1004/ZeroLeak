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
  CheckCircle2,
  Sliders,
  QrCode,
  Search,
  ExternalLink,
  Mic,
} from 'lucide-react';
import { analyzeUrlWithSandbox } from '../../utils/phishing-client';

export default function App() {
  const [policy, setPolicy] = useState<SecurityPolicy>(DEFAULT_SECURITY_POLICY);
  const [loading, setLoading] = useState(true);
  const [savedBadge, setSavedBadge] = useState(false);
  const [urlToCheck, setUrlToCheck] = useState('');
  const [checkingUrl, setCheckingUrl] = useState(false);
  const [urlResult, setUrlResult] = useState<PhishingAnalysisResponse | null>(null);

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

  const triggerQrScanOnTab = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_QR_SCAN' });
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

  if (loading) {
    return <div className="p-6 text-center text-slate-400">Đang tải cấu hình...</div>;
  }

  return (
    <div className="w-[360px] text-xs pb-1">
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
          className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 rounded-xl font-medium transition-all text-[11px]"
        >
          <QrCode className="w-3.5 h-3.5 text-emerald-400" />
          <span>Khoanh vùng quét mã QR trên màn hình</span>
        </button>
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
          <div
            className={`mt-2 p-2.5 rounded-lg border text-[11px] ${
              urlResult.verdict === 'MALICIOUS'
                ? 'bg-rose-950/40 border-rose-800 text-rose-300'
                : urlResult.verdict === 'SUSPICIOUS'
                ? 'bg-amber-950/40 border-amber-800 text-amber-300'
                : 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
            }`}
          >
            <div className="flex items-center justify-between font-bold mb-1">
              <span>{urlResult.verdict} ({urlResult.riskScore}/100)</span>
              <span>{urlResult.executionTimeMs}ms</span>
            </div>
            {urlResult.impersonatedBrand && (
              <div className="font-semibold text-rose-400 mb-1">
                ⚠️ Nhắm vào: {urlResult.impersonatedBrand}
              </div>
            )}
            <div className="text-[10px] text-slate-300 line-clamp-2">
              {urlResult.indicators[0]}
            </div>
          </div>
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
