import { DataNormalizer } from '../src/normalizer/normalizer';
import type { RawModbusData } from '../src/types/index';

// Mock config loader to avoid file system dependency
jest.mock('../src/config/loader', () => ({
  loadPlcMapping: () => ({
    plcs: {
      station_b: { id: 'station_b', label: 'Station B', host: '127.0.0.1', port: 502, unit_id: 1 },
    },
    trains: {
      DKR: {
        id: 'DKR', label: 'Train DKR', direction: 'Dakar → Diamniadio',
        color: '#2EC5A4', plc: 'station_b',
        registers: {
          id_gare:         { fc: 4, addr: 30, scale: 1, unit: '', field: 'id_gare' },
          vitesse:         { fc: 4, addr: 31, scale: 1, unit: 'km/h', field: 'vitesse_kmh', min: 0, max: 160 },
          position:        { fc: 4, addr: 32, scale: 1, unit: 'plc_units', field: 'progression_plc', min: 120, max: 1960 },
          tension_catenaire: { fc: 4, addr: 33, scale: 0.001, unit: 'kV', field: 'tension_kv' },
          courant_traction:{ fc: 4, addr: 34, scale: 1, unit: 'A', field: 'courant_a', min: 0, max: 1200 },
          temp_transfo:    { fc: 4, addr: 35, scale: 1, unit: '°C', field: 'temp_transfo_c', min: 0, max: 150 },
          niveau_incident: { fc: 4, addr: 36, scale: 1, unit: '', field: 'niveau_incident' },
          nombre_alarmes:  { fc: 4, addr: 37, scale: 1, unit: '', field: 'nombre_alarmes' },
        },
        bits: {
          etat_plc_ok:    { fc: 2, addr: 11, field: 'etat_plc_ok' },
          etat_gare_ok:   { fc: 2, addr: 12, field: 'etat_gare_ok' },
          train_en_marche:{ fc: 2, addr: 14, field: 'train_en_marche' },
          signal_vert:    { fc: 2, addr: 15, field: 'signal_vert' },
          signal_rouge:   { fc: 2, addr: 16, field: 'signal_rouge' },
          catenaire_ok:   { fc: 2, addr: 20, field: 'catenaire_ok' },
          mode_degrade:   { fc: 2, addr: 26, field: 'mode_degrade' },
          alm_critique:   { fc: 2, addr: 28, field: 'alm_critique' },
          alm_tension_basse: { fc: 2, addr: 29, field: 'alm_tension_basse' },
          alm_surcharge:  { fc: 2, addr: 30, field: 'alm_surcharge' },
          alm_transfo_chaud: { fc: 2, addr: 31, field: 'alm_transfo_chaud' },
          alm_commande_anormale: { fc: 2, addr: 37, field: 'alm_commande_anormale' },
        },
      },
      DMD: {
        id: 'DMD', label: 'Train DMD', direction: 'Diamniadio → Dakar',
        color: '#F5A623', plc: 'station_b',
        registers: {
          id_gare:         { fc: 4, addr: 40, scale: 1, unit: '', field: 'id_gare' },
          vitesse:         { fc: 4, addr: 41, scale: 1, unit: 'km/h', field: 'vitesse_kmh', min: 0, max: 160 },
          position:        { fc: 4, addr: 42, scale: 1, unit: 'plc_units', field: 'progression_plc', min: 120, max: 1960 },
          tension_catenaire: { fc: 4, addr: 43, scale: 0.001, unit: 'kV', field: 'tension_kv' },
          courant_traction:{ fc: 4, addr: 44, scale: 1, unit: 'A', field: 'courant_a', min: 0, max: 1200 },
          temp_transfo:    { fc: 4, addr: 45, scale: 1, unit: '°C', field: 'temp_transfo_c', min: 0, max: 150 },
          niveau_incident: { fc: 4, addr: 46, scale: 1, unit: '', field: 'niveau_incident' },
          nombre_alarmes:  { fc: 4, addr: 47, scale: 1, unit: '', field: 'nombre_alarmes' },
        },
        bits: {
          etat_plc_ok:    { fc: 2, addr: 39, field: 'etat_plc_ok' },
          etat_gare_ok:   { fc: 2, addr: 40, field: 'etat_gare_ok' },
          train_en_marche:{ fc: 2, addr: 42, field: 'train_en_marche' },
          signal_vert:    { fc: 2, addr: 43, field: 'signal_vert' },
          signal_rouge:   { fc: 2, addr: 44, field: 'signal_rouge' },
          catenaire_ok:   { fc: 2, addr: 48, field: 'catenaire_ok' },
          mode_degrade:   { fc: 2, addr: 54, field: 'mode_degrade' },
          alm_critique:   { fc: 2, addr: 56, field: 'alm_critique' },
          alm_tension_basse: { fc: 2, addr: 57, field: 'alm_tension_basse' },
          alm_surcharge:  { fc: 2, addr: 58, field: 'alm_surcharge' },
          alm_transfo_chaud: { fc: 2, addr: 59, field: 'alm_transfo_chaud' },
          alm_commande_anormale: { fc: 2, addr: 65, field: 'alm_commande_anormale' },
        },
      },
    },
    energy: {
      plc: 'station_b',
      registers: {
        tx1_oil_temp:      { fc: 4, addr: 5, scale: 1, unit: '°C', field: 'tx1_oil_temp_c' },
        tx1_winding_temp:  { fc: 4, addr: 6, scale: 1, unit: '°C', field: 'tx1_winding_temp_c' },
        tx2_oil_temp:      { fc: 4, addr: 7, scale: 1, unit: '°C', field: 'tx2_oil_temp_c' },
        tx2_winding_temp:  { fc: 4, addr: 8, scale: 1, unit: '°C', field: 'tx2_winding_temp_c' },
        tx2_output_voltage:{ fc: 4, addr: 10, scale: 1, unit: 'kV', field: 'tx2_output_voltage_kv' },
      },
      bits: {
        alm_fdr2_surcharge:     { fc: 2, addr: 4, field: 'alm_fdr2_surcharge' },
        alm_fdr2_desequilibre:  { fc: 2, addr: 5, field: 'alm_fdr2_desequilibre' },
        alm_tx2_temp_high:      { fc: 2, addr: 9, field: 'alm_tx2_temp_high' },
        alm_tx2_temp_crit:      { fc: 2, addr: 10, field: 'alm_tx2_temp_crit' },
      },
    },
    position_mapping: { plc_min: 120, plc_max: 1960, line_length_km: 36.0 },
  }),
}));

function buildRaw(overrides?: Partial<{
  ir: Record<number, number>;
  di: Record<number, boolean>;
  coils: Record<number, boolean>;
}>): RawModbusData {
  const ir: Record<number, number> = {
    30: 10, 31: 72, 32: 820, 33: 25000, 34: 620, 35: 55, 36: 0, 37: 0,
    40: 20, 41: 88, 42: 1200, 43: 25000, 44: 680, 45: 58, 46: 0, 47: 0,
    60: 820, 61: 0, 62: 0, 63: 1200, 64: 0, 65: 0, 66: 0,
    5: 65, 6: 72, 7: 70, 8: 78, 9: 20, 10: 20,
    ...overrides?.ir,
  };
  const di: Record<number, boolean> = {
    14: true, 15: true, 16: false, 20: true,
    42: true, 43: true, 44: false, 48: true,
    67: false, 68: false,
    ...overrides?.di,
  };
  const coils: Record<number, boolean> = {
    ...overrides?.coils,
  };
  return { ir, di, coils, read_at: new Date().toISOString(), latency_ms: 12 };
}

describe('DataNormalizer', () => {
  let normalizer: DataNormalizer;

  beforeEach(() => {
    normalizer = new DataNormalizer();
  });

  // ── Snapshot structure ────────────────────────────────────
  describe('normalizeAll()', () => {
    it('returns snapshot with 2 trains', () => {
      const snap = normalizer.normalizeAll(buildRaw(), true, 12);
      expect(snap.type).toBe('snapshot');
      expect(snap.trains).toHaveLength(2);
      expect(snap.trains.map(t => t.train_id)).toEqual(['DKR', 'DMD']);
    });

    it('marks plc_online correctly', () => {
      const online  = normalizer.normalizeAll(buildRaw(), true, 10);
      const offline = normalizer.normalizeAll(buildRaw(), false, -1);
      expect(online.plc_online).toBe(true);
      expect(offline.plc_online).toBe(false);
    });
  });

  // ── Speed + position normalization ────────────────────────
  describe('Train metrics', () => {
    it('reads DKR speed from IR31', () => {
      const snap = normalizer.normalizeAll(buildRaw({ ir: { 31: 95 } }), true, 10);
      expect(snap.trains[0].vitesse_kmh).toBe(95);
    });

    it('reads DMD speed from IR41', () => {
      const snap = normalizer.normalizeAll(buildRaw({ ir: { 41: 43 } }), true, 10);
      expect(snap.trains[1].vitesse_kmh).toBe(43);
    });

    it('clamps speed to max bound (160 km/h)', () => {
      const snap = normalizer.normalizeAll(buildRaw({ ir: { 31: 999 } }), true, 10);
      expect(snap.trains[0].vitesse_kmh).toBe(160);
    });

    it('clamps speed to min bound (0)', () => {
      const snap = normalizer.normalizeAll(buildRaw({ ir: { 31: 0 } }), true, 10);
      expect(snap.trains[0].vitesse_kmh).toBe(0);
    });

    it('computes progression_norm correctly for min position', () => {
      const snap = normalizer.normalizeAll(buildRaw({ ir: { 32: 120 } }), true, 10);
      expect(snap.trains[0].progression_norm).toBe(0.0);
    });

    it('computes progression_norm correctly for max position', () => {
      const snap = normalizer.normalizeAll(buildRaw({ ir: { 32: 1960 } }), true, 10);
      expect(snap.trains[0].progression_norm).toBeCloseTo(1.0);
    });

    it('computes progression_norm for midpoint', () => {
      const snap = normalizer.normalizeAll(buildRaw({ ir: { 32: 1040 } }), true, 10);
      // (1040 - 120) / (1960 - 120) = 920/1840 = 0.5
      expect(snap.trains[0].progression_norm).toBeCloseTo(0.5);
    });

    it('converts tension from V to kV via scale 0.001', () => {
      const snap = normalizer.normalizeAll(buildRaw({ ir: { 33: 25000 } }), true, 10);
      expect(snap.trains[0].tension_kv).toBeCloseTo(25.0);
    });
  });

  // ── Train state derivation ────────────────────────────────
  describe('Train state derivation', () => {
    it('state=marche when train_en_marche=true, no alarms', () => {
      const snap = normalizer.normalizeAll(buildRaw({ di: { 14: true } }), true, 10);
      expect(snap.trains[0].etat_train).toBe('marche');
    });

    it('state=arret when train_en_marche=false, no alarms', () => {
      const snap = normalizer.normalizeAll(buildRaw({ di: { 14: false } }), true, 10);
      expect(snap.trains[0].etat_train).toBe('arret');
    });

    it('state=critique when alm_critique=true', () => {
      const snap = normalizer.normalizeAll(buildRaw({ di: { 28: true } }), true, 10);
      expect(snap.trains[0].etat_train).toBe('critique');
    });

    it('state=offline when quality=offline', () => {
      const snap = normalizer.normalizeAll(buildRaw(), false, -1);
      expect(snap.trains[0].etat_train).toBe('offline');
      expect(snap.trains[1].etat_train).toBe('offline');
    });
  });

  // ── Discrete inputs ───────────────────────────────────────
  describe('Discrete inputs', () => {
    it('reads signal_vert for DKR from DI15', () => {
      const snap = normalizer.normalizeAll(buildRaw({ di: { 15: true } }), true, 10);
      expect(snap.trains[0].signal_vert).toBe(true);
    });

    it('reads alm_tx2_temp_high from DI9', () => {
      const snap = normalizer.normalizeAll(buildRaw({ di: { 9: true } }), true, 10);
      expect(snap.energy.alm_tx2_temp_high).toBe(true);
    });

    it('reads alm_tx2_temp_crit from DI10', () => {
      const snap = normalizer.normalizeAll(buildRaw({ di: { 10: true } }), true, 10);
      expect(snap.energy.alm_tx2_temp_crit).toBe(true);
    });
  });

  // ── Energy normalization ──────────────────────────────────
  describe('Energy data', () => {
    it('reads TX2 oil temp from IR7', () => {
      const snap = normalizer.normalizeAll(buildRaw({ ir: { 7: 85 } }), true, 10);
      expect(snap.energy.tx2_oil_temp_c).toBe(85);
    });

    it('reads TX2 winding temp from IR8', () => {
      const snap = normalizer.normalizeAll(buildRaw({ ir: { 8: 102 } }), true, 10);
      expect(snap.energy.tx2_winding_temp_c).toBe(102);
    });
  });

  // ── Offline snapshot ──────────────────────────────────────
  describe('buildOfflineSnapshot()', () => {
    it('returns offline quality for all trains', () => {
      const snap = normalizer.buildOfflineSnapshot();
      expect(snap.plc_online).toBe(false);
      for (const t of snap.trains) {
        expect(t.qualite_donnee).toBe('offline');
        expect(t.etat_train).toBe('offline');
        expect(t.vitesse_kmh).toBe(0);
      }
    });

    it('has type=snapshot', () => {
      const snap = normalizer.buildOfflineSnapshot();
      expect(snap.type).toBe('snapshot');
    });
  });

  // ── Alarmes list ──────────────────────────────────────────
  describe('alarmes_actives', () => {
    it('is empty when no alarms', () => {
      const snap = normalizer.normalizeAll(buildRaw(), true, 10);
      expect(snap.trains[0].alarmes_actives).toHaveLength(0);
    });

    it('contains label when alm_critique active', () => {
      const snap = normalizer.normalizeAll(buildRaw({ di: { 28: true } }), true, 10);
      expect(snap.trains[0].alarmes_actives).toContain('Alarme critique');
    });

    it('accumulates multiple alarms', () => {
      const snap = normalizer.normalizeAll(
        buildRaw({ di: { 28: true, 29: true, 31: true } }),
        true, 10,
      );
      expect(snap.trains[0].alarmes_actives.length).toBeGreaterThanOrEqual(3);
    });

    it('detects SIV passenger information desynchronization for DKR', () => {
      const snap = normalizer.normalizeAll(
        buildRaw({ ir: { 60: 120, 61: 700, 62: 25, 66: 2 }, di: { 67: true } }),
        true,
        10,
      );

      expect(snap.trains[0].siv.actif).toBe(true);
      expect(snap.trains[0].siv.zone_annoncee).toBe('Gare de Dakar');
      expect(snap.trains[0].siv.retard_annonce_min).toBe(25);
      expect(snap.trains[0].etat_train).toBe('degrade');
      expect(snap.trains[0].alarmes_actives).toContain('Information voyageurs incohérente');
    });

    it('detects CTC switch deviation from command coil32 even if DI72 is not reflected', () => {
      const snap = normalizer.normalizeAll(
        buildRaw({ ir: { 70: 920, 71: 50, 72: 1040 }, di: { 72: false, 73: false, 74: false }, coils: { 32: true } }),
        true,
        10,
      );

      expect(snap.ctc.aiguille_deviee).toBe(true);
      expect(snap.ctc.alm_aiguille).toBe(true);
      expect(snap.ctc.risk_level).toBe(50);
      expect(snap.ctc.collision_position_plc).toBe(1040);
      expect(snap.ctc.distance_km).toBeCloseTo(18.0);
    });

    it('keeps CTC collision alarm from DI74', () => {
      const snap = normalizer.normalizeAll(
        buildRaw({ ir: { 70: 40, 71: 98 }, di: { 72: true, 73: true, 74: true }, coils: { 32: true } }),
        true,
        10,
      );

      expect(snap.ctc.aiguille_deviee).toBe(true);
      expect(snap.ctc.alm_collision).toBe(true);
      expect(snap.ctc.risk_level).toBe(98);
    });

    it('does not derive CTC collision from risk alone before physical impact', () => {
      const snap = normalizer.normalizeAll(
        buildRaw({ ir: { 70: 92, 71: 95 }, di: { 72: false, 73: false, 74: false }, coils: { 32: true } }),
        true,
        10,
      );

      expect(snap.ctc.aiguille_deviee).toBe(true);
      expect(snap.ctc.alm_collision).toBe(false);
    });

    it('derives CTC collision only when the PLC distance is effectively zero', () => {
      const snap = normalizer.normalizeAll(
        buildRaw({ ir: { 70: 1, 71: 100 }, di: { 72: false, 73: false, 74: false }, coils: { 32: true } }),
        true,
        10,
      );

      expect(snap.ctc.aiguille_deviee).toBe(true);
      expect(snap.ctc.alm_collision).toBe(true);
    });
  });
});
