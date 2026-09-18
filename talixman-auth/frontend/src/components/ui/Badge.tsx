import type { ReactNode } from 'react';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

const TONE_STYLE: Record<Tone, React.CSSProperties> = {
  neutral: { color: 'var(--text-dim)', background: 'var(--panel2)', borderColor: 'var(--border-strong)' },
  success: { color: 'var(--success)', background: 'var(--success-bg)', borderColor: 'transparent' },
  warning: { color: 'var(--warning)', background: 'var(--warning-bg)', borderColor: 'transparent' },
  danger: { color: 'var(--red)', background: 'var(--danger-bg)', borderColor: 'transparent' },
  info: { color: 'var(--info)', background: 'color-mix(in srgb, var(--info) 14%, transparent)', borderColor: 'transparent' },
  brand: { color: '#fff', background: 'var(--gradient-brand)', borderColor: 'transparent' },
};

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[10.5px] font-bold uppercase tracking-wide ${className}`}
      style={TONE_STYLE[tone]}
    >
      {children}
    </span>
  );
}
