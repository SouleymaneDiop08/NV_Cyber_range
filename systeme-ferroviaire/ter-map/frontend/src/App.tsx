import React, { useEffect, useRef, useState } from 'react';
import { useTrainStore } from './store/useTrainStore.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { StatusBar } from './components/ui/StatusBar.js';
import { LeftPanel } from './components/panels/LeftPanel.js';
import { RightPanel } from './components/panels/RightPanel.js';
import { TrainMap } from './components/Map/TrainMap.js';

// ── Offline overlay ───────────────────────────────────────────
function OfflineOverlay() {
  const { wsStatus, plcOnline, trains } = useTrainStore();
  const allOffline = trains.every(t => t.qualite_donnee === 'offline');

  if (wsStatus === 'connected' && plcOnline) return null;

  if (wsStatus === 'connecting' || wsStatus === 'reconnecting') {
    return (
      <div className="ter-offline-overlay animate-fade-in">
        <div className="text-amber-400 text-2xl mb-2">⟳</div>
        <div className="font-mono font-bold text-sm mb-1 text-white">
          {wsStatus === 'connecting' ? 'Connexion en cours…' : 'Reconnexion…'}
        </div>
        <div className="text-xs text-slate-400">
          Serveur: {window.location.host}
        </div>
      </div>
    );
  }

  if (!plcOnline && allOffline) {
    return (
      <div className="ter-offline-overlay animate-fade-in">
        <div className="text-red-400 text-3xl mb-2">⚠</div>
        <div className="font-mono font-bold text-sm mb-1 text-white">
          PLC HORS LIGNE
        </div>
        <div className="text-xs text-slate-400 mb-2">
          192.168.20.10:502 — Pas de réponse
        </div>
        <div className="text-xs text-slate-500">
          Dernières données affichées
        </div>
      </div>
    );
  }

  return null;
}

// ── SIV crisis top banner ─────────────────────────────────────
const SIV_BANNER_CONFIG: Record<number, { bg: string; text: string; mitre: string }> = {
  1: { bg: 'siv-banner-niveau1', text: 'SYSTÈME SIV COMPROMIS — Informations voyageurs non fiables — Vérification en cours', mitre: 'T0832' },
  2: { bg: 'siv-banner-niveau2', text: '🚨 ALERTE SERVICE — Train annoncé EN AVANCE — Rejoignez votre quai IMMÉDIATEMENT', mitre: 'T0832 · T0855' },
  3: { bg: 'siv-banner-niveau3', text: '🚨🚨 ALERTE SÉCURITÉ CRITIQUE — ÉVACUEZ LE QUAI IMMÉDIATEMENT — NE PAS PRENDRE LE TRAIN', mitre: 'T0826 · T0831 · T0832' },
};

function SivCrisisBanner() {
  const { sivCrisis } = useTrainStore();
  const niveau = sivCrisis?.niveau ?? 0;
  if (niveau < 1) return null;
  const cfg = SIV_BANNER_CONFIG[niveau] ?? SIV_BANNER_CONFIG[1];
  return (
    <div className={`siv-crisis-banner ${cfg.bg}`}>
      <span className="siv-crisis-banner-icon">⚠</span>
      <span className="siv-crisis-banner-text">{cfg.text}</span>
      <span className="siv-crisis-banner-mitre">{cfg.mitre}</span>
    </div>
  );
}

// ── SIV full-screen evacuation overlay (niveau 3) ─────────────
function SivEvacuationOverlay() {
  const { sivCrisis } = useTrainStore();
  const [visible, setVisible] = useState(false);
  const prevNiveau = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const niveau = sivCrisis?.niveau ?? 0;
    // Rising edge to niveau 3
    if (niveau >= 3 && prevNiveau.current < 3) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setVisible(true);
      // Auto-hide after 6s (boards stay compromised, overlay is just intro burst)
      timerRef.current = setTimeout(() => setVisible(false), 6000);
    }
    if (niveau < 3) {
      setVisible(false);
    }
    prevNiveau.current = niveau;
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [sivCrisis?.niveau]);

  if (!visible) return null;

  return (
    <div className="siv-evacuation-overlay" aria-live="assertive">
      <div className="siv-evac-flash" />
      <div className="siv-evac-rings">
        <div className="siv-evac-ring r1" />
        <div className="siv-evac-ring r2" />
        <div className="siv-evac-ring r3" />
      </div>
      <div className="siv-evac-text">
        <div className="siv-evac-title">⚠ ALERTE SÉCURITÉ CRITIQUE</div>
        <div className="siv-evac-sub">ÉVACUEZ LE QUAI IMMÉDIATEMENT</div>
        <div className="siv-evac-code">SIV_ALM_CRISE_TOTALE · DI71 = TRUE · T0832</div>
      </div>
    </div>
  );
}

// ── CTC alert top banner ──────────────────────────────────────
function CtcAlertBanner() {
  const { ctc } = useTrainStore();
  if (!ctc?.aiguille_deviee) return null;

  const isCollision = ctc.alm_collision;
  const risk = ctc.risk_level;

  return (
    <div className={`ctc-top-banner ${isCollision ? 'ctc-top-banner-collision' : ''}`}>
      <span className="ctc-top-banner-icon">{isCollision ? '💥' : '⚡'}</span>
      <span className="ctc-top-banner-text">
        {isCollision
          ? 'COLLISION IMMINENTE — AIGUILLE DÉVIÉE PAR ATTAQUE MODBUS'
          : `ATTAQUE CTC DÉTECTÉE — AIGUILLE DÉVIÉE — RISQUE : ${Math.round(risk)}%`}
      </span>
      <span className="ctc-top-banner-mitre">T0855 · T0831</span>
    </div>
  );
}

// ── Full-screen collision explosion overlay ────────────────────
function CollisionExplosionOverlay() {
  const { ctc } = useTrainStore();
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<'flash' | 'smoke' | 'fade'>('flash');
  const prevCollision = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const nowCollision = ctc?.alm_collision ?? false;

    // Rising edge — new collision detected
    if (nowCollision && !prevCollision.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setVisible(true);
      setPhase('flash');

      timerRef.current = setTimeout(() => setPhase('smoke'), 600);
      timerRef.current = setTimeout(() => setPhase('fade'), 2000);
      timerRef.current = setTimeout(() => setVisible(false), 4000);
    }

    prevCollision.current = nowCollision;
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [ctc?.alm_collision]);

  if (!visible) return null;

  return (
    <div className={`ctc-explosion-overlay ctc-explosion-${phase}`} aria-hidden="true">
      <div className="ctc-explosion-flash" />
      <div className="ctc-explosion-rings">
        <div className="ctc-exp-ring r1" />
        <div className="ctc-exp-ring r2" />
        <div className="ctc-exp-ring r3" />
        <div className="ctc-exp-ring r4" />
      </div>
      <div className="ctc-explosion-text">
        <div className="ctc-explosion-title">💥 COLLISION</div>
        <div className="ctc-explosion-sub">Les deux trains convergent sur la même voie</div>
        <div className="ctc-explosion-code">CTC_ALM_COLLISION · DI74 = TRUE</div>
      </div>
    </div>
  );
}

// ── Focus mode button ─────────────────────────────────────────
function FocusModeButton() {
  const { mapFocusMode, toggleMapFocus } = useTrainStore();
  return (
    <button
      onClick={toggleMapFocus}
      className={`
        absolute bottom-4 right-4 z-[999]
        px-3 py-1.5 rounded-lg text-xs font-mono font-medium
        bg-surface-800/90 backdrop-blur-sm
        border border-surface-700/60
        text-slate-400 hover:text-slate-200 hover:bg-surface-700
        transition-all duration-200
        shadow-lg
      `}
      title={mapFocusMode ? 'Quitter le mode focus' : 'Mode focus carte'}
    >
      {mapFocusMode ? '⊞ Panneaux' : '⊡ Focus'}
    </button>
  );
}

// ── Main App ──────────────────────────────────────────────────
export function App() {
  const { setTheme, theme } = useTrainStore();

  // Initialize WebSocket connection
  useWebSocket();

  // Restore theme preference
  useEffect(() => {
    const saved = localStorage.getItem('ter-theme') as 'light' | 'dark' | null;
    if (saved) {
      setTheme(saved);
    } else {
      // Default: dark theme
      setTheme('dark');
    }
  }, [setTheme]);

  return (
    <div className={`flex flex-col h-screen w-screen overflow-hidden ${theme === 'dark' ? 'dark' : ''}`}
         style={{ background: 'var(--surface-primary)', color: 'var(--text-primary)' }}>

      {/* ── SIV crisis banner (top priority when active) ──────── */}
      <SivCrisisBanner />

      {/* ── CTC alert banner (above status bar when active) ──── */}
      <CtcAlertBanner />

      {/* ── Top status bar ──────────────────────────────────── */}
      <StatusBar />

      {/* ── Main layout ─────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* Left panel */}
        <LeftPanel />

        {/* Map (fills remaining space) */}
        <div className="flex-1 relative overflow-hidden">
          <TrainMap />
          <OfflineOverlay />
          <FocusModeButton />
        </div>

        {/* Right panel */}
        <RightPanel />
      </div>

      {/* ── Full-screen collision explosion ──────────────────── */}
      <CollisionExplosionOverlay />

      {/* ── SIV evacuation burst overlay (niveau 3) ──────────── */}
      <SivEvacuationOverlay />
    </div>
  );
}
