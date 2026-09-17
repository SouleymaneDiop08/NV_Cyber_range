// ============================================================
// TER MAP — Geo Utilities
// - PLC position → normalized → lat/lon on route polyline
// - Great-circle distance, collision detection
// ============================================================

import { STATIONS, ROUTE_POINTS, LINE_LENGTH_KM, PLC_POS_MIN, PLC_POS_MAX } from '../constants/stations.js';
import type { LatLon, CollisionStatus } from '../types/index.js';

// ── Haversine distance (km) ──────────────────────────────────
export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLon * sinDLon;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// ── Build cumulative distance table along ROUTE_POINTS ───────
// Uses pk_km spacing from ROUTE_POINTS so interpolation matches
// the declared kilometre markers exactly.
interface RouteSegment {
  from: LatLon;
  to: LatLon;
  cumDistFrom: number;  // cumulative km at start of segment
  segLen: number;        // segment length in km (from pk_km diff)
}

let _segments: RouteSegment[] | null = null;
let _totalRouteKm = 0;

function buildSegments(): RouteSegment[] {
  if (_segments) return _segments;

  _segments = [];
  let cumDist = 0;

  for (let i = 0; i < ROUTE_POINTS.length - 1; i++) {
    const from: LatLon = { lat: ROUTE_POINTS[i].lat, lon: ROUTE_POINTS[i].lon };
    const to: LatLon   = { lat: ROUTE_POINTS[i + 1].lat, lon: ROUTE_POINTS[i + 1].lon };
    const segLen = ROUTE_POINTS[i + 1].pk_km - ROUTE_POINTS[i].pk_km;

    _segments.push({ from, to, cumDistFrom: cumDist, segLen });
    cumDist += segLen;
  }

  _totalRouteKm = cumDist; // 36.0
  return _segments;
}

export function getRouteLengthKm(): number {
  buildSegments();
  return _totalRouteKm || LINE_LENGTH_KM;
}

// ── PLC position → normalized [0,1] ─────────────────────────
export function plcToNorm(plcPos: number): number {
  const clamped = Math.max(PLC_POS_MIN, Math.min(PLC_POS_MAX, plcPos));
  return (clamped - PLC_POS_MIN) / (PLC_POS_MAX - PLC_POS_MIN);
}

// ── normalized [0,1] → km along route ───────────────────────
export function normToKm(t: number): number {
  return t * getRouteLengthKm();
}

// ── km along route → lat/lon (linear interpolation) ─────────
export function kmToLatLon(distKm: number): LatLon {
  const segs = buildSegments();
  if (segs.length === 0) return { lat: STATIONS[0].lat, lon: STATIONS[0].lon };

  // Clamp to route bounds
  const clamped = Math.max(0, Math.min(distKm, _totalRouteKm));

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const segEnd = seg.cumDistFrom + seg.segLen;

    if (clamped <= segEnd || i === segs.length - 1) {
      const t = seg.segLen > 0
        ? Math.max(0, Math.min(1, (clamped - seg.cumDistFrom) / seg.segLen))
        : 0;

      return {
        lat: seg.from.lat + t * (seg.to.lat - seg.from.lat),
        lon: seg.from.lon + t * (seg.to.lon - seg.from.lon),
      };
    }
  }

  // Fallback: last station
  const last = STATIONS[STATIONS.length - 1];
  return { lat: last.lat, lon: last.lon };
}

// ── PLC position → lat/lon (one-shot) ───────────────────────
export function plcPosToLatLon(plcPos: number): LatLon {
  const norm = plcToNorm(plcPos);
  const km = normToKm(norm);
  return kmToLatLon(km);
}

// ── PLC position → visible track lat/lon ─────────────────────
// The base route is the center line. The UI offsets trains on two
// visual tracks; when CTC is deviated, DKR is shown on DMD's track
// after the Pikine switch point.
export function plcPosToTrackLatLon(
  plcPos: number,
  track: 'DKR' | 'DMD' | 'CENTER' = 'CENTER',
): LatLon {
  const base = plcPosToLatLon(plcPos);
  if (track === 'DKR') return { lat: base.lat + 0.0004, lon: base.lon };
  if (track === 'DMD') return { lat: base.lat - 0.0004, lon: base.lon };
  return base;
}

// ── Nearest station to a normalized position ────────────────
export function nearestStation(normPos: number): typeof STATIONS[0] {
  const km = normToKm(normPos);
  let best = STATIONS[0];
  let bestDist = Infinity;

  for (const s of STATIONS) {
    const sKm = (s.pk_km / LINE_LENGTH_KM) * getRouteLengthKm();
    const d = Math.abs(sKm - km);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }

  return best;
}

// ── Collision detection between two trains ───────────────────
//
// Règle opérationnelle TER (voie double virtuelle) :
//   • Sens OPPOSÉS (normal) → les trains se croisent sans risque,
//     SAUF si l'un d'eux est en alarme critique (mauvaise voie simulée).
//   • Même SENS → risque classique de rattrapage (scénario d'attaque
//     où un train décélère/s'arrête et l'autre le rattrape).
//
// dirA / dirB : +1 = Dakar→Diamniadio, -1 = Diamniadio→Dakar, 0 = arrêté.
// hasAlarmA/B : true si alarme critique active sur ce train.

const COLLISION_WARNING_KM  = 2.0;  // jaune
const COLLISION_DANGER_KM   = 0.5;  // rouge
const HEADON_DANGER_KM      = 0.3;  // front-à-front (voie anormale)

export function detectCollision(
  normA: number,
  speedA_kmh: number,
  normB: number,
  speedB_kmh: number,
  dirA: number = 1,
  dirB: number = -1,
  hasAlarmA: boolean = false,
  hasAlarmB: boolean = false,
): CollisionStatus {
  const kmA = normToKm(normA);
  const kmB = normToKm(normB);
  const posA = kmToLatLon(kmA);
  const posB = kmToLatLon(kmB);

  const distance_km = haversineKm(posA, posB);
  const midKm = (kmA + kmB) / 2;
  const midPos = kmToLatLon(midKm);

  const sameDirection = (dirA !== 0 && dirB !== 0) && (dirA === dirB);
  const eitherHasAlarm = hasAlarmA || hasAlarmB;

  let risk: CollisionStatus['risk'] = 'none';
  let ttc_s: number | null = null;
  let relativeSpeed = 0;

  if (sameDirection) {
    // ── Scénario d'attaque : rattrapage par l'arrière ─────────
    // Le train de derrière rattrape le train de devant
    const ahead  = kmA > kmB ? { km: kmA, spd: speedA_kmh } : { km: kmB, spd: speedB_kmh };
    const behind = kmA > kmB ? { km: kmB, spd: speedB_kmh } : { km: kmA, spd: speedA_kmh };
    relativeSpeed = Math.max(0, behind.spd - ahead.spd);

    if (relativeSpeed > 0.5 && distance_km > 0) {
      ttc_s = (distance_km / relativeSpeed) * 3600;
    }

    if (distance_km < COLLISION_DANGER_KM) {
      risk = 'danger';
    } else if (distance_km < COLLISION_WARNING_KM && relativeSpeed > 5) {
      risk = 'warning';
    }
  } else {
    // ── Sens opposés : voie double — pas de risque en opération normale ──
    // Exception : si alarme active ET très proches (train sur mauvaise voie)
    if (eitherHasAlarm && distance_km < HEADON_DANGER_KM) {
      risk = 'danger';
      relativeSpeed = speedA_kmh + speedB_kmh;  // vitesse de fermeture frontale
      if (relativeSpeed > 0) {
        ttc_s = (distance_km / relativeSpeed) * 3600;
      }
    } else if (eitherHasAlarm && distance_km < COLLISION_WARNING_KM) {
      risk = 'warning';
      relativeSpeed = speedA_kmh + speedB_kmh;
    }
    // Sans alarme : risk = 'none' — trains se croisent normalement
  }

  return {
    risk,
    distance_km,
    relative_speed_kmh: relativeSpeed,
    ttc_s,
    lat: midPos.lat,
    lon: midPos.lon,
  };
}

// ── Interpolate position smoothly between two snapshots ─────
export function interpolatePosition(
  fromNorm: number,
  toNorm: number,
  t: number,             // 0.0 → 1.0
): number {
  return fromNorm + (toNorm - fromNorm) * Math.min(1, Math.max(0, t));
}

// ── Format distance for display ─────────────────────────────
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

// ── Estimate TTC display string ──────────────────────────────
export function formatTTC(seconds: number | null): string {
  if (seconds === null) return '–';
  if (seconds < 30) return `${Math.round(seconds)}s`;
  if (seconds < 120) return `${Math.round(seconds)}s`;
  return `${Math.round(seconds / 60)} min`;
}
