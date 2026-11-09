import React, { useState } from 'react';
import type { PolicyActionMode } from '@zeroleak/shared-types';

interface TelemetryBadgeProps {
  policyMode: PolicyActionMode;
  latencyMs: number | null;
  shieldedCount: number;
  onScanQrClick: () => void;
  onClearVaultClick: () => void;
}

export const TelemetryBadge: React.FC<TelemetryBadgeProps> = ({
  policyMode,
  latencyMs,
  shieldedCount,
  onScanQrClick,
  onClearVaultClick,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const modeColors: Record<PolicyActionMode, { bg: string; border: string; text: string; label: string }> = {
    AUTO_TOKENIZE: {
      bg: '#064e3b',
      border: 'rgba(16, 185, 129, 0.4)',
      text: '#34d399',
      label: 'AUTO TOKENIZE',
    },
    STRICT_BLOCK: {
      bg: '#450a0a',
      border: 'rgba(239, 68, 68, 0.4)',
      text: '#f87171',
      label: 'STRICT BLOCK',
    },
    AUDIT_ONLY: {
      bg: '#451a03',
      border: 'rgba(245, 158, 11, 0.4)',
      text: '#fbbf24',
      label: 'AUDIT ONLY',
    },
  };

  const currentMode = modeColors[policyMode] || modeColors.AUTO_TOKENIZE;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        left: '16px',
        zIndex: 2147483646,
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        userSelect: 'none',
      }}
    >
      {/* Expanded Micro-Drawer Panel */}
      {isExpanded && (
        <div
          style={{
            marginBottom: '10px',
            width: '280px',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(51, 65, 85, 0.8)',
            borderRadius: '12px',
            padding: '14px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
            color: '#f8fafc',
            fontSize: '12px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '12px',
              paddingBottom: '8px',
              borderBottom: '1px solid rgba(51, 65, 85, 0.6)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
              <span style={{ color: '#10b981' }}>🛡️</span> ZeroLeak Vault Telemetry
            </div>
            <button
              onClick={() => setIsExpanded(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '14px',
                padding: '2px 6px',
              }}
            >
              ✕
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#94a3b8' }}>Chế độ bảo vệ:</span>
              <span
                style={{
                  backgroundColor: currentMode.bg,
                  color: currentMode.text,
                  border: `1px solid ${currentMode.border}`,
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  fontWeight: 600,
                  fontSize: '10px',
                }}
              >
                {currentMode.label}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#94a3b8' }}>Độ trễ On-Device DLP:</span>
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>
                {latencyMs !== null ? `⚡ ${latencyMs.toFixed(1)} ms` : 'Sẵn sàng'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#94a3b8' }}>Dữ liệu PII bảo vệ:</span>
              <span style={{ color: '#a78bfa', fontWeight: 600 }}>
                {shieldedCount} mục
              </span>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              gap: '6px',
              marginTop: '12px',
              paddingTop: '10px',
              borderTop: '1px solid rgba(51, 65, 85, 0.6)',
            }}
          >
            <button
              onClick={() => {
                setIsExpanded(false);
                onScanQrClick();
              }}
              style={{
                flex: 1,
                padding: '6px 10px',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                color: '#34d399',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              📷 Quét QR
            </button>

            <button
              onClick={onClearVaultClick}
              style={{
                flex: 1,
                padding: '6px 10px',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              🗑️ Xóa Vault
            </button>
          </div>
        </div>
      )}

      {/* Collapsed Pill Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 12px',
          backgroundColor: 'rgba(15, 23, 42, 0.88)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(51, 65, 85, 0.7)',
          borderRadius: '9999px',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)',
          cursor: 'pointer',
          color: '#f8fafc',
          fontSize: '11px',
          fontWeight: 500,
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = '#10b981';
          e.currentTarget.style.boxShadow = '0 0 12px rgba(16, 185, 129, 0.35)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'rgba(51, 65, 85, 0.7)';
          e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.3)';
        }}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#10b981',
            boxShadow: '0 0 8px #10b981',
          }}
        />
        <span style={{ color: '#cbd5e1' }}>ZeroLeak Edge</span>
        {latencyMs !== null && (
          <span style={{ color: '#38bdf8', fontWeight: 600 }}>
            {latencyMs.toFixed(1)}ms
          </span>
        )}
        <span
          style={{
            backgroundColor: currentMode.bg,
            color: currentMode.text,
            padding: '1px 6px',
            borderRadius: '4px',
            fontSize: '9px',
            fontWeight: 700,
          }}
        >
          {policyMode.replace('_', ' ')}
        </span>
        <span style={{ color: '#64748b' }}>{isExpanded ? '▼' : '▲'}</span>
      </button>
    </div>
  );
};
