import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { PlcMappingConfig, PlcConfig } from '../types/index.js';

// Resolve env variable references in YAML values like ${PLC_B_HOST}
function resolveEnvRefs(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? _);
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvRefs);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = resolveEnvRefs(v);
    }
    return result;
  }
  return obj;
}

let _config: PlcMappingConfig | null = null;

export function loadPlcMapping(): PlcMappingConfig {
  if (_config) return _config;

  // Look for config in multiple locations
  const candidates = [
    path.resolve(process.cwd(), '../../config/plc-mapping.yaml'),
    path.resolve(process.cwd(), '../config/plc-mapping.yaml'),
    path.resolve(process.cwd(), 'config/plc-mapping.yaml'),
    path.resolve(__dirname, '../../../../config/plc-mapping.yaml'),
  ];

  let raw: string | null = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      raw = fs.readFileSync(p, 'utf8');
      break;
    }
  }

  if (!raw) {
    // Fall back to embedded defaults
    console.warn('[Config] plc-mapping.yaml not found, using embedded defaults');
    _config = buildDefaultConfig();
    return _config;
  }

  const parsed = yaml.load(raw) as PlcMappingConfig;
  _config = resolveEnvRefs(parsed) as PlcMappingConfig;

  // Override PLC host/port from env if set
  const plcB = _config.plcs['station_b'];
  if (plcB) {
    plcB.host = process.env.PLC_B_HOST ?? plcB.host;
    plcB.port = parseInt(process.env.PLC_B_PORT ?? String(plcB.port), 10);
    plcB.unit_id = parseInt(process.env.PLC_B_UNIT_ID ?? String(plcB.unit_id), 10);
  }

  return _config;
}

export function getPlcConfig(plcId: string): PlcConfig {
  const cfg = loadPlcMapping();
  const plc = cfg.plcs[plcId];
  if (!plc) throw new Error(`PLC config not found: ${plcId}`);
  return plc;
}

function buildDefaultConfig(): PlcMappingConfig {
  return {
    plcs: {
      station_b: {
        id: 'station_b',
        label: 'Station B',
        host: process.env.PLC_B_HOST ?? '192.168.20.10',
        port: parseInt(process.env.PLC_B_PORT ?? '502', 10),
        unit_id: parseInt(process.env.PLC_B_UNIT_ID ?? '1', 10),
      },
    },
    trains: {} as PlcMappingConfig['trains'],
    energy: {} as PlcMappingConfig['energy'],
    position_mapping: { plc_min: 120, plc_max: 1960, line_length_km: 36.0 },
  };
}
