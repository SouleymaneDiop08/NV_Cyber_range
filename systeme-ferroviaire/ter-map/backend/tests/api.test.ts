import request from 'supertest';
import express from 'express';
import { createApiRouter } from '../src/api/routes';
import type { SystemSnapshot } from '../src/types/index';

function buildMockSnapshot(): SystemSnapshot {
  const now = new Date().toISOString();
  return {
    type: 'snapshot',
    plc_online: true,
    last_poll: now,
    poll_latency_ms: 8,
    trains: [
      {
        train_id: 'DKR',
        label: 'Train DKR',
        direction: 'Dakar → Diamniadio',
        color: '#2EC5A4',
        vitesse_kmh: 72,
        progression_plc: 820,
        progression_norm: 0.38,
        id_gare: 10,
        tension_kv: 25.0,
        courant_a: 620,
        temp_transfo_c: 55,
        etat_train: 'marche',
        signal_vert: true,
        signal_rouge: false,
        catenaire_ok: true,
        mode_degrade: false,
        train_en_marche: true,
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
          position_annoncee_plc: 820,
          progression_annoncee_norm: 0.38,
          zone_annoncee: 'Pikine',
          ecart_position: 0,
          retard_annonce_min: 0,
          niveau_desinformation: 0,
          message: 'SIV cohérent avec la position réelle',
        },
        qualite_donnee: 'ok',
        updated_at: now,
      },
      {
        train_id: 'DMD',
        label: 'Train DMD',
        direction: 'Diamniadio → Dakar',
        color: '#F5A623',
        vitesse_kmh: 88,
        progression_plc: 1200,
        progression_norm: 0.59,
        id_gare: 20,
        tension_kv: 25.0,
        courant_a: 680,
        temp_transfo_c: 58,
        etat_train: 'marche',
        signal_vert: true,
        signal_rouge: false,
        catenaire_ok: true,
        mode_degrade: false,
        train_en_marche: true,
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
          position_annoncee_plc: 1200,
          progression_annoncee_norm: 0.59,
          zone_annoncee: 'Keur Mbaye Fall',
          ecart_position: 0,
          retard_annonce_min: 0,
          niveau_desinformation: 0,
          message: 'SIV cohérent avec la position réelle',
        },
        qualite_donnee: 'ok',
        updated_at: now,
      },
    ],
    energy: {
      tx1_oil_temp_c: 65,
      tx1_winding_temp_c: 72,
      tx2_oil_temp_c: 70,
      tx2_winding_temp_c: 78,
      tx2_output_voltage_kv: 20,
      alm_fdr2_surcharge: false,
      alm_fdr2_desequilibre: false,
      alm_tx2_temp_high: false,
      alm_tx2_temp_crit: false,
      qualite_donnee: 'ok',
      updated_at: now,
    },
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
  };
}

function buildApp(snapshot: SystemSnapshot | null = buildMockSnapshot()) {
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter(
    () => snapshot,
    () => ({ isStale: false, isOffline: false, dataAgeMs: 100 }),
  ));
  return app;
}

describe('GET /api/health', () => {
  it('returns 200 with status ok when data available', async () => {
    const res = await request(buildApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.plc_online).toBe(true);
  });

  it('returns status=stale when data is stale', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(
      () => buildMockSnapshot(),
      () => ({ isStale: true, isOffline: false, dataAgeMs: 5000 }),
    ));
    const res = await request(app).get('/api/health');
    expect(res.body.status).toBe('stale');
  });

  it('returns status=offline when PLC offline', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(
      () => buildMockSnapshot(),
      () => ({ isStale: true, isOffline: true, dataAgeMs: 15000 }),
    ));
    const res = await request(app).get('/api/health');
    expect(res.body.status).toBe('offline');
  });
});

describe('GET /api/snapshot', () => {
  it('returns 200 with snapshot', async () => {
    const res = await request(buildApp()).get('/api/snapshot');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('snapshot');
    expect(res.body.trains).toHaveLength(2);
  });

  it('returns 503 when no data available', async () => {
    const res = await request(buildApp(null)).get('/api/snapshot');
    expect(res.status).toBe(503);
  });
});

describe('GET /api/trains', () => {
  it('returns array of 2 trains', async () => {
    const res = await request(buildApp()).get('/api/trains');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
  });
});

describe('GET /api/trains/:id', () => {
  it('returns DKR train data', async () => {
    const res = await request(buildApp()).get('/api/trains/DKR');
    expect(res.status).toBe(200);
    expect(res.body.train_id).toBe('DKR');
    expect(res.body.vitesse_kmh).toBe(72);
  });

  it('returns 404 for unknown train', async () => {
    const res = await request(buildApp()).get('/api/trains/XYZ');
    expect(res.status).toBe(404);
  });

  it('is case-insensitive for train id', async () => {
    const res = await request(buildApp()).get('/api/trains/dkr');
    expect(res.status).toBe(200);
    expect(res.body.train_id).toBe('DKR');
  });
});

describe('GET /api/energy', () => {
  it('returns energy data', async () => {
    const res = await request(buildApp()).get('/api/energy');
    expect(res.status).toBe(200);
    expect(res.body.tx2_oil_temp_c).toBe(70);
    expect(res.body.alm_tx2_temp_crit).toBe(false);
  });
});

describe('GET /api/status', () => {
  it('returns system status with active_alarms count', async () => {
    const res = await request(buildApp()).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('plc_online');
    expect(res.body).toHaveProperty('data_quality');
    expect(res.body).toHaveProperty('active_alarms');
    expect(typeof res.body.active_alarms).toBe('number');
  });
});
