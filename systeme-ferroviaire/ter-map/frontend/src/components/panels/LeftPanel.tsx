import React, { useState } from 'react';
import { useTrainStore, selectActiveAlarmCount } from '../../store/useTrainStore.js';
import { Badge, trainStateToBadgeVariant, SignalBadge } from '../ui/Badge.js';
import { MetricCard, TempGauge } from '../ui/MetricCard.js';
import { AlarmLog } from '../ui/AlarmLog.js';
import { plcPosToLatLon, nearestStation } from '../../utils/geo.js';
import type { TrainData } from '../../types/index.js';

// ── Individual train panel ────────────────────────────────────
function TrainPanel({ train }: { train: TrainData }) {
  const { selectTrain, selectedTrainId, trainDirections } = useTrainStore();
  const isSelected = selectedTrainId === train.train_id;
  const station = nearestStation(train.progression_norm);
  const stateVariant = trainStateToBadgeVariant(train.etat_train);
  const direction = trainDirections[train.train_id] ?? 1;
  const dirLabel = direction >= 0 ? '→ Diamniadio' : '← Dakar';

  const kmPos = (train.progression_norm * 36.0).toFixed(1);
  const isCritique = train.etat_train === 'critique';
  const isDegrade  = train.etat_train === 'degrade';
  const hasAlarms  = train.alarmes_actives.length > 0;

  // Energy / alimentation indicators
  const energieOK = train.catenaire_ok && !train.alm_tension_basse;
  const alimentRail = train.tension_kv.toFixed(1) + ' kV';

  return (
    <div
      className={`rounded-lg border cursor-pointer transition-all duration-200 overflow-hidden
        ${isSelected ? 'ring-1' : 'hover:border-surface-600/70'}
        ${isCritique ? 'border-red-500/60' : isDegrade ? 'border-amber-500/40' : 'border-surface-700/50'}
      `}
      style={isSelected ? { borderColor: train.color, boxShadow: `0 0 0 1px ${train.color}` } : {}}
      onClick={() => selectTrain(isSelected ? null : train.train_id)}
    >
      {/* ── Bannière alarme critique (rouge vif) ── */}
      {isCritique && (
        <div className="bg-red-600/90 text-white text-sm font-mono font-bold text-center py-1 animate-pulse tracking-wider">
          ⚠ ALARME CRITIQUE — {train.train_id}
        </div>
      )}
      {isDegrade && !isCritique && (
        <div className="bg-amber-600/80 text-white text-sm font-mono font-bold text-center py-0.5 tracking-wider">
          ⚠ MODE DÉGRADÉ
        </div>
      )}

      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: `${train.color}20`, borderBottom: `1px solid ${train.color}35` }}
      >
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: train.color }} />
          <span className="font-bold text-base text-white font-mono">{train.train_id}</span>
          <span className="text-slate-300 text-sm font-mono font-bold">{dirLabel}</span>
        </div>
        <Badge variant={stateVariant} size="sm">{train.etat_train.toUpperCase()}</Badge>
      </div>

      {/* Station courante + mode dégradé — très visible */}
      <div className="px-3 pt-2 flex items-center justify-between">
        <span className="text-base font-bold text-slate-200 font-mono">{station.name}</span>
        {train.mode_degrade && (
          <span className="text-xs font-mono bg-amber-900/40 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded">
            DÉGRADÉ
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-2">
        {/* Métriques principales */}
        <div className="grid grid-cols-3 gap-1.5">
          <MetricCard
            label="Vitesse"
            value={train.vitesse_kmh}
            unit="km/h"
            variant={isCritique ? 'critical' : isDegrade ? 'warning' : 'normal'}
            compact
          />
          <MetricCard label="Position" value={kmPos} unit="km" compact />
          <MetricCard
            label="Transfo"
            value={train.temp_transfo_c}
            unit="°C"
            variant={train.temp_transfo_c >= 85 ? 'warning' : 'normal'}
            compact
          />
        </div>

        {/* Courant — valeur proéminente */}
        <div className="flex items-center justify-between bg-surface-800/50 rounded px-2 py-1.5">
          <span className="text-xs font-bold text-slate-400 font-mono uppercase">Courant</span>
          <span className={`text-base font-bold font-mono ${train.courant_a > 700 ? 'text-amber-400' : 'text-slate-100'}`}>
            {train.courant_a} <span className="text-sm text-slate-400">A</span>
          </span>
        </div>

        {/* Énergie / Alimentation Rail */}
        <div className="flex items-center justify-between text-sm font-mono">
          <span className="text-xs font-bold text-slate-400 uppercase">Énergie</span>
          <span className={`flex items-center gap-1.5 ${energieOK ? 'text-emerald-400' : 'text-red-400 font-bold'}`}>
            <span className={`w-2 h-2 rounded-full ${energieOK ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`} />
            {energieOK ? 'OK' : 'ALARME'}
          </span>
          <span className={`${train.catenaire_ok ? 'text-slate-300' : 'text-red-400 font-bold'}`}>
            {alimentRail}
          </span>
        </div>

        {/* Signal + état_train lisible */}
        <div className="flex items-center justify-between text-sm font-mono">
          <SignalBadge green={train.signal_vert} />
          <span className={`text-sm font-bold ${
            train.etat_train === 'marche' ? 'text-emerald-400'
            : train.etat_train === 'critique' ? 'text-red-400'
            : train.etat_train === 'degrade' ? 'text-amber-400'
            : 'text-slate-400'
          }`}>
            {train.etat_train.toUpperCase()}
          </span>
          <span className="text-slate-400 text-sm">{station.shortName}</span>
        </div>

        {/* Information voyageurs / SIV */}
        {train.siv.actif && (
          <div className="rounded border px-2 py-1.5 space-y-1 bg-red-950/50 border-red-500/60">
            <div className="text-sm font-mono font-bold text-red-300 animate-pulse">
              SIV ≠ POSITION RÉELLE
            </div>
            <div className="text-xs text-red-100/90 font-mono leading-5">
              Annonce: {train.siv.zone_annoncee} · retard {train.siv.retard_annonce_min} min
            </div>
            <div className="text-xs text-slate-300 font-mono">
              Écart détecté: {train.siv.ecart_position} unités PLC
            </div>
          </div>
        )}

        {/* ── Bloc alarmes — très visible quand actives ── */}
        {hasAlarms && (
          <div className={`rounded border px-2 py-1.5 space-y-1
            ${isCritique
              ? 'bg-red-900/40 border-red-500/50'
              : 'bg-amber-900/30 border-amber-500/40'
            }`}
          >
            <div className={`text-sm font-mono font-bold mb-0.5 ${isCritique ? 'text-red-400' : 'text-amber-400'}`}>
              {train.alarmes_actives.length} ALARME{train.alarmes_actives.length > 1 ? 'S' : ''} ACTIVE{train.alarmes_actives.length > 1 ? 'S' : ''}
            </div>
            {train.alarmes_actives.map((alm, i) => (
              <div key={i} className={`flex items-center gap-2 text-sm font-mono
                ${isCritique ? 'text-red-300' : 'text-amber-300'}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse
                  ${isCritique ? 'bg-red-400' : 'bg-amber-400'}`}
                />
                {alm}
              </div>
            ))}
          </div>
        )}

        {/* Qualité données */}
        {train.qualite_donnee !== 'ok' && (
          <div className={`text-sm font-mono px-2 py-1 rounded text-center font-bold ${
            train.qualite_donnee === 'offline'
              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
              : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
          }`}>
            ⚠ DONNÉES {train.qualite_donnee === 'offline' ? 'HORS LIGNE' : 'EXPIRÉES'}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Energy panel ──────────────────────────────────────────────
function EnergyPanel() {
  const energy = useTrainStore(s => s.energy);
  if (!energy) return null;

  const hasAlarm = energy.alm_tx2_temp_crit || energy.alm_tx2_temp_high ||
                   energy.alm_fdr2_surcharge || energy.alm_fdr2_desequilibre;

  return (
    <div className={`
      rounded-lg border border-surface-700/50 overflow-hidden
      ${hasAlarm ? 'border-amber-500/40' : ''}
    `}>
      <div className="flex items-center justify-between px-3 py-2 bg-surface-800/60 border-b border-surface-700/40">
        <span className="text-sm font-bold text-slate-300 font-mono tracking-wide">
          ⚡ ÉNERGIE — STATION B
        </span>
        {hasAlarm && <span className="text-amber-400 text-sm animate-pulse">⚠ ALARME</span>}
      </div>
      <div className="p-3 space-y-2">
        <TempGauge label="TX2 Huile" value={energy.tx2_oil_temp_c} warnAt={80} critAt={95} />
        <TempGauge label="TX2 Bobinage" value={energy.tx2_winding_temp_c} warnAt={95} critAt={120} />

        <div className="grid grid-cols-2 gap-1.5 text-sm mt-1">
          {[
            { label: 'Feeder 2 Surcharge', val: energy.alm_fdr2_surcharge },
            { label: 'Feeder 2 Déséquilibre', val: energy.alm_fdr2_desequilibre },
            { label: 'TX2 Temp High', val: energy.alm_tx2_temp_high },
            { label: 'TX2 Temp Crit', val: energy.alm_tx2_temp_crit },
          ].map(({ label, val }) => (
            <div key={label} className={`
              flex items-center gap-1.5 px-2 py-1 rounded font-mono
              ${val
                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                : 'bg-surface-800/30 text-slate-600'
              }
            `}>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${val ? 'bg-red-400 animate-pulse' : 'bg-slate-600'}`} />
              <span className="truncate text-xs">{label}</span>
            </div>
          ))}
        </div>

        <div className="flex justify-between items-center text-sm text-slate-500 font-mono">
          <span>Qualité: <span className={energy.qualite_donnee === 'ok' ? 'text-emerald-400' : 'text-amber-400'}>
            {energy.qualite_donnee.toUpperCase()}
          </span></span>
          <span>{new Date(energy.updated_at).toLocaleTimeString('fr-SN')}</span>
        </div>
      </div>
    </div>
  );
}

// ── CTC panel ─────────────────────────────────────────────────
function CtcPanel() {
  const ctc = useTrainStore(s => s.ctc);
  if (!ctc) return null;

  const active = ctc.aiguille_deviee || ctc.alm_aiguille || ctc.alm_collision;
  const collision = ctc.alm_collision;
  const risk = Math.round(ctc.risk_level);

  return (
    <div className={`
      rounded-lg border overflow-hidden
      ${collision
        ? 'border-red-500/70 bg-red-950/20'
        : active
          ? 'border-amber-500/60 bg-amber-950/10'
          : 'border-surface-700/50'}
    `}>
      <div className={`flex items-center justify-between px-3 py-2 border-b
        ${collision
          ? 'bg-red-900/60 border-red-500/30'
          : active
            ? 'bg-amber-900/40 border-amber-500/20'
            : 'bg-surface-800/60 border-surface-700/40'}
      `}>
        <span className="text-sm font-bold text-slate-200 font-mono tracking-wide">
          CTC — AIGUILLAGE
        </span>
        <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border
          ${collision
            ? 'bg-red-500/25 text-red-200 border-red-400/40 animate-pulse'
            : active
              ? 'bg-amber-500/20 text-amber-200 border-amber-400/40'
              : 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'}
        `}>
          {collision ? 'COLLISION' : active ? 'DÉVIÉ' : 'NORMAL'}
        </span>
      </div>

      <div className="p-3 space-y-2 font-mono text-sm">
        <div className="grid grid-cols-2 gap-1.5">
          <MetricCard
            label="Distance"
            value={ctc.distance_km.toFixed(1)}
            unit="km"
            variant={collision ? 'critical' : active ? 'warning' : 'normal'}
            compact
          />
          <MetricCard
            label="Risque"
            value={risk}
            unit="%"
            variant={collision ? 'critical' : risk >= 60 ? 'warning' : 'normal'}
            compact
          />
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-xs">
          {[
            { label: 'Aiguille déviée', val: ctc.aiguille_deviee },
            { label: 'Alarme aiguille', val: ctc.alm_aiguille },
            { label: 'Collision', val: ctc.alm_collision },
            { label: 'Point impact', val: ctc.collision_position_plc > 0, text: ctc.collision_position_plc > 0 ? String(ctc.collision_position_plc) : '—' },
          ].map(({ label, val, text }) => (
            <div key={label} className={`
              flex items-center justify-between gap-1.5 px-2 py-1 rounded
              ${val
                ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                : 'bg-surface-800/30 text-slate-500 border border-transparent'}
            `}>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${val ? 'bg-red-400 animate-pulse' : 'bg-slate-600'}`} />
              <span className="truncate flex-1">{label}</span>
              <span className="font-bold">{text ?? (val ? 'ON' : 'OFF')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Setpoint Panel ────────────────────────────────────────────
// Allows writing speed limits and emergency stops to the PLC.
function SetpointPanel() {
  const [dkrVitMax, setDkrVitMax] = useState<string>('160');
  const [dmdVitMax, setDmdVitMax] = useState<string>('160');
  const [dkrArrUrgence, setDkrArrUrgence] = useState(false);
  const [dmdArrUrgence, setDmdArrUrgence] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function sendSetpoint(register: string, value: number) {
    try {
      const resp = await fetch('/api/setpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ register, value }),
      });
      const data = await resp.json() as { ok?: boolean; error?: string };
      if (!resp.ok || !data.ok) {
        setIsError(true);
        setStatus(data.error ?? 'Erreur inconnue');
      } else {
        setIsError(false);
        setStatus(`${register} ← ${value} OK`);
        setTimeout(() => setStatus(null), 2500);
      }
    } catch {
      setIsError(true);
      setStatus('Erreur réseau');
    }
  }

  async function toggleUrgence(train: 'dkr' | 'dmd', current: boolean) {
    const next = !current;
    const register = train === 'dkr' ? 'dkr_arret_urgence' : 'dmd_arret_urgence';
    await sendSetpoint(register, next ? 1 : 0);
    if (train === 'dkr') setDkrArrUrgence(next);
    else setDmdArrUrgence(next);
  }

  return (
    <div className="rounded-lg border border-surface-700/50 overflow-hidden">
      <div className="px-3 py-2 bg-surface-800/60 border-b border-surface-700/40">
        <span className="text-sm font-bold text-slate-300 font-mono tracking-wide">
          ⚙ CONSIGNES PLC
        </span>
      </div>
      <div className="p-3 space-y-3">
        {/* DKR setpoints */}
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-slate-400 font-mono uppercase tracking-wider">
            DKR — Dakar
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-mono text-slate-400 w-20 flex-shrink-0">Vit.Max (km/h)</label>
            <input
              type="number"
              min={0}
              max={160}
              value={dkrVitMax}
              onChange={e => setDkrVitMax(e.target.value)}
              className="w-20 bg-surface-900 border border-surface-600 rounded px-2 py-0.5 text-sm font-mono text-slate-100 focus:outline-none focus:border-slate-400"
            />
            <button
              onClick={() => sendSetpoint('dkr_vitesse_max', Number(dkrVitMax))}
              className="text-xs font-mono px-2 py-1 rounded bg-surface-700 hover:bg-surface-600 text-slate-200 border border-surface-600 transition-colors"
            >
              Envoyer
            </button>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-mono text-slate-400 w-20 flex-shrink-0">Arr. Urgence</label>
            <button
              onClick={() => toggleUrgence('dkr', dkrArrUrgence)}
              className={`px-3 py-1 rounded text-sm font-mono font-bold border transition-colors ${
                dkrArrUrgence
                  ? 'bg-red-600 border-red-500 text-white animate-pulse'
                  : 'bg-surface-700 border-surface-600 text-slate-300 hover:bg-surface-600'
              }`}
            >
              {dkrArrUrgence ? '⛔ ACTIF' : 'OFF'}
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-surface-700/40" />

        {/* DMD setpoints */}
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-slate-400 font-mono uppercase tracking-wider">
            DMD — Diamniadio
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-mono text-slate-400 w-20 flex-shrink-0">Vit.Max (km/h)</label>
            <input
              type="number"
              min={0}
              max={160}
              value={dmdVitMax}
              onChange={e => setDmdVitMax(e.target.value)}
              className="w-20 bg-surface-900 border border-surface-600 rounded px-2 py-0.5 text-sm font-mono text-slate-100 focus:outline-none focus:border-slate-400"
            />
            <button
              onClick={() => sendSetpoint('dmd_vitesse_max', Number(dmdVitMax))}
              className="text-xs font-mono px-2 py-1 rounded bg-surface-700 hover:bg-surface-600 text-slate-200 border border-surface-600 transition-colors"
            >
              Envoyer
            </button>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-mono text-slate-400 w-20 flex-shrink-0">Arr. Urgence</label>
            <button
              onClick={() => toggleUrgence('dmd', dmdArrUrgence)}
              className={`px-3 py-1 rounded text-sm font-mono font-bold border transition-colors ${
                dmdArrUrgence
                  ? 'bg-red-600 border-red-500 text-white animate-pulse'
                  : 'bg-surface-700 border-surface-600 text-slate-300 hover:bg-surface-600'
              }`}
            >
              {dmdArrUrgence ? '⛔ ACTIF' : 'OFF'}
            </button>
          </div>
        </div>

        {/* Status feedback */}
        {status && (
          <div className={`text-xs font-mono px-2 py-1 rounded text-center font-bold ${
            isError
              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
              : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
          }`}>
            {isError ? '⚠ ' : '✓ '}{status}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main LeftPanel ────────────────────────────────────────────
export function LeftPanel() {
  const { leftPanelOpen, setLeftPanelOpen, trains, mapFocusMode } = useTrainStore();
  const activeAlarms = useTrainStore(selectActiveAlarmCount);

  if (mapFocusMode) return null;

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setLeftPanelOpen(!leftPanelOpen)}
        className={`
          absolute left-0 top-1/2 -translate-y-1/2 z-[1000]
          w-5 h-16 flex items-center justify-center
          bg-surface-800 border border-surface-700/60 rounded-r-md
          text-slate-400 hover:text-slate-200 hover:bg-surface-700
          transition-all duration-200
          ${leftPanelOpen ? 'opacity-0 pointer-events-none' : ''}
        `}
        aria-label="Ouvrir panneau gauche"
      >
        ›
      </button>

      <aside className={`
        w-72 xl:w-80 flex-shrink-0 flex flex-col
        bg-surface-900/95 dark:bg-surface-950/95
        backdrop-blur-sm
        border-r border-surface-700/50
        transition-all duration-250 ease-out
        overflow-hidden
        ${leftPanelOpen ? 'w-72 xl:w-80' : 'w-0'}
        animate-slide-in-left
      `}>
        {leftPanelOpen && (
          <div className="flex flex-col h-full min-w-72 xl:min-w-80">
            {/* Panel header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700/40 flex-shrink-0">
              <span className="text-sm font-bold text-slate-300 font-mono tracking-widest uppercase">
                Supervision
              </span>
              <button
                onClick={() => setLeftPanelOpen(false)}
                className="text-slate-600 hover:text-slate-300 transition-colors text-lg leading-none"
                aria-label="Fermer"
              >
                ‹
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-2 space-y-3 scrollbar-thin scrollbar-thumb-slate-700">
              {/* Trains — at top, most prominent */}
              <section>
                <div className="text-sm font-bold font-mono text-slate-400 uppercase tracking-wider px-1 mb-1.5">
                  Trains actifs
                </div>
                <div className="space-y-2">
                  {trains.map(train => (
                    <TrainPanel key={train.train_id} train={train} />
                  ))}
                </div>
              </section>

              {/* Energy */}
              <section>
                <div className="text-sm font-bold font-mono text-slate-400 uppercase tracking-wider px-1 mb-1.5">
                  Énergie
                </div>
                <EnergyPanel />
              </section>

              {/* CTC */}
              <section>
                <div className="text-sm font-bold font-mono text-slate-400 uppercase tracking-wider px-1 mb-1.5">
                  Aiguillage
                </div>
                <CtcPanel />
              </section>

              {/* Setpoints */}
              <section>
                <div className="text-sm font-bold font-mono text-slate-400 uppercase tracking-wider px-1 mb-1.5">
                  Consignes
                </div>
                <SetpointPanel />
              </section>

              {/* Alarm log */}
              <section>
                <div className="flex items-center justify-between px-1 mb-1.5">
                  <div className="text-sm font-bold font-mono text-slate-400 uppercase tracking-wider">
                    Alarmes
                  </div>
                  {activeAlarms > 0 && (
                    <span className="text-sm font-mono text-red-400 font-bold">{activeAlarms} active{activeAlarms > 1 ? 's' : ''}</span>
                  )}
                </div>
                <div className="bg-surface-800/40 border border-surface-700/40 rounded-lg p-2">
                  <AlarmLog maxItems={15} />
                </div>
              </section>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
