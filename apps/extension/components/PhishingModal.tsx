import React from 'react';
import type { PhishingAnalysisResponse } from '@zeroleak/shared-types';

interface PhishingModalProps {
  analysis: PhishingAnalysisResponse | null;
  onClose: () => void;
}

export const PhishingModal: React.FC<PhishingModalProps> = ({ analysis, onClose }) => {
  React.useEffect(() => {
    if (!analysis) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [analysis, onClose]);

  if (!analysis) return null;

  const isMalicious = analysis.verdict === 'MALICIOUS';
  const isSuspicious = analysis.verdict === 'SUSPICIOUS';

  const verdictTheme = isMalicious
    ? {
        bg: '#180709',
        border: 'rgba(239, 68, 68, 0.45)',
        badgeBg: '#7f1d1d',
        badgeText: '#fecaca',
        scoreColor: '#ef4444',
        title: 'NGUY HIỂM: PHÁT HIỆN TẤN CÔNG GIẢ MẠO',
        icon: '🚨',
      }
    : isSuspicious
    ? {
        bg: '#181106',
        border: 'rgba(245, 158, 11, 0.45)',
        badgeBg: '#78350f',
        badgeText: '#fef3c7',
        scoreColor: '#f59e0b',
        title: 'CẢNH BÁO: ĐƯỜNG DẪN ĐÁNG NGỜ',
        icon: '⚠️',
      }
    : {
        bg: '#061812',
        border: 'rgba(16, 185, 129, 0.45)',
        badgeBg: '#064e3b',
        badgeText: '#d1fae5',
        scoreColor: '#10b981',
        title: 'AN TOÀN: KHÔNG PHÁT HIỆN DẤU HIỆU LỪA ĐẢO',
        icon: '🛡️',
      };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(2, 6, 23, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 2147483647,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        pointerEvents: 'auto',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '540px',
          backgroundColor: verdictTheme.bg,
          border: `1px solid ${verdictTheme.border}`,
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          overflow: 'hidden',
          color: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: `1px solid ${verdictTheme.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'rgba(0, 0, 0, 0.25)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>{verdictTheme.icon}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '13px', color: verdictTheme.scoreColor }}>
                {verdictTheme.title}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>ZeroLeak Lens Threat Analyzer</div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: '18px',
              padding: '4px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Risk Score & Verdict Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: 'rgba(15, 23, 42, 0.6)',
              padding: '12px 16px',
              borderRadius: '10px',
              border: '1px solid rgba(51, 65, 85, 0.6)',
            }}
          >
            <div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>ĐIỂM RỦI RO (RISK SCORE)</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: verdictTheme.scoreColor }}>
                {analysis.riskScore} <span style={{ fontSize: '13px', color: '#64748b' }}>/ 100</span>
              </div>
            </div>

            <span
              style={{
                backgroundColor: verdictTheme.badgeBg,
                color: verdictTheme.badgeText,
                padding: '6px 14px',
                borderRadius: '9999px',
                fontWeight: 700,
                fontSize: '12px',
                letterSpacing: '0.05em',
                border: `1px solid ${verdictTheme.border}`,
              }}
            >
              {analysis.verdict}
            </span>
          </div>

          {/* Impersonated Brand Alert */}
          {analysis.impersonatedBrand && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
                color: '#fca5a5',
              }}
            >
              <span>🚨</span>
              <span>
                Thương hiệu bị nhắm mục tiêu: <b>{analysis.impersonatedBrand}</b>
              </span>
            </div>
          )}

          {/* Target URL Info */}
          <div style={{ fontSize: '12px' }}>
            <div style={{ color: '#94a3b8', marginBottom: '4px' }}>Địa chỉ kiểm tra:</div>
            <div
              style={{
                padding: '8px 12px',
                backgroundColor: 'rgba(15, 23, 42, 0.8)',
                borderRadius: '6px',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '11px',
                color: '#38bdf8',
                wordBreak: 'break-all',
                border: '1px solid rgba(51, 65, 85, 0.6)',
              }}
            >
              {analysis.url}
            </div>
          </div>

          {/* Indicators List */}
          <div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
              Chỉ số phân tích & Bằng chứng nhận diện:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {analysis.indicators.map((ind, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px',
                    fontSize: '12px',
                    color: '#e2e8f0',
                    lineHeight: '1.4',
                  }}
                >
                  <span style={{ color: verdictTheme.scoreColor, marginTop: '2px' }}>•</span>
                  <span>{ind}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Screenshot Preview if available */}
          {analysis.screenshotBase64 && (
            <div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
                Ảnh chụp Playwright Sandbox:
              </div>
              <img
                src={`data:image/webp;base64,${analysis.screenshotBase64}`}
                alt="Sandbox Screenshot"
                style={{
                  width: '100%',
                  height: '160px',
                  objectFit: 'cover',
                  borderRadius: '8px',
                  border: '1px solid rgba(51, 65, 85, 0.8)',
                }}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: `1px solid ${verdictTheme.border}`,
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: '#64748b',
          }}
        >
          <span>Thời gian phân tích: {analysis.executionTimeMs}ms</span>
          <button
            onClick={onClose}
            style={{
              padding: '6px 16px',
              backgroundColor: isMalicious ? '#ef4444' : '#10b981',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '12px',
            }}
          >
            Đã hiểu & Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
