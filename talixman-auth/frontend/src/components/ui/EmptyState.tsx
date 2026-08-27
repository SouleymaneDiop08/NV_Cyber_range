import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-dashed px-6 py-12 text-center" style={{ borderColor: 'var(--border-strong)' }}>
      {icon && (
        <div
          className="mb-1 flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: 'var(--panel2)', color: 'var(--text-faint)' }}
        >
          {icon}
        </div>
      )}
      <p className="text-[13.5px] font-semibold" style={{ color: 'var(--text)' }}>
        {title}
      </p>
      {description && (
        <p className="max-w-[320px] text-[12.5px]" style={{ color: 'var(--text-dim)' }}>
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
