import React from 'react';
import type { TrainState, DataQuality } from '../../types/index.js';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'normal' | 'warning' | 'critical' | 'offline' | 'info' | 'degrade';
  pulse?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

const BADGE_STYLES: Record<NonNullable<BadgeProps['variant']>, string> = {
  normal:   'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-400',
  warning:  'bg-amber-500/20 text-amber-400 border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300',
  critical: 'bg-red-500/20 text-red-400 border-red-500/40 dark:bg-red-500/15 dark:text-red-400',
  degrade:  'bg-orange-500/20 text-orange-400 border-orange-500/40 dark:bg-orange-500/15 dark:text-orange-300',
  offline:  'bg-slate-500/20 text-slate-400 border-slate-500/40 dark:bg-slate-500/15 dark:text-slate-400',
  info:     'bg-sky-500/20 text-sky-400 border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-400',
};

export function Badge({ children, variant = 'info', pulse = false, size = 'md', className = '' }: BadgeProps) {
  const sizeClass = size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-xs font-medium';
  return (
    <span className={`
      inline-flex items-center gap-1 rounded border font-mono
      ${sizeClass} ${BADGE_STYLES[variant]}
      ${pulse ? 'animate-pulse' : ''}
      ${className}
    `}>
      {children}
    </span>
  );
}

// Train state → badge variant
export function trainStateToBadgeVariant(state: TrainState): NonNullable<BadgeProps['variant']> {
  switch (state) {
    case 'marche':   return 'normal';
    case 'arret':    return 'offline';
    case 'degrade':  return 'warning';
    case 'critique': return 'critical';
    case 'offline':  return 'offline';
  }
}

export function qualityToBadgeVariant(q: DataQuality): NonNullable<BadgeProps['variant']> {
  switch (q) {
    case 'ok':      return 'normal';
    case 'stale':   return 'warning';
    case 'offline': return 'offline';
  }
}

// Signal badge
export function SignalBadge({ green }: { green: boolean }) {
  return (
    <span className={`
      inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold font-mono border
      ${green
        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
        : 'bg-red-500/20 text-red-400 border-red-500/40 animate-pulse'
      }
    `}>
      <span className={`w-2 h-2 rounded-full ${green ? 'bg-emerald-400' : 'bg-red-400'}`} />
      {green ? 'VERT' : 'ROUGE'}
    </span>
  );
}
