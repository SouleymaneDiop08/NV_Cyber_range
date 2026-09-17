// ============================================================
// TER MAP — Frontend Types
// Mirrors backend types/index.ts
// ============================================================

export type TrainId = 'DKR' | 'DMD';
export type DataQuality = 'ok' | 'stale' | 'offline';
export type TrainState = 'marche' | 'arret' | 'degrade' | 'critique' | 'offline';

export interface SivInfo {
  actif: boolean;
  position_annoncee_plc: number;
  progression_annoncee_norm: number;
  zone_annoncee: string;
  ecart_position: number;
  retard_annonce_min: number;   // négatif = train annoncé en avance (attaque)
  niveau_desinformation: number;
  message: string;
}

// ── SIV multi-quai crisis state (Option 2 attack) ──────────
export interface SivCrisisInfo {
  niveau: number;             // 0=nominal 1=furtif 2=perturbe 3=evacuation
  dkr_msg_actif: boolean;
  dmd_msg_actif: boolean;
  alm_crise_totale: boolean;
}

export interface TrainData {
  train_id: TrainId;
  label: string;
  direction: string;
  color: string;
  vitesse_kmh: number;
  progression_plc: number;
  progression_norm: number;   // 0.0 → 1.0
  id_gare: number;
  tension_kv: number;
  courant_a: number;
  temp_transfo_c: number;
  etat_train: TrainState;
  signal_vert: boolean;
  signal_rouge: boolean;
  catenaire_ok: boolean;
  mode_degrade: boolean;
  train_en_marche: boolean;
  alm_critique: boolean;
  alm_tension_basse: boolean;
  alm_surcharge: boolean;
  alm_transfo_chaud: boolean;
  alm_commande_anormale: boolean;
  alarmes_actives: string[];
  niveau_incident: number;
  nombre_alarmes: number;
  siv: SivInfo;
  qualite_donnee: DataQuality;
  updated_at: string;
}

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

export interface AlarmEvent {
  id: string;
  timestamp: string;
  train_id: TrainId | 'SYSTEM' | 'ENERGY';
  severity: 'info' | 'warning' | 'critical';
  code: string;
  message: string;
  cleared: boolean;
}

// ── Map / Geo types ─────────────────────────────────────────
export interface Station {
  id: number;
  name: string;
  shortName: string;
  lat: number;
  lon: number;
  pk_km: number;          // PK (point kilométrique) depuis Dakar
  is_major: boolean;
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface TrainPosition {
  train_id: TrainId;
  lat: number;
  lon: number;
  progression_norm: number;
  vitesse_kmh: number;
  etat_train: TrainState;
  color: string;
}

// ── CTC switch / collision state ────────────────────────────
export interface CtcInfo {
  aiguille_deviee: boolean;
  alm_aiguille: boolean;
  alm_collision: boolean;
  distance_plc: number;
  risk_level: number;
  collision_position_plc: number;
  distance_km: number;
}

export interface CollisionStatus {
  risk: 'none' | 'warning' | 'danger';
  distance_km: number;
  relative_speed_kmh: number;
  ttc_s: number | null;   // time-to-collision in seconds
  lat: number;
  lon: number;
}

// ── WebSocket connection state ───────────────────────────────
export type WsStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';
