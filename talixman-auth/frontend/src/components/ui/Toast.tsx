import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { IconButton } from './Button';

type ToastTone = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
}

interface ToastContextValue {
  toast: (tone: ToastTone, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_META: Record<ToastTone, { icon: typeof Info; color: string }> = {
  success: { icon: CheckCircle2, color: 'var(--success)' },
  error: { icon: XCircle, color: 'var(--red)' },
  warning: { icon: AlertTriangle, color: 'var(--warning)' },
  info: { icon: Info, color: 'var(--info)' },
};

const AUTO_DISMISS_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (tone: ToastTone, message: string) => {
      const id = `t${++counter.current}`;
      setItems((prev) => [...prev, { id, tone, message }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {createPortal(
        <div
          className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:right-4 sm:left-auto"
          aria-live="polite"
          aria-atomic="false"
        >
          {items.map((item) => {
            const meta = TONE_META[item.tone];
            const Icon = meta.icon;
            return (
              <div
                key={item.id}
                role={item.tone === 'error' ? 'alert' : 'status'}
                className="animate-toast-in pointer-events-auto flex w-full max-w-[380px] items-start gap-3 rounded-[var(--radius-lg)] border p-3.5 pr-2"
                style={{ borderColor: 'var(--border-strong)', background: 'var(--panel)', boxShadow: 'var(--shadow-lg)' }}
              >
                <Icon size={18} className="mt-0.5 shrink-0" style={{ color: meta.color }} aria-hidden="true" />
                <p className="flex-1 text-[13px] leading-snug" style={{ color: 'var(--text)' }}>
                  {item.message}
                </p>
                <IconButton aria-label="Fermer la notification" size="sm" onClick={() => dismiss(item.id)}>
                  <X size={14} />
                </IconButton>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast doit être utilisé sous ToastProvider.');
  return ctx.toast;
}
