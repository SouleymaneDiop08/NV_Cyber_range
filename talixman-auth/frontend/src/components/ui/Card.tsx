import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-[var(--radius-lg)] border shadow-[var(--shadow-sm)] ${padded ? 'p-5 sm:p-6' : ''} ${className}`}
      style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-[15px] font-bold" style={{ color: 'var(--text)' }}>
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--text-dim)' }}>
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
