import React from 'react';
import { useTrainStore } from '../../store/useTrainStore.js';
import type { AlarmEvent } from '../../types/index.js';

const SEVERITY_CONFIG = {
  critical: { dot: 'bg-red-500', text: 'text-red-400', label: 'CRIT', border: 'border-red-500/40' },
  warning:  { dot: 'bg-amber-400', text: 'text-amber-400', label: 'WARN', border: 'border-amber-400/40' },
  info:     { dot: 'bg-sky-400', text: 'text-sky-400', label: 'INFO', border: 'border-sky-400/40' },
};

interface AlarmRowProps {
  alarm: AlarmEvent;
  onDismiss: (id: string) => void;
}

function AlarmRow({ alarm, onDismiss }: AlarmRowProps) {
  const cfg = SEVERITY_CONFIG[alarm.severity];
  const time = new Date(alarm.timestamp).toLocaleTimeString('fr-SN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div className={`
      flex items-start gap-2 py-2 px-2 rounded text-xs
      border-l-2 ${cfg.border}
      ${alarm.cleared ? 'opacity-40' : 'bg-surface-800/30'}
      transition-opacity duration-300
    `}>
      <span className={`mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full ${alarm.cleared ? 'bg-slate-500' : cfg.dot} ${!alarm.cleared && alarm.severity === 'critical' ? 'animate-pulse' : ''}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`font-mono text-xs font-bold ${cfg.text}`}>{cfg.label}</span>
          <span className="text-slate-500 font-mono text-xs">{alarm.train_id}</span>
          <span className="text-slate-600 font-mono text-xs ml-auto">{time}</span>
        </div>
        <div className="text-slate-300 dark:text-slate-300 truncate">
          {alarm.message}
        </div>
      </div>
      {!alarm.cleared && (
        <button
          onClick={() => onDismiss(alarm.id)}
          className="text-slate-600 hover:text-slate-400 flex-shrink-0 mt-0.5 transition-colors"
          title="Acquitter"
        >
          ×
        </button>
      )}
    </div>
  );
}

interface AlarmLogProps {
  maxItems?: number;
  showCleared?: boolean;
}

export function AlarmLog({ maxItems = 20, showCleared = false }: AlarmLogProps) {
  const { alarms, dismissAlarm } = useTrainStore();

  const visible = alarms
    .filter(a => showCleared || !a.cleared)
    .slice(0, maxItems);

  if (visible.length === 0) {
    return (
      <div className="text-center py-4 text-slate-500 text-xs font-mono">
        Aucune alarme active
      </div>
    );
  }

  return (
    <div className="space-y-0.5 max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
      {visible.map(alarm => (
        <AlarmRow key={alarm.id} alarm={alarm} onDismiss={dismissAlarm} />
      ))}
    </div>
  );
}
