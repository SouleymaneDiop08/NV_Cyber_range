export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function SkeletonCardGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Chargement en cours">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-[var(--radius-xl)] border p-6"
          style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
        >
          <div className="mb-4 flex items-start justify-between">
            <Skeleton className="h-11 w-11 rounded-xl" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="mb-2 h-4 w-3/4 rounded" />
          <Skeleton className="mb-1 h-3 w-full rounded" />
          <Skeleton className="mb-4 h-3 w-2/3 rounded" />
          <Skeleton className="h-3 w-1/2 rounded" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonRows({ rows = 4, cols = 3 }: { rows?: number; cols?: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Chargement en cours">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-3 border-b py-3 last:border-b-0" style={{ borderColor: 'var(--border)' }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={`h-3.5 rounded ${c === 0 ? 'w-1/4' : 'flex-1'}`} />
          ))}
        </div>
      ))}
    </div>
  );
}
