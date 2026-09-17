// ============================================================
// TER MAP — Shared Types
// ============================================================

export type TrainId = 'DKR' | 'DMD';
export type DataQuality = 'ok' | 'stale' | 'offline';
export type TrainState = 'marche' | 'arret' | 'degrade' | 'critique' | 'offline';

// ── SIV / SONO passenger information consistency ───────────
export interface SivInfo {
  actif: boolean;
  position_annoncee_plc: number;
  progression_annoncee_norm: number;
  zone_annoncee: string;
  ecart_position: number;
  retard_annonce_min: number;     // négatif = en avance (attaque)
  niveau_desinformation: number;
  message: string;
}

// ── SIV multi-quai crisis state (Option 2 attack) ──────────
export interface SivCrisisInfo {
  niveau: number;             // 0=nominal, 1=furtif, 2=perturbe, 3=evacuation
  dkr_msg_actif: boolean;     // panneau DKR compromis (DI70)
  dmd_msg_actif: boolean;     // panneau DMD compromis (DI69)
  alm_crise_totale: boolean;  // crise totale (DI71)
}

// ── Normalized train data (output of normalizer) ────────────
export interface TrainData {
  train_id: TrainId;
  label: string;
  direction: string;
  color: string;

  // Cinématique
  vitesse_kmh: number;
  progression_plc: number;   // raw PLC position value [120–1960]
  progression_norm: number;  // normalized [0.0–1.0]
  id_gare: number;

  // Énergie traction
  tension_kv: number;
  courant_a: number;
  temp_transfo_c: number;

  // État & signalisation
  etat_train: TrainState;
  signal_vert: boolean;
  signal_rouge: boolean;
  catenaire_ok: boolean;
  mode_degrade: boolean;
  train_en_marche: boolean;

  // Alarmes
  alm_critique: boolean;
  alm_tension_basse: boolean;
  alm_surcharge: boolean;
  alm_transfo_chaud: boolean;
  alm_commande_anormale: boolean;
  alarmes_actives: string[];
  niveau_incident: number;   // 0=normal, 2=dégradé, 3=critique
  nombre_alarmes: number;

  // Information voyageurs
  siv: SivInfo;

  // Meta
  qualite_donnee: DataQuality;
  updated_at: string;        // ISO 8601
}

// ── Normalized energy data ──────────────────────────────────
export interface EnergyData {
  tx1_oil_temp_c: number;
  tx1_winding_temp_c: number;
  tx2_oil_temp_c: number;
  tx2_winding_temp_c: number;
  tx2_output_voltage_kv: number;

  alm_fdr2_surcharge: boolean;
  alm_fdr2_desequilibre: boolean;
  alm_tx2_temp_high: boolean;
  alm_tx2_temp_crit: boolean;

  qualite_donnee: DataQuality;
  updated_at: string;
}

// ── CTC switch / collision state ────────────────────────────
export interface CtcInfo {
  aiguille_deviee: boolean;   // coil32 or DI72 — switch physically deviated
  alm_aiguille: boolean;      // DI73 — switch alarm
  alm_collision: boolean;     // DI74 — imminent collision alarm
  distance_plc: number;       // IR70 — inter-train distance (PLC units)
  risk_level: number;         // IR71 — 0–100 collision risk %
  collision_position_plc: number; // IR72 — simulated impact point on the line
  distance_km: number;        // derived: distance_plc / 1840 * 36
}

// ── Full system snapshot (broadcast payload) ───────────────
export interface SystemSnapshot {
  type: 'snapshot';
  plc_online: boolean;
  last_poll: string;
  poll_latency_ms: number;
  trains: TrainData[];
  energy: EnergyData;
  ctc: CtcInfo;
  siv_crisis: SivCrisisInfo;
}

// ── WebSocket message types ─────────────────────────────────
export type WsMessage =
  | SystemSnapshot
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'error'; message: string };

// ── Alarm event (timeline) ──────────────────────────────────
export interface AlarmEvent {
  id: string;
  timestamp: string;
  train_id: TrainId | 'SYSTEM' | 'ENERGY';
  severity: 'info' | 'warning' | 'critical';
  code: string;
  message: string;
  cleared: boolean;
}

// ── PLC mapping config types ────────────────────────────────
export interface RegisterConfig {
  fc: number;
  addr: number;
  scale: number;
  unit: string;
  field: string;
  min?: number;
  max?: number;
}

export interface BitConfig {
  fc: number;
  addr: number;
  field: string;
}

export interface TrainMapping {
  id: string;
  label: string;
  direction: string;
  color: string;
  plc: string;
  registers: Record<string, RegisterConfig>;
  bits: Record<string, BitConfig>;
}

export interface EnergyMapping {
  plc: string;
  registers: Record<string, RegisterConfig>;
  bits: Record<string, BitConfig>;
}

export interface PlcConfig {
  id: string;
  label: string;
  host: string;
  port: number;
  unit_id: number;
}

export interface PlcMappingConfig {
  plcs: Record<string, PlcConfig>;
  trains: Record<string, TrainMapping>;
  energy: EnergyMapping;
  position_mapping: {
    plc_min: number;
    plc_max: number;
    line_length_km: number;
  };
}

// ── Raw Modbus read result ──────────────────────────────────
export interface RawModbusData {
  // Input Registers (FC04)
  ir: Record<number, number>;
  // Discrete Inputs (FC02)
  di: Record<number, boolean>;
  // Coils (FC01)
  coils?: Record<number, boolean>;
  // Timestamp
  read_at: string;
  latency_ms: number;
}
