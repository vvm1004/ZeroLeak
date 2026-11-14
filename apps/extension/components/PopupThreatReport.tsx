import React from 'react';
import type { PhishingAnalysisResponse } from '@zeroleak/shared-types';

interface PopupThreatReportProps {
  analysis: PhishingAnalysisResponse;
  onClose: () => void;
  onShowOnTab?: () => void;
  isProjecting?: boolean;
  projectError?: string | null;
}

export const PopupThreatReport: React.FC<PopupThreatReportProps> = ({
  analysis,
  onClose,
  onShowOnTab,
  isProjecting,
  projectError,
}) => {
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
        marginTop: '10px',
        backgroundColor: verdictTheme.bg,
        border: `1px solid ${verdictTheme.border}`,
        borderRadius: '12px',
        boxShadow: '0 12px 28px -6px rgba(0, 0, 0, 0.7)',
        overflow: 'hidden',
        color: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: `1px solid ${verdictTheme.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'rgba(0, 0, 0, 0.35)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '17px' }}>{verdictTheme.icon}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '11px', color: verdictTheme.scoreColor }}>
              {verdictTheme.title}
            </div>
            <div style={{ fontSize: '9.5px', color: '#94a3b8' }}>ZeroLeak Lens Threat Analyzer</div>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            fontSize: '15px',
            padding: '2px 4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Đóng kết quả"
        >
          ✕
        </button>
      </div>

      {/* Content Body - Scrollable */}
      <div
        style={{
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          maxHeight: '340px',
          overflowY: 'auto',
        }}
      >
        {/* Risk Score & Verdict Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            padding: '8px 12px',
            borderRadius: '8px',
            border: '1px solid rgba(51, 65, 85, 0.6)',
          }}
        >
          <div>
            <div style={{ fontSize: '9px', fontWeight: 600, color: '#94a3b8', letterSpacing: '0.05em' }}>
              ĐIỂM RỦI RO (RISK SCORE)
            </div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: verdictTheme.scoreColor, lineHeight: 1.2 }}>
              {analysis.riskScore} <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>/ 100</span>
            </div>
          </div>

          <span
            style={{
              backgroundColor: verdictTheme.badgeBg,
              color: verdictTheme.badgeText,
              padding: '4px 10px',
              borderRadius: '9999px',
              fontWeight: 700,
              fontSize: '10px',
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
              padding: '7px 10px',
              borderRadius: '6px',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              color: '#fca5a5',
            }}
          >
            <span>🚨</span>
            <span>
              Thương hiệu bị nhắm mục tiêu: <b>{analysis.impersonatedBrand}</b>
            </span>
          </div>
        )}

        {/* Target URL */}
        <div style={{ fontSize: '10.5px' }}>
          <div style={{ color: '#94a3b8', marginBottom: '2px', fontSize: '10px' }}>Địa chỉ kiểm tra:</div>
          <div
            style={{
              padding: '5px 8px',
              backgroundColor: 'rgba(15, 23, 42, 0.8)',
              borderRadius: '6px',
              fontFamily: 'ui-monospace, monospace',
              fontSize: '10.5px',
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
          <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>
            Chỉ số phân tích & Bằng chứng nhận diện:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {analysis.indicators.map((ind, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '6px',
                  fontSize: '10.5px',
                  color: '#e2e8f0',
                  lineHeight: '1.35',
                }}
              >
                <span style={{ color: verdictTheme.scoreColor, marginTop: '2px', flexShrink: 0 }}>•</span>
                <span>{ind}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Playwright Sandbox Screenshot */}
        {analysis.screenshotBase64 && (
          <div>
            <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>
              Ảnh chụp Playwright Sandbox:
            </div>
            <div
              style={{
                width: '100%',
                height: '115px',
                borderRadius: '6px',
                overflow: 'hidden',
                border: '1px solid rgba(51, 65, 85, 0.8)',
                backgroundColor: '#0a0f1d',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src={`data:image/webp;base64,${analysis.screenshotBase64}`}
                alt="Sandbox Screenshot"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: `1px solid ${verdictTheme.border}`,
          backgroundColor: 'rgba(0, 0, 0, 0.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '10px',
          color: '#94a3b8',
        }}
      >
        <span>
          Thời gian: <strong style={{ color: '#e2e8f0' }}>{analysis.executionTimeMs}ms</strong>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {onShowOnTab && (
            <button
              onClick={onShowOnTab}
              disabled={isProjecting}
              style={{
                padding: '4px 8px',
                backgroundColor: isProjecting ? 'rgba(51, 65, 85, 0.4)' : 'rgba(51, 65, 85, 0.65)',
                color: isProjecting ? '#94a3b8' : '#e2e8f0',
                border: '1px solid rgba(100, 116, 139, 0.5)',
                borderRadius: '5px',
                cursor: isProjecting ? 'wait' : 'pointer',
                fontWeight: 600,
                fontSize: '9.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
              title="Mở toàn màn hình trên Tab hiện tại như hình 1"
            >
              {isProjecting && <span className="animate-spin text-[10px]">⏳</span>}
              <span>{isProjecting ? 'Đang chiếu...' : 'Chiếu lên Tab'}</span>
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '4px 12px',
              backgroundColor: isMalicious ? '#ef4444' : '#10b981',
              color: '#ffffff',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '10px',
              boxShadow: isMalicious
                ? '0 2px 6px rgba(239, 68, 68, 0.4)'
                : '0 2px 6px rgba(16, 185, 129, 0.4)',
            }}
          >
            Đã hiểu & Đóng
          </button>
        </div>
      </div>

      {/* Error notification if projecting fails */}
      {projectError && (
        <div
          style={{
            padding: '6px 12px',
            backgroundColor: 'rgba(127, 29, 29, 0.7)',
            borderTop: '1px solid rgba(239, 68, 68, 0.5)',
            fontSize: '9.5px',
            color: '#fecaca',
            lineHeight: 1.35,
          }}
        >
          {projectError}
        </div>
      )}
    </div>
  );
};

