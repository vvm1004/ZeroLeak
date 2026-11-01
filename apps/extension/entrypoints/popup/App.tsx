import React, { useEffect, useState } from 'react';
import {
  DEFAULT_SECURITY_POLICY,
  type PolicyActionMode,
  type SecurityPolicy,
  type SensitiveDataType,
} from '@zeroleak/shared-types';
import { Shield, Lock, Eye, AlertTriangle, CheckCircle2, Sliders } from 'lucide-react';

export default function App() {
  const [policy, setPolicy] = useState<SecurityPolicy>(DEFAULT_SECURITY_POLICY);
  const [loading, setLoading] = useState(true);
  const [savedBadge, setSavedBadge] = useState(false);

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

  if (loading) {
    return <div className="p-6 text-center text-slate-400">Đang tải cấu hình...</div>;
  }

  return (
    <div className="w-[348px] text-xs">
      {/* Header */}
      <header className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">ZeroLeak &amp; PhishGuard</h1>
            <p className="text-[10px] text-slate-400">On-Device DLP &amp; Threat Isolation</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Active
        </div>
      </header>

      {/* Action Mode Selector */}
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

      {/* Enabled Types Filter */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
            <Sliders className="w-3 h-3 text-slate-400" />
            <span>Dữ liệu nhạy cảm cần lọc:</span>
          </label>
          {savedBadge && (
            <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-medium animate-fade-in">
              <CheckCircle2 className="w-2.5 h-2.5" /> Đã lưu
            </span>
          )}
        </div>

        <div className="space-y-1 bg-slate-900/60 p-2 rounded-xl border border-slate-800">
          {[
            { id: 'VN_CCCD', label: 'Căn cước công dân (12 số VN)' },
            { id: 'CREDIT_CARD', label: 'Thẻ tín dụng / Ngân hàng (Luhn)' },
            { id: 'API_SECRET', label: 'API Keys & Secrets (AIza, sk-, ghp...)' },
            { id: 'EMAIL', label: 'Địa chỉ Email' },
            { id: 'PHONE_VN', label: 'Số điện thoại Việt Nam' },
          ].map((item) => {
            const checked = policy.enabledTypes.includes(item.id as SensitiveDataType);
            return (
              <label
                key={item.id}
                className="flex items-center justify-between p-1.5 rounded-lg hover:bg-slate-800/60 cursor-pointer transition-colors"
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
      <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-500">
        <span>Bảo vệ: ChatGPT, Claude, Gemini, Gmail</span>
        <span>v1.0.0</span>
      </div>
    </div>
  );
}

