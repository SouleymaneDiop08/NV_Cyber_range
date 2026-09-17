import React from 'react';
import { useTrainStore } from '../../store/useTrainStore.js';
import { Badge, trainStateToBadgeVariant, SignalBadge } from '../ui/Badge.js';
import { MetricCard, TempGauge } from '../ui/MetricCard.js';
import { AlarmLog } from '../ui/AlarmLog.js';
import { nearestStation, plcPosToLatLon, formatDistance } from '../../utils/geo.js';
import { STATIONS } from '../../constants/stations.js';

// ── Selected train detail ─────────────────────────────────────
function SelectedTrainDetail() {
  const { selectedTrainId, trains, collision } = useTrainStore();
  const train = trains.find(t => t.train_id === selectedTrainId);

  if (!train) return null;

  const station = nearestStation(train.progression_norm);
  const stateVariant = trainStateToBadgeVariant(train.etat_train);
  const km = (train.progression_norm * 36.0).toFixed(2);

  // Next/prev station
  const sortedByPk = [...STATIONS].sort((a, b) => a.pk_km - b.pk_km);
  const currentKm = train.progression_norm * 36.0;
  const nextStation = sortedByPk.find(s => s.pk_km > currentKm);
  const distToNext = nextStation ? ((nextStation.pk_km - currentKm)).toFixed(1) : null;

  return (
    <div className="space-y-3">
      {/* Train header */}
      <div
        className="rounded-lg p-3 border"
        style={{
          background: `${train.color}15`,
          borderColor: `${train.color}40`,
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm" style={{ background: train.color }} />
            <span className="font-bold text-white font-mono text-sm">{train.label}</span>
          </div>
          <Badge variant={stateVariant}>{train.etat_train.toUpperCase()}</Badge>
        </div>
        <div className="text-xs text-slate-400">{train.direction}</div>
      </div>

      {/* Speed + position */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard
          label="Vitesse"
          value={train.vitesse_kmh}
          unit="km/h"
          icon="🚀"
          variant={train.etat_train === 'critique' ? 'critical' : 'normal'}
        />
        <MetricCard
          label="Position"
          value={km}
          unit="km"
          icon="📍"
          sublabel={`PLC: ${train.progression_plc}`}
        />
      </div>

      {/* Signal + catenary */}
      <div className="bg-surface-800/50 border border-surface-700/40 rounded-lg p-3 space-y-2">
        <div className="text-xs font-mono text-slate-500 uppercase tracking-wider">Signalisation</div>
        <div className="flex items-center justify-between">
          <SignalBadge green={train.signal_vert} />
          <span className="text-xs text-slate-400 font-mono">
            Caténaire: {train.catenaire_ok ? '✓ OK' : '✗ KO'}
          </span>
        </div>
      </div>

      {/* Power */}
      <div className="bg-surface-800/50 border border-surface-700/40 rounded-lg p-3 space-y-2">
        <div className="text-xs font-mono text-slate-500 uppercase tracking-wider">Traction</div>
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="Caténaire" value={train.tension_kv.toFixed(1)} unit="kV" compact />
          <MetricCard
            label="Courant"
            value={train.courant_a}
            unit="A"
            compact
            variant={train.alm_surcharge ? 'warning' : 'normal'}
          />
        </div>
        <TempGauge
          label="Transformateur de traction"
          value={train.temp_transfo_c}
          max={125}
          warnAt={85}
          critAt={110}
        />
      </div>

      {/* Station info */}
      <div className="bg-surface-800/50 border border-surface-700/40 rounded-lg p-3 space-y-1">
        <div className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-2">
          Localisation
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-300 font-medium">{station.name}</span>
          <span className="text-xs text-slate-600">pk {station.pk_km} km</span>
        </div>
        {nextStation && (
          <div className="text-xs text-slate-400 flex items-center gap-1">
            <span>→</span>
            <span>{nextStation.name}</span>
            <span className="text-slate-600">({distToNext} km)</span>
          </div>
        )}
      </div>

      {/* SIV / passenger information integrity */}
      <div className={`
        rounded-lg p-3 border space-y-2
        ${train.siv.actif
          ? 'bg-red-500/15 border-red-500/40'
          : 'bg-surface-800/50 border-surface-700/40'
        }
      `}>
        <div className={`text-xs font-mono uppercase tracking-wider ${
          train.siv.actif ? 'text-red-300' : 'text-slate-500'
        }`}>
          Information voyageurs
        </div>
        {train.siv.actif ? (
          <div className="space-y-1 text-xs text-red-100">
            <div className="font-bold text-red-300">Désynchronisation SIV détectée</div>
            <div>Position annoncée: <b>{train.siv.zone_annoncee}</b></div>
            <div>Retard affiché: <b>{train.siv.retard_annonce_min} min</b></div>
            <div>Écart avec le train réel: <b>{train.siv.ecart_position}</b> unités PLC</div>
            <div className="text-slate-300 pt-1">{train.siv.message}</div>
          </div>
        ) : (
          <div className="text-xs text-emerald-400 font-mono">
            SIV cohérent avec la position réelle du train.
          </div>
        )}
      </div>

      {/* Collision info if applicable */}
      {collision && collision.risk !== 'none' && (
        <div className={`
          rounded-lg p-3 border font-mono text-xs space-y-1
          ${collision.risk === 'danger'
            ? 'bg-red-500/15 border-red-500/40 text-red-300'
            : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
          }
        `}>
          <div className="font-bold">
            {collision.risk === 'danger' ? '🚨 RISQUE COLLISION' : '⚠️ RAPPROCHEMENT'}
          </div>
          <div className="grid grid-cols-2 gap-x-4 text-xs">
            <span className="opacity-75">Distance</span>
            <span className="font-bold">{formatDistance(collision.distance_km)}</span>
            <span className="opacity-75">Vit. relative</span>
            <span className="font-bold">{Math.round(collision.relative_speed_kmh)} km/h</span>
            {collision.ttc_s !== null && (
              <>
                <span className="opacity-75">TTC</span>
                <span className="font-bold">{Math.round(collision.ttc_s)}s</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Alarms */}
      {train.alarmes_actives.length > 0 && (
        <div className="bg-surface-800/50 border border-red-500/30 rounded-lg p-3">
          <div className="text-xs font-mono text-red-400 uppercase tracking-wider mb-2">
            ⚠ Alarmes actives ({train.alarmes_actives.length})
          </div>
          <div className="space-y-1">
            {train.alarmes_actives.map((alm, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-red-300">
                <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse flex-shrink-0" />
                {alm}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data quality */}
      <div className="text-xs font-mono text-slate-600 text-right">
        MAJ: {new Date(train.updated_at).toLocaleTimeString('fr-SN')}
        {' · '}
        <span className={
          train.qualite_donnee === 'ok' ? 'text-emerald-500' :
          train.qualite_donnee === 'stale' ? 'text-amber-500' :
          'text-red-500'
        }>
          {train.qualite_donnee.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

// ── System events ─────────────────────────────────────────────
function SystemEvents() {
  return (
    <div className="space-y-2">
      <div className="text-xs font-mono text-slate-500 uppercase tracking-wider">
        Événements récents
      </div>
      <AlarmLog maxItems={20} showCleared />
    </div>
  );
}

// ── Main RightPanel ───────────────────────────────────────────
export function RightPanel() {
  const { rightPanelOpen, setRightPanelOpen, selectedTrainId, mapFocusMode } = useTrainStore();

  if (mapFocusMode) return null;

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setRightPanelOpen(!rightPanelOpen)}
        className={`
          absolute right-0 top-1/2 -translate-y-1/2 z-[1000]
          w-5 h-16 flex items-center justify-center
          bg-surface-800 border border-surface-700/60 rounded-l-md
          text-slate-400 hover:text-slate-200 hover:bg-surface-700
          transition-all duration-200
          ${rightPanelOpen ? 'opacity-0 pointer-events-none' : ''}
        `}
        aria-label="Ouvrir panneau droit"
      >
        ‹
      </button>

      <aside className={`
        w-72 xl:w-80 flex-shrink-0 flex flex-col
        bg-surface-900/95 dark:bg-surface-950/95
        backdrop-blur-sm
        border-l border-surface-700/50
        transition-all duration-250 ease-out
        overflow-hidden
        ${rightPanelOpen ? 'w-72 xl:w-80' : 'w-0'}
        animate-slide-in-right
      `}>
        {rightPanelOpen && (
          <div className="flex flex-col h-full min-w-72 xl:min-w-80">
            {/* Panel header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700/40 flex-shrink-0">
              <span className="text-xs font-bold text-slate-300 font-mono tracking-widest uppercase">
                {selectedTrainId ? `Détail Train ${selectedTrainId}` : 'Événements'}
              </span>
              <button
                onClick={() => setRightPanelOpen(false)}
                className="text-slate-600 hover:text-slate-300 transition-colors text-lg leading-none"
                aria-label="Fermer"
              >
                ›
              </button>
            </div>

            {/* Tab selector */}
            <div className="flex border-b border-surface-700/40 flex-shrink-0">
              {selectedTrainId && (
                <button
                  className="flex-1 py-2 text-xs font-mono text-emerald-400 border-b-2 border-emerald-400 bg-emerald-400/5"
                >
                  Train {selectedTrainId}
                </button>
              )}
              <button
                className={`flex-1 py-2 text-xs font-mono transition-colors
                  ${!selectedTrainId ? 'text-slate-300 border-b-2 border-slate-300' : 'text-slate-500 hover:text-slate-300'}
                `}
              >
                Événements
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-slate-700">
              {selectedTrainId ? (
                <SelectedTrainDetail />
              ) : (
                <SystemEvents />
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
