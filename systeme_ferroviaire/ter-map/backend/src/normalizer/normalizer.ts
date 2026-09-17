import type {
  RawModbusData,
  TrainData,
  EnergyData,
  CtcInfo,
  SivCrisisInfo,
  SystemSnapshot,
  TrainId,
  DataQuality,
  TrainState,
} from '../types/index.js';
import { loadPlcMapping } from '../config/loader.js';

// PLC position range (from railway1.st)
const PLC_POS_MIN = 120;
const PLC_POS_MAX = 1960;

// Alarm code → human-readable label
const ALARM_LABELS: Record<string, string> = {
  alm_critique:           'Alarme critique',
  alm_tension_basse:      'Tension caténaire basse',
  alm_surcharge:          'Surcharge traction',
  alm_transfo_chaud:      'Transformateur surchauffé',
  alm_commande_anormale:  'Commande anormale',
  alm_tx2_temp_high:      'TX2 température haute',
  alm_tx2_temp_crit:      'TX2 température critique',
  alm_fdr2_surcharge:     'Feeder 2 surcharge',
  alm_fdr2_desequilibre:  'Feeder 2 déséquilibre',
  siv_desinformation:     'Information voyageurs incohérente',
};

const POSITION_ZONES = [
  { pos: 120,  name: 'Gare de Dakar' },
  { pos: 248,  name: 'Colobane' },
  { pos: 376,  name: 'Hann' },
  { pos: 503,  name: 'Dalifort' },
  { pos: 657,  name: 'Baux Maraîchers' },
  { pos: 784,  name: 'Pikine' },
  { pos: 912,  name: 'Thiaroye' },
  { pos: 1040, name: 'Yeumbeul' },
  { pos: 1193, name: 'Keur Mbaye Fall' },
  { pos: 1321, name: "M'Bao" },
  { pos: 1449, name: 'PNR' },
  { pos: 1551, name: 'Rufisque' },
  { pos: 1781, name: 'Bargny' },
  { pos: 1960, name: 'Diamniadio' },
];

function toNormalized(plcPos: number): number {
  const clamped = Math.max(PLC_POS_MIN, Math.min(PLC_POS_MAX, plcPos));
  return (clamped - PLC_POS_MIN) / (PLC_POS_MAX - PLC_POS_MIN);
}

function validateBound(value: number, min?: number, max?: number): number {
  if (min !== undefined && value < min) return min;
  if (max !== undefined && value > max) return max;
  return value;
}

function deriveTrainState(t: Partial<TrainData>, quality: DataQuality): TrainState {
  if (quality === 'offline') return 'offline';
  if (t.alm_critique) return 'critique';
  if (t.siv?.actif) return 'degrade';
  if (t.mode_degrade || t.alm_tension_basse || t.alm_transfo_chaud) return 'degrade';
  if (t.train_en_marche) return 'marche';
  return 'arret';
}

function buildAlarmesList(t: Partial<TrainData>): string[] {
  const out: string[] = [];
  const flags: Array<keyof typeof ALARM_LABELS> = [
    'alm_critique', 'alm_tension_basse', 'alm_surcharge',
    'alm_transfo_chaud', 'alm_commande_anormale',
  ];
  for (const f of flags) {
    if (t[f as keyof TrainData]) out.push(ALARM_LABELS[f]);
  }
  if (t.siv?.actif) out.push(ALARM_LABELS.siv_desinformation);
  return out;
}

function zoneFromPlc(pos: number): string {
  let best = POSITION_ZONES[0];
  let bestDist = Infinity;
  for (const zone of POSITION_ZONES) {
    const dist = Math.abs(zone.pos - pos);
    if (dist < bestDist) {
      best = zone;
      bestDist = dist;
    }
  }
  return best.name;
}

export class DataNormalizer {
  private mapping = loadPlcMapping();

  normalizeAll(
    raw: RawModbusData,
    plcOnline: boolean,
    latencyMs: number,
  ): SystemSnapshot {
    const quality: DataQuality = plcOnline ? 'ok' : 'offline';

    return {
      type: 'snapshot',
      plc_online: plcOnline,
      last_poll: raw.read_at,
      poll_latency_ms: latencyMs,
      trains: [
        this.normalizeTrain('DKR', raw, quality),
        this.normalizeTrain('DMD', raw, quality),
      ],
      energy: this.normalizeEnergy(raw, quality),
      ctc: this.normalizeCTC(raw, quality),
      siv_crisis: this.normalizeSivCrisis(raw, quality),
    };
  }

  private normalizeTrain(id: TrainId, raw: RawModbusData, quality: DataQuality): TrainData {
    const trainCfg = this.mapping.trains[id];
    if (!trainCfg) throw new Error(`Train config missing: ${id}`);

    const ir = raw.ir;
    const di = raw.di;

    // Register addresses from config
    const r = trainCfg.registers;
    const b = trainCfg.bits;

    const vitesse_kmh = quality !== 'offline'
      ? validateBound(ir[r.vitesse?.addr ?? 0] ?? 0, r.vitesse?.min, r.vitesse?.max)
      : 0;

    const progression_plc = quality !== 'offline'
      ? validateBound(ir[r.position?.addr ?? 0] ?? PLC_POS_MIN, r.position?.min, r.position?.max)
      : PLC_POS_MIN;

    const courant_a = quality !== 'offline'
      ? validateBound(ir[r.courant_traction?.addr ?? 0] ?? 0, r.courant_traction?.min, r.courant_traction?.max)
      : 0;

    const tension_kv = quality !== 'offline'
      ? (ir[r.tension_catenaire?.addr ?? 0] ?? 0) * (r.tension_catenaire?.scale ?? 0.001)
      : 0;

    const temp_transfo_c = quality !== 'offline'
      ? validateBound(ir[r.temp_transfo?.addr ?? 0] ?? 0, r.temp_transfo?.min, r.temp_transfo?.max)
      : 0;

    const niveau_incident = quality !== 'offline'
      ? (ir[r.niveau_incident?.addr ?? 0] ?? 0)
      : 3;

    const nombre_alarmes = quality !== 'offline'
      ? (ir[r.nombre_alarmes?.addr ?? 0] ?? 0)
      : 0;

    const id_gare = quality !== 'offline'
      ? (ir[r.id_gare?.addr ?? 0] ?? 0)
      : 0;

    // Discrete inputs
    const getBit = (addr: number) => quality !== 'offline' ? (di[addr] ?? false) : false;

    const signal_vert           = getBit(b.signal_vert?.addr ?? 0);
    const signal_rouge          = getBit(b.signal_rouge?.addr ?? 0);
    const catenaire_ok          = getBit(b.catenaire_ok?.addr ?? 0);
    const mode_degrade          = getBit(b.mode_degrade?.addr ?? 0);
    const train_en_marche       = getBit(b.train_en_marche?.addr ?? 0);
    const alm_critique          = getBit(b.alm_critique?.addr ?? 0);
    const alm_tension_basse     = getBit(b.alm_tension_basse?.addr ?? 0);
    const alm_surcharge         = getBit(b.alm_surcharge?.addr ?? 0);
    const alm_transfo_chaud     = getBit(b.alm_transfo_chaud?.addr ?? 0);
    const alm_commande_anormale = getBit(b.alm_commande_anormale?.addr ?? 0);

    const sivActif = id === 'DKR' ? getBit(67) : getBit(68);
    const sivPositionAddr = id === 'DKR' ? 60 : 63;
    const sivGapAddr = id === 'DKR' ? 61 : 64;
    const sivDelayAddr = id === 'DKR' ? 62 : 65;
    const positionAnnoncee = quality !== 'offline'
      ? validateBound(ir[sivPositionAddr] ?? progression_plc, PLC_POS_MIN, PLC_POS_MAX)
      : PLC_POS_MIN;
    const ecartPosition = quality !== 'offline' ? (ir[sivGapAddr] ?? 0) : 0;
    const retardAnnonce = quality !== 'offline' ? (ir[sivDelayAddr] ?? 0) : 0;
    const niveauDesinformation = quality !== 'offline' ? (ir[66] ?? 0) : 0;

    const siv = {
      actif: sivActif,
      position_annoncee_plc: positionAnnoncee,
      progression_annoncee_norm: toNormalized(positionAnnoncee),
      zone_annoncee: zoneFromPlc(positionAnnoncee),
      ecart_position: ecartPosition,
      retard_annonce_min: retardAnnonce,
      niveau_desinformation: niveauDesinformation,
      message: sivActif
        ? `SIV incohérent: annoncé ${zoneFromPlc(positionAnnoncee)}, écart ${ecartPosition} unités PLC, retard affiché ${retardAnnonce} min`
        : 'SIV cohérent avec la position réelle',
    };

    const partial: Partial<TrainData> = {
      train_en_marche, alm_critique, alm_tension_basse,
      alm_surcharge, alm_transfo_chaud, alm_commande_anormale, mode_degrade,
      siv,
    };

    const etat_train = deriveTrainState(partial, quality);
    const alarmes_actives = buildAlarmesList(partial);

    return {
      train_id: id,
      label: trainCfg.label,
      direction: trainCfg.direction,
      color: trainCfg.color,
      vitesse_kmh,
      progression_plc,
      progression_norm: toNormalized(progression_plc),
      id_gare,
      tension_kv,
      courant_a,
      temp_transfo_c,
      etat_train,
      signal_vert,
      signal_rouge,
      catenaire_ok,
      mode_degrade,
      train_en_marche,
      alm_critique,
      alm_tension_basse,
      alm_surcharge,
      alm_transfo_chaud,
      alm_commande_anormale,
      alarmes_actives,
      niveau_incident,
      nombre_alarmes,
      siv,
      qualite_donnee: quality,
      updated_at: raw.read_at,
    };
  }

  private normalizeEnergy(raw: RawModbusData, quality: DataQuality): EnergyData {
    const e = this.mapping.energy;
    const ir = raw.ir;
    const di = raw.di;
    const r = e.registers;
    const b = e.bits;

    const getIR = (field: string) =>
      quality !== 'offline' ? (ir[r[field]?.addr ?? 0] ?? 0) : 0;
    const getDI = (field: string) =>
      quality !== 'offline' ? (di[b[field]?.addr ?? 0] ?? false) : false;

    return {
      tx1_oil_temp_c:          getIR('tx1_oil_temp'),
      tx1_winding_temp_c:      getIR('tx1_winding_temp'),
      tx2_oil_temp_c:          getIR('tx2_oil_temp'),
      tx2_winding_temp_c:      getIR('tx2_winding_temp'),
      tx2_output_voltage_kv:   getIR('tx2_output_voltage'),
      alm_fdr2_surcharge:      getDI('alm_fdr2_surcharge'),
      alm_fdr2_desequilibre:   getDI('alm_fdr2_desequilibre'),
      alm_tx2_temp_high:       getDI('alm_tx2_temp_high'),
      alm_tx2_temp_crit:       getDI('alm_tx2_temp_crit'),
      qualite_donnee:          quality,
      updated_at:              raw.read_at,
    };
  }

  private normalizeSivCrisis(raw: RawModbusData, quality: DataQuality): SivCrisisInfo {
    if (quality === 'offline') {
      return { niveau: 0, dkr_msg_actif: false, dmd_msg_actif: false, alm_crise_totale: false };
    }
    return {
      niveau:           raw.ir[68]  ?? 0,
      dkr_msg_actif:    (raw.ir[69] ?? 0) === 1,
      dmd_msg_actif:    raw.di[69]  ?? false,   // DI69 = SIV_ALM_MSG_CRIMINEL (DMD)
      alm_crise_totale: raw.di[71]  ?? false,   // DI71 = SIV_ALM_CRISE_TOTALE
    };
  }

  private normalizeCTC(raw: RawModbusData, quality: DataQuality): CtcInfo {
    const ir = raw.ir;
    const di = raw.di;
    const coils = raw.coils ?? {};
    const ctcCommandActive = coils[32] ?? false;
    const ctcFeedbackActive = di[72] ?? false;
    const aiguille_deviee = quality !== 'offline' ? (ctcCommandActive || ctcFeedbackActive) : false;
    const alm_aiguille    = quality !== 'offline' ? ((di[73] ?? false) || aiguille_deviee) : false;
    const distance_plc    = quality !== 'offline' ? (ir[70] ?? 1840) : 1840;
    const risk_level      = quality !== 'offline' ? (ir[71] ?? 0) : 0;
    const collision_position_plc = quality !== 'offline' ? (ir[72] ?? 0) : 0;
    const alm_collision   = quality !== 'offline'
      ? ((di[74] ?? false) || (aiguille_deviee && distance_plc <= 1))
      : false;
    const distance_km     = (distance_plc / 1840) * 36;
    return { aiguille_deviee, alm_aiguille, alm_collision, distance_plc, risk_level, collision_position_plc, distance_km };
  }

  buildOfflineSnapshot(): SystemSnapshot {
    const now = new Date().toISOString();
    const offlineTrain = (id: TrainId, cfg: { label: string; direction: string; color: string }): TrainData => ({
      train_id: id,
      label: cfg.label,
      direction: cfg.direction,
      color: cfg.color,
      vitesse_kmh: 0,
      progression_plc: id === 'DKR' ? 120 : 620,
      progression_norm: id === 'DKR' ? 0 : (620 - PLC_POS_MIN) / (PLC_POS_MAX - PLC_POS_MIN),
      id_gare: 0,
      tension_kv: 0,
      courant_a: 0,
      temp_transfo_c: 0,
      etat_train: 'offline',
      signal_vert: false,
      signal_rouge: true,
      catenaire_ok: false,
      mode_degrade: false,
      train_en_marche: false,
      alm_critique: false,
      alm_tension_basse: false,
      alm_surcharge: false,
      alm_transfo_chaud: false,
      alm_commande_anormale: false,
      alarmes_actives: [],
      niveau_incident: 0,
      nombre_alarmes: 0,
      siv: {
        actif: false,
        position_annoncee_plc: id === 'DKR' ? 120 : 1960,
        progression_annoncee_norm: id === 'DKR' ? 0 : 1,
        zone_annoncee: id === 'DKR' ? 'Gare de Dakar' : 'Diamniadio',
        ecart_position: 0,
        retard_annonce_min: 0,
        niveau_desinformation: 0,
        message: 'SIV indisponible: automate hors ligne',
      },
      qualite_donnee: 'offline',
      updated_at: now,
    });

    return {
      type: 'snapshot',
      plc_online: false,
      last_poll: now,
      poll_latency_ms: -1,
      trains: [
        offlineTrain('DKR', { label: 'Train DKR', direction: 'Dakar → Diamniadio', color: '#2EC5A4' }),
        offlineTrain('DMD', { label: 'Train DMD', direction: 'Diamniadio → Dakar', color: '#F5A623' }),
      ],
      ctc: {
        aiguille_deviee: false,
        alm_aiguille: false,
        alm_collision: false,
        distance_plc: 1840,
        risk_level: 0,
        collision_position_plc: 0,
        distance_km: 36,
      },
      siv_crisis: {
        niveau: 0,
        dkr_msg_actif: false,
        dmd_msg_actif: false,
        alm_crise_totale: false,
      },
      energy: {
        tx1_oil_temp_c: 0,
        tx1_winding_temp_c: 0,
        tx2_oil_temp_c: 0,
        tx2_winding_temp_c: 0,
        tx2_output_voltage_kv: 0,
        alm_fdr2_surcharge: false,
        alm_fdr2_desequilibre: false,
        alm_tx2_temp_high: false,
        alm_tx2_temp_crit: false,
        qualite_donnee: 'offline',
        updated_at: now,
      },
    };
  }
}
