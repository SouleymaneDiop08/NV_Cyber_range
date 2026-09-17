import { Router, Request, Response } from 'express';
import type { SystemSnapshot } from '../types/index.js';
import type { ModbusTCPClient } from '../modbus/client.js';

// ── Setpoint map (MW offset = 1024) ──────────────────────────
// Each entry describes the Modbus address and allowed range.
interface SetpointDef {
  type: 'hr' | 'coil';
  addr: number;
  min: number;
  max: number;
}

const SETPOINT_MAP: Record<string, SetpointDef> = {
  dkr_vitesse_max:      { type: 'hr',   addr: 1026, min: 0, max: 160  },  // %MW2
  dkr_courant_max:      { type: 'hr',   addr: 1027, min: 0, max: 1200 },  // %MW3
  dkr_demande_traction: { type: 'hr',   addr: 1029, min: 0, max: 120  },  // %MW5
  dmd_vitesse_max:      { type: 'hr',   addr: 1047, min: 0, max: 160  },  // %MW23
  dmd_courant_max:      { type: 'hr',   addr: 1048, min: 0, max: 1200 },  // %MW24
  dmd_demande_traction: { type: 'hr',   addr: 1050, min: 0, max: 120  },  // %MW26
  dkr_arret_urgence:    { type: 'coil', addr: 19,   min: 0, max: 1    },  // %QX2.3
  dmd_arret_urgence:    { type: 'coil', addr: 27,   min: 0, max: 1    },  // %QX3.3
  siv_position_publiee_dkr: { type: 'hr', addr: 1084, min: 120, max: 1960 }, // %MW60
  siv_retard_publie_dkr:    { type: 'hr', addr: 1085, min: 0,   max: 120  }, // %MW61
  siv_position_publiee_dmd: { type: 'hr', addr: 1086, min: 120, max: 1960 }, // %MW62
  siv_retard_publie_dmd:    { type: 'hr', addr: 1087, min: 0,   max: 120  }, // %MW63
  siv_source_etat:          { type: 'hr', addr: 1088, min: 0,   max: 2    }, // %MW64
};

// HR setpoints only (for GET /api/setpoints batch read)
const HR_SETPOINTS = Object.entries(SETPOINT_MAP)
  .filter(([, def]) => def.type === 'hr')
  .map(([name, def]) => ({ name, addr: def.addr }));

export function createApiRouter(
  getSnapshot: () => SystemSnapshot | null,
  getPollerStatus: () => { isStale: boolean; isOffline: boolean; dataAgeMs: number },
  modbusClient?: ModbusTCPClient,
): Router {
  const router = Router();
  const writeEnabled = String(process.env.MODBUS_WRITE_ENABLED ?? 'false').toLowerCase() === 'true';

  // ── GET /api/health ──────────────────────────────────────
  router.get('/health', (_req: Request, res: Response) => {
    const status = getPollerStatus();
    res.json({
      status: status.isOffline ? 'offline' : status.isStale ? 'stale' : 'ok',
      plc_online: !status.isOffline,
      data_age_ms: status.dataAgeMs,
      timestamp: new Date().toISOString(),
    });
  });

  // ── GET /api/snapshot ────────────────────────────────────
  router.get('/snapshot', (_req: Request, res: Response) => {
    const snap = getSnapshot();
    if (!snap) {
      res.status(503).json({
        error: 'No data available yet',
        hint: 'PLC may be offline or polling not started',
      });
      return;
    }
    res.json(snap);
  });

  // ── GET /api/trains ──────────────────────────────────────
  router.get('/trains', (_req: Request, res: Response) => {
    const snap = getSnapshot();
    if (!snap) {
      res.status(503).json({ error: 'No data available' });
      return;
    }
    res.json(snap.trains);
  });

  // ── GET /api/trains/:id ──────────────────────────────────
  router.get('/trains/:id', (req: Request, res: Response) => {
    const snap = getSnapshot();
    if (!snap) {
      res.status(503).json({ error: 'No data available' });
      return;
    }
    const train = snap.trains.find(t => t.train_id === req.params.id?.toUpperCase());
    if (!train) {
      res.status(404).json({ error: `Train not found: ${req.params.id}` });
      return;
    }
    res.json(train);
  });

  // ── GET /api/energy ──────────────────────────────────────
  router.get('/energy', (_req: Request, res: Response) => {
    const snap = getSnapshot();
    if (!snap) {
      res.status(503).json({ error: 'No data available' });
      return;
    }
    res.json(snap.energy);
  });

  // ── GET /api/status ──────────────────────────────────────
  router.get('/status', (_req: Request, res: Response) => {
    const snap = getSnapshot();
    const status = getPollerStatus();
    res.json({
      plc_online: snap?.plc_online ?? false,
      data_quality: status.isOffline ? 'offline' : status.isStale ? 'stale' : 'ok',
      data_age_ms: status.dataAgeMs,
      last_poll: snap?.last_poll ?? null,
      poll_latency_ms: snap?.poll_latency_ms ?? -1,
      active_alarms: snap?.trains.reduce((acc, t) => acc + t.alarmes_actives.length, 0) ?? 0,
    });
  });

  // ── POST /api/setpoint ────────────────────────────────────
  // Body: { register: string, value: number }
  router.post('/setpoint', async (req: Request, res: Response) => {
    if (!writeEnabled) {
      res.status(403).json({
        error: 'Write operations disabled (read-only mode)',
        hint: 'Set MODBUS_WRITE_ENABLED=true to allow Modbus writes',
      });
      return;
    }

    if (!modbusClient) {
      res.status(503).json({ error: 'Modbus client not available' });
      return;
    }

    const { register, value } = req.body as { register?: string; value?: number };

    if (typeof register !== 'string' || register === '') {
      res.status(400).json({ error: 'Missing or invalid "register" field' });
      return;
    }

    if (typeof value !== 'number' || isNaN(value)) {
      res.status(400).json({ error: 'Missing or invalid "value" field (must be number)' });
      return;
    }

    const def = SETPOINT_MAP[register];
    if (!def) {
      res.status(400).json({
        error: `Unknown register: ${register}`,
        available: Object.keys(SETPOINT_MAP),
      });
      return;
    }

    if (value < def.min || value > def.max) {
      res.status(400).json({
        error: `Value ${value} out of range [${def.min}, ${def.max}] for ${register}`,
      });
      return;
    }

    try {
      if (def.type === 'hr') {
        await modbusClient.writeHR(def.addr, Math.round(value));
      } else {
        await modbusClient.writeCoil(def.addr, value !== 0);
      }
      res.json({
        ok: true,
        register,
        addr: def.addr,
        type: def.type,
        value: def.type === 'coil' ? value !== 0 : Math.round(value),
        written_at: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `Modbus write failed: ${msg}` });
    }
  });

  // ── GET /api/setpoints ────────────────────────────────────
  // Returns current values of all HR setpoints (FC03).
  router.get('/setpoints', async (_req: Request, res: Response) => {
    if (!modbusClient) {
      res.status(503).json({ error: 'Modbus client not available' });
      return;
    }

    try {
      // Read each HR setpoint individually (addresses are non-contiguous)
      const values: Record<string, number> = {};
      for (const { name, addr } of HR_SETPOINTS) {
        const data = await modbusClient.readHR(addr, 1);
        values[name] = data[addr] ?? 0;
      }
      res.json({
        setpoints: values,
        read_at: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `Modbus read failed: ${msg}` });
    }
  });

  return router;
}
