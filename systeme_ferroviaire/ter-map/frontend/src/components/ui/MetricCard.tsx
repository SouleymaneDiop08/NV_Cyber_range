import React from 'react';

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: string;
  variant?: 'normal' | 'warning' | 'critical' | 'offline';
  sublabel?: string;
  compact?: boolean;
}

const VARIANT_ACCENT: Record<NonNullable<MetricCardProps['variant']>, string> = {
  normal:   'border-l-emerald-500',
  warning:  'border-l-amber-400',
  critical: 'border-l-red-500',
  offline:  'border-l-slate-500',
};

const VARIANT_VALUE: Record<NonNullable<MetricCardProps['variant']>, string> = {
  normal:   'text-emerald-400 dark:text-emerald-300',
  warning:  'text-amber-400 dark:text-amber-300',
  critical: 'text-red-400 dark:text-red-300',
  offline:  'text-slate-400',
};

export function MetricCard({
  label,
  value,
  unit,
  icon,
  variant = 'normal',
  sublabel,
  compact = false,
}: MetricCardProps) {
  return (
    <div className={`
      bg-surface-800/50 dark:bg-surface-850/80
      border border-surface-700/50 dark:border-surface-700/30
      border-l-2 ${VARIANT_ACCENT[variant]}
      rounded-md
      ${compact ? 'p-2' : 'p-3'}
      transition-colors duration-200
    `}>
      <div className="flex items-center justify-between gap-2">
        <span className={`
          text-xs text-slate-500 dark:text-slate-400 font-medium truncate
          ${compact ? '' : 'mb-1'}
        `}>
          {icon && <span className="mr-1">{icon}</span>}
          {label}
        </span>
      </div>
      <div className={`flex items-baseline gap-1 ${compact ? '' : 'mt-0.5'}`}>
        <span className={`
          font-mono font-bold ${VARIANT_VALUE[variant]}
          ${compact ? 'text-sm' : 'text-lg'}
        `}>
          {value}
        </span>
        {unit && (
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
            {unit}
          </span>
        )}
      </div>
      {sublabel && (
        <div className="text-xs text-slate-500 dark:text-slate-500 mt-0.5 truncate">
          {sublabel}
        </div>
      )}
    </div>
  );
}

// Temperature gauge bar
export function TempGauge({
  label,
  value,
  max = 120,
  warnAt = 80,
  critAt = 95,
}: {
  label: string;
  value: number;
  max?: number;
  warnAt?: number;
  critAt?: number;
}) {
  const pct = Math.min(100, (value / max) * 100);
  const isWarn = value >= warnAt;
  const isCrit = value >= critAt;
  const color = isCrit ? '#E74C3C' : isWarn ? '#F5A623' : '#27AE60';

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-xs text-slate-400">{label}</span>
        <span className={`text-xs font-mono font-bold`} style={{ color }}>
          {value}°C
        </span>
      </div>
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}
