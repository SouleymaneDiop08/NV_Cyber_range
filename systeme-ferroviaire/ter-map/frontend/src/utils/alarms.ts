import type { TrainData, EnergyData, AlarmEvent, TrainId } from '../types/index.js';

let _alarmCounter = 0;

function makeId(): string {
  return `alm-${Date.now()}-${_alarmCounter++}`;
}

export function extractAlarmEvents(
  trains: TrainData[],
  energy: EnergyData,
  existingAlarms: AlarmEvent[],
): AlarmEvent[] {
  const now = new Date().toISOString();
  const newAlarms: AlarmEvent[] = [];

  const existingCodes = new Set(
    existingAlarms.filter(a => !a.cleared).map(a => `${a.train_id}:${a.code}`)
  );

  function addAlarm(
    trainId: TrainId | 'SYSTEM' | 'ENERGY',
    severity: AlarmEvent['severity'],
    code: string,
    message: string,
  ): void {
    const key = `${trainId}:${code}`;
    if (!existingCodes.has(key)) {
      newAlarms.push({
        id: makeId(),
        timestamp: now,
        train_id: trainId,
        severity,
        code,
        message,
        cleared: false,
      });
    }
  }

  // ── Train alarms ──────────────────────────────────────────
  for (const train of trains) {
    if (train.qualite_donnee === 'offline') {
      addAlarm(train.train_id, 'critical', 'OFFLINE', `${train.label} — Perte communication PLC`);
      continue;
    }
    if (train.qualite_donnee === 'stale') {
      addAlarm(train.train_id, 'warning', 'STALE', `${train.label} — Données expirées`);
    }
    if (train.alm_critique) {
      addAlarm(train.train_id, 'critical', 'ALM_CRITIQUE', `${train.label} — Alarme critique active`);
    }
    if (train.alm_tension_basse) {
      addAlarm(train.train_id, 'critical', 'ALM_TENSION', `${train.label} — Tension caténaire basse`);
    }
    if (train.alm_transfo_chaud) {
      addAlarm(train.train_id, 'warning', 'ALM_TRANSFO_HOT', `${train.label} — Transformateur surchauffé`);
    }
    if (train.alm_surcharge) {
      addAlarm(train.train_id, 'warning', 'ALM_SURCHARGE', `${train.label} — Surcharge traction`);
    }
    if (train.alm_commande_anormale) {
      addAlarm(train.train_id, 'warning', 'ALM_CMD_ANOM', `${train.label} — Commande anormale détectée`);
    }
    if (!train.signal_vert && train.etat_train !== 'offline') {
      addAlarm(train.train_id, 'warning', 'SIGNAL_ROUGE', `${train.label} — Signal rouge`);
    }
  }

  // ── Energy alarms ─────────────────────────────────────────
  if (energy.alm_tx2_temp_crit) {
    addAlarm('ENERGY', 'critical', 'TX2_TEMP_CRIT', 'TX2 — Température critique → Trip transformateur');
  } else if (energy.alm_tx2_temp_high) {
    addAlarm('ENERGY', 'warning', 'TX2_TEMP_HIGH', 'TX2 — Température haute (ralentissement trains)');
  }
  if (energy.alm_fdr2_surcharge) {
    addAlarm('ENERGY', 'critical', 'FDR2_SURCHARGE', 'Feeder 2 — Surcharge détectée');
  }
  if (energy.alm_fdr2_desequilibre) {
    addAlarm('ENERGY', 'warning', 'FDR2_DESEQUIL', 'Feeder 2 — Déséquilibre triphasé');
  }

  return newAlarms;
}

// Clear alarms that are no longer active
export function clearResolvedAlarms(
  alarms: AlarmEvent[],
  trains: TrainData[],
  energy: EnergyData,
): AlarmEvent[] {
  return alarms.map(alarm => {
    if (alarm.cleared) return alarm;

    const train = trains.find(t => t.train_id === alarm.train_id);

    switch (alarm.code) {
      case 'OFFLINE':
        return { ...alarm, cleared: train?.qualite_donnee !== 'offline' };
      case 'STALE':
        return { ...alarm, cleared: train?.qualite_donnee === 'ok' };
      case 'ALM_CRITIQUE':
        return { ...alarm, cleared: !train?.alm_critique };
      case 'ALM_TENSION':
        return { ...alarm, cleared: !train?.alm_tension_basse };
      case 'ALM_TRANSFO_HOT':
        return { ...alarm, cleared: !train?.alm_transfo_chaud };
      case 'ALM_SURCHARGE':
        return { ...alarm, cleared: !train?.alm_surcharge };
      case 'TX2_TEMP_CRIT':
        return { ...alarm, cleared: !energy.alm_tx2_temp_crit };
      case 'TX2_TEMP_HIGH':
        return { ...alarm, cleared: !energy.alm_tx2_temp_high };
      case 'FDR2_SURCHARGE':
        return { ...alarm, cleared: !energy.alm_fdr2_surcharge };
      default:
        return alarm;
    }
  });
}

export function getAlarmSeverityColor(severity: AlarmEvent['severity'], theme: 'light' | 'dark'): string {
  if (theme === 'dark') {
    switch (severity) {
      case 'critical': return '#FF4444';
      case 'warning':  return '#F5A623';
      case 'info':     return '#2EC5A4';
    }
  }
  switch (severity) {
    case 'critical': return '#D32F2F';
    case 'warning':  return '#F57C00';
    case 'info':     return '#0288D1';
  }
}

export function countActiveAlarms(alarms: AlarmEvent[]): Record<AlarmEvent['severity'], number> {
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const a of alarms) {
    if (!a.cleared) counts[a.severity]++;
  }
  return counts;
}
