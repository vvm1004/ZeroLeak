import React, { useEffect, useState } from 'react';

export interface ToastMessage {
  id: string;
  type: 'TOKENIZED' | 'BLOCKED' | 'AUDIT';
  title: string;
  detail: string;
  latencyMs?: number;
  matchCount?: number;
}

interface NotificationToastProps {
  message: ToastMessage | null;
  onDismiss: () => void;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({ message, onDismiss }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (message) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        setTimeout(onDismiss, 300);
      }, 4000);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [message, onDismiss]);

  if (!message && !visible) return null;

  const isBlocked = message?.type === 'BLOCKED';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 2147483647,
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.95)',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '14px 18px',
          borderRadius: '14px',
          backgroundColor: isBlocked ? '#1e1014' : '#071815',
          border: `1px solid ${isBlocked ? 'rgba(239, 68, 68, 0.35)' : 'rgba(16, 185, 129, 0.35)'}`,
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4)',
          color: '#f8fafc',
          minWidth: '320px',
          maxWidth: '440px',
        }}
      >
        <div
          style={{
            fontSize: '22px',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {isBlocked ? '🛡️⛔' : '🛡️✨'}
        </div>

        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 700,
              color: isBlocked ? '#f87171' : '#34d399',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '2px',
            }}
          >
            <span>{message?.title}</span>
            {message?.latencyMs !== undefined && (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  color: '#94a3b8',
                }}
              >
                {message.latencyMs} ms
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: '12px',
              color: '#cbd5e1',
              lineHeight: 1.4,
            }}
          >
            {message?.detail}
          </div>
        </div>

        <button
          onClick={() => {
            setVisible(false);
            setTimeout(onDismiss, 200);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '4px',
            borderRadius: '4px',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
};
