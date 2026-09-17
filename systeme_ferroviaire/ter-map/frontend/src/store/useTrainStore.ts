import { create } from 'zustand';
import type {
  SystemSnapshot,
  TrainData,
  EnergyData,
  AlarmEvent,
  WsStatus,
  CollisionStatus,
  CtcInfo,
  SivCrisisInfo,
} from '../types/index.js';
import { detectCollision, plcPosToLatLon } from '../utils/geo.js';
import { extractAlarmEvents, clearResolvedAlarms } from '../utils/alarms.js';

const MAX_ALARM_HISTORY = 200;

interface TrainStoreState {
  // ── Connection ───────────────────────────────────────────
  wsStatus: WsStatus;
  plcOnline: boolean;
  lastPoll: string | null;
  pollLatencyMs: number;

  // ── Data ─────────────────────────────────────────────────
  trains: TrainData[];
  energy: EnergyData | null;
  alarms: AlarmEvent[];

  // ── Direction tracking (+1 avant, -1 arrière, 0 arrêté) ──
  trainDirections: Record<string, number>;
  _prevNorms: Record<string, number>;

  // ── Collision ─────────────────────────────────────────────
  collision: CollisionStatus | null;

  // ── CTC aiguille / switch state ───────────────────────────
  ctc: CtcInfo | null;

  // ── SIV multi-quai crisis state ───────────────────────────
  sivCrisis: SivCrisisInfo | null;

  // ── UI state ──────────────────────────────────────────────
  theme: 'light' | 'dark';
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  selectedTrainId: string | null;
  mapFocusMode: boolean;

  // ── Actions ───────────────────────────────────────────────
  setWsStatus: (status: WsStatus) => void;
  applySnapshot: (snap: SystemSnapshot) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setLeftPanelOpen: (open: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  selectTrain: (id: string | null) => void;
  toggleMapFocus: () => void;
  dismissAlarm: (id: string) => void;
}

export const useTrainStore = create<TrainStoreState>((set, get) => ({
  // ── Initial state ────────────────────────────────────────
  wsStatus: 'connecting',
  plcOnline: false,
  lastPoll: null,
  pollLatencyMs: -1,
  trains: [],
  energy: null,
  alarms: [],
  trainDirections: { DKR: 1, DMD: -1 },  // DKR part de Dakar, DMD de Diamniadio
  _prevNorms: {},
  collision: null,
  ctc: null,
  sivCrisis: null,
  theme: 'dark',
  leftPanelOpen: true,
  rightPanelOpen: false,
  selectedTrainId: null,
  mapFocusMode: false,

  // ── Actions ───────────────────────────────────────────────
  setWsStatus: (wsStatus) => set({ wsStatus }),

  applySnapshot: (snap: SystemSnapshot) => {
    const { alarms: prevAlarms, _prevNorms, trainDirections: prevDirs } = get();

    // Compute new alarms
    const newAlarms = extractAlarmEvents(snap.trains, snap.energy, prevAlarms);
    const clearedAlarms = clearResolvedAlarms(prevAlarms, snap.trains, snap.energy);
    const mergedAlarms = [...newAlarms, ...clearedAlarms]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, MAX_ALARM_HISTORY);

    // Update direction tracking from position deltas
    const newPrevNorms: Record<string, number> = {};
    const newDirs: Record<string, number> = { ...prevDirs };

    for (const t of snap.trains) {
      const prev = _prevNorms[t.train_id];
      if (prev !== undefined) {
        const delta = t.progression_norm - prev;
        if (Math.abs(delta) > 0.0005) {  // filtre bruit
          newDirs[t.train_id] = delta > 0 ? 1 : -1;
        }
        // Si arrêté (vitesse = 0), garde la dernière direction connue
      }
      newPrevNorms[t.train_id] = t.progression_norm;
    }

    // Compute collision status (only if both trains have valid data)
    let collision: CollisionStatus | null = null;
    const dkr = snap.trains.find(t => t.train_id === 'DKR');
    const dmd = snap.trains.find(t => t.train_id === 'DMD');

    if (dkr && dmd &&
        dkr.qualite_donnee !== 'offline' &&
        dmd.qualite_donnee !== 'offline') {
      collision = detectCollision(
        dkr.progression_norm,
        dkr.vitesse_kmh,
        dmd.progression_norm,
        dmd.vitesse_kmh,
        newDirs['DKR'] ?? 1,
        newDirs['DMD'] ?? -1,
        dkr.alm_critique,
        dmd.alm_critique,
      );
    }

    set({
      plcOnline: snap.plc_online,
      lastPoll: snap.last_poll,
      pollLatencyMs: snap.poll_latency_ms,
      trains: snap.trains,
      energy: snap.energy,
      alarms: mergedAlarms,
      trainDirections: newDirs,
      _prevNorms: newPrevNorms,
      collision: collision?.risk !== 'none' ? collision : null,
      ctc: snap.ctc ?? null,
      sivCrisis: snap.siv_crisis ?? null,
    });
  },

  setTheme: (theme) => {
    set({ theme });
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('ter-theme', theme);
  },

  toggleTheme: () => {
    const { theme, setTheme } = get();
    setTheme(theme === 'dark' ? 'light' : 'dark');
  },

  setLeftPanelOpen: (leftPanelOpen) => set({ leftPanelOpen }),
  setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
  selectTrain: (selectedTrainId) => set({ selectedTrainId, rightPanelOpen: selectedTrainId !== null }),
  toggleMapFocus: () => set(s => ({
    mapFocusMode: !s.mapFocusMode,
    leftPanelOpen: s.mapFocusMode,
    rightPanelOpen: false,
  })),
  dismissAlarm: (id) => set(s => ({
    alarms: s.alarms.map(a => a.id === id ? { ...a, cleared: true } : a),
  })),
}));

// Selector helpers
export const selectTrain = (id: string) => (s: TrainStoreState) =>
  s.trains.find(t => t.train_id === id);

export const selectTrainPosition = (id: string) => (s: TrainStoreState) => {
  const train = s.trains.find(t => t.train_id === id);
  if (!train) return null;
  return plcPosToLatLon(train.progression_plc);
};

export const selectActiveAlarmCount = (s: TrainStoreState) =>
  s.alarms.filter(a => !a.cleared).length;
