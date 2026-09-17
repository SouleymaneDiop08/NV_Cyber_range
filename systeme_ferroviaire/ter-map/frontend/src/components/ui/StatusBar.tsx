import React from 'react';
import { useTrainStore } from '../../store/useTrainStore.js';
import { ThemeToggle } from './ThemeToggle.js';
import { selectActiveAlarmCount } from '../../store/useTrainStore.js';

const WS_STATUS_CONFIG = {
  connecting:   { dot: 'bg-amber-400 animate-pulse', label: 'Connexion…', color: 'text-amber-400' },
  connected:    { dot: 'bg-emerald-400', label: 'Connecté', color: 'text-emerald-400' },
  reconnecting: { dot: 'bg-amber-400 animate-pulse', label: 'Reconnexion…', color: 'text-amber-400' },
  offline:      { dot: 'bg-red-500 animate-pulse', label: 'Hors ligne', color: 'text-red-400' },
};

export function StatusBar() {
  const { wsStatus, plcOnline, pollLatencyMs, lastPoll, collision } = useTrainStore();
  const activeAlarms = useTrainStore(selectActiveAlarmCount);
  const wsCfg = WS_STATUS_CONFIG[wsStatus];

  const timeStr = lastPoll
    ? new Date(lastPoll).toLocaleTimeString('fr-SN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--:--:--';

  return (
    <header className={`
      h-11 flex items-center justify-between px-4 gap-4
      bg-surface-900 dark:bg-surface-950
      border-b border-surface-700/50
      text-xs font-mono
      flex-shrink-0
      ${collision ? 'border-b-red-500/60' : ''}
      transition-colors duration-300
    `}>
      {/* Left: brand */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-ter-green/20 border border-ter-green/40 flex items-center justify-center">
            <span className="text-ter-green text-xs font-bold">🚄</span>
          </div>
          <span className="font-bold text-sm text-white tracking-wide hidden sm:block">
            TER SÉNÉGAL
          </span>
          <span className="text-slate-600 hidden sm:block">|</span>
          <span className="text-slate-400 text-xs hidden sm:block">
            Dakar ↔ Diamniadio
          </span>
        </div>

        {/* Collision warning */}
        {collision && (
          <div className={`
            flex items-center gap-1.5 px-2 py-0.5 rounded
            ${collision.risk === 'danger'
              ? 'bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse'
              : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
            }
          `}>
            {collision.risk === 'danger' ? '🚨' : '⚠️'}
            <span className="font-bold">
              {collision.risk === 'danger' ? 'COLLISION IMMINENTE' : 'RAPPROCHEMENT'}
            </span>
            <span className="opacity-75">
              {collision.distance_km.toFixed(1)} km
            </span>
          </div>
        )}
      </div>

      {/* Center: time + PLC status */}
      <div className="flex items-center gap-4 text-slate-400">
        <span className="text-slate-300 font-bold tabular-nums">{timeStr}</span>
        <span className="hidden md:flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${plcOnline ? 'bg-emerald-400' : 'bg-red-500 animate-pulse'}`} />
          PLC-B {plcOnline ? 'OK' : 'OFFLINE'}
        </span>
        {pollLatencyMs >= 0 && (
          <span className="hidden md:block text-slate-600">
            {pollLatencyMs}ms
          </span>
        )}
      </div>

      {/* Right: WS + alarms + theme */}
      <div className="flex items-center gap-3">
        {activeAlarms > 0 && (
          <span className={`
            flex items-center gap-1 px-2 py-0.5 rounded border font-bold
            ${activeAlarms > 0
              ? 'bg-red-500/20 text-red-400 border-red-500/40'
              : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
            }
          `}>
            🔔 {activeAlarms}
          </span>
        )}

        <span className={`flex items-center gap-1.5 ${wsCfg.color}`}>
          <span className={`w-2 h-2 rounded-full ${wsCfg.dot}`} />
          <span className="hidden sm:block">{wsCfg.label}</span>
        </span>

        <ThemeToggle />
      </div>
    </header>
  );
}
