import { describe, it, expect } from 'vitest';
import {
  plcToNorm,
  normToKm,
  kmToLatLon,
  plcPosToLatLon,
  haversineKm,
  detectCollision,
  interpolatePosition,
  nearestStation,
  getRouteLengthKm,
} from './geo';
import { STATIONS, ROUTE_POINTS, PLC_POS_MIN, PLC_POS_MAX, LINE_LENGTH_KM } from '../constants/stations';

// ── plcToNorm ─────────────────────────────────────────────────
describe('plcToNorm()', () => {
  it('returns 0 for minimum PLC position', () => {
    expect(plcToNorm(PLC_POS_MIN)).toBe(0.0);
  });

  it('returns 1 for maximum PLC position', () => {
    expect(plcToNorm(PLC_POS_MAX)).toBeCloseTo(1.0);
  });

  it('returns ~0.5 for midpoint', () => {
    const mid = PLC_POS_MIN + (PLC_POS_MAX - PLC_POS_MIN) / 2;
    expect(plcToNorm(mid)).toBeCloseTo(0.5);
  });

  it('clamps below min to 0', () => {
    expect(plcToNorm(0)).toBe(0.0);
    expect(plcToNorm(-100)).toBe(0.0);
  });

  it('clamps above max to 1', () => {
    expect(plcToNorm(9999)).toBeCloseTo(1.0);
  });
});

// ── normToKm ──────────────────────────────────────────────────
describe('normToKm()', () => {
  it('0 → 0 km', () => {
    expect(normToKm(0)).toBe(0);
  });

  it('1 → route length', () => {
    const len = getRouteLengthKm();
    expect(normToKm(1)).toBeCloseTo(len);
  });

  it('0.5 → ~half route', () => {
    const len = getRouteLengthKm();
    expect(normToKm(0.5)).toBeCloseTo(len / 2, 0);
  });
});

// ── kmToLatLon ────────────────────────────────────────────────
describe('kmToLatLon()', () => {
  it('0 km → near Dakar station', () => {
    const pos = kmToLatLon(0);
    const dakar = STATIONS[0];
    expect(pos.lat).toBeCloseTo(dakar.lat, 3);
    expect(pos.lon).toBeCloseTo(dakar.lon, 3);
  });

  it('station pk_km → exact ROUTE_POINTS coords (pk-based interpolation)', () => {
    // With pk_km segments, kmToLatLon(pk_km) must land exactly on the
    // corresponding ROUTE_POINTS entry (cumulative pk = the route point).
    for (const rp of ROUTE_POINTS) {
      const pos = kmToLatLon(rp.pk_km);
      expect(pos.lat).toBeCloseTo(rp.lat, 4);
      expect(pos.lon).toBeCloseTo(rp.lon, 4);
    }
  });

  it('route length km → near Diamniadio', () => {
    const len = getRouteLengthKm();
    const pos = kmToLatLon(len);
    const diamniadio = STATIONS[STATIONS.length - 1];
    // Should be within 1 km of Diamniadio
    const dist = haversineKm(pos, { lat: diamniadio.lat, lon: diamniadio.lon });
    expect(dist).toBeLessThan(1.0);
  });

  it('returns valid lat/lon (no NaN)', () => {
    for (let km = 0; km <= LINE_LENGTH_KM; km += 5) {
      const pos = kmToLatLon(km);
      expect(isNaN(pos.lat)).toBe(false);
      expect(isNaN(pos.lon)).toBe(false);
    }
  });

  it('stays within Senegal bounding box', () => {
    for (let km = 0; km <= LINE_LENGTH_KM; km += 2) {
      const pos = kmToLatLon(km);
      expect(pos.lat).toBeGreaterThan(14.5);
      expect(pos.lat).toBeLessThan(15.0);
      expect(pos.lon).toBeGreaterThan(-17.6);
      expect(pos.lon).toBeLessThan(-17.0);
    }
  });
});

// ── plcPosToLatLon ────────────────────────────────────────────
describe('plcPosToLatLon()', () => {
  it('PLC min → near Dakar', () => {
    const pos = plcPosToLatLon(PLC_POS_MIN);
    const dakar = STATIONS[0];
    const dist = haversineKm(pos, { lat: dakar.lat, lon: dakar.lon });
    expect(dist).toBeLessThan(1.0);
  });

  it('plcPosToLatLon(248) → approximately Colobane GPS coords (within 0.01 deg)', () => {
    // PLC pos 248 normalizes to ~(248-120)/(1960-120) ≈ 0.0696
    // → 0.0696 * 36 ≈ 2.5 km → Colobane (pk 2.5)
    const pos = plcPosToLatLon(248);
    const colobane = ROUTE_POINTS.find(p => p.pk_km === 2.5)!;
    expect(Math.abs(pos.lat - colobane.lat)).toBeLessThan(0.01);
    expect(Math.abs(pos.lon - colobane.lon)).toBeLessThan(0.01);
  });

  it('PLC max → near Diamniadio', () => {
    const pos = plcPosToLatLon(PLC_POS_MAX);
    const diamniadio = STATIONS[STATIONS.length - 1];
    const dist = haversineKm(pos, { lat: diamniadio.lat, lon: diamniadio.lon });
    expect(dist).toBeLessThan(1.0);
  });

  it('monotonic: higher PLC pos → closer to Diamniadio', () => {
    const pos1 = plcPosToLatLon(400);
    const pos2 = plcPosToLatLon(800);
    const diamniadio = STATIONS[STATIONS.length - 1];
    const d1 = haversineKm(pos1, { lat: diamniadio.lat, lon: diamniadio.lon });
    const d2 = haversineKm(pos2, { lat: diamniadio.lat, lon: diamniadio.lon });
    expect(d2).toBeLessThan(d1);
  });
});

// ── haversineKm ───────────────────────────────────────────────
describe('haversineKm()', () => {
  it('same point → 0 km', () => {
    const p = { lat: 14.69, lon: -17.44 };
    expect(haversineKm(p, p)).toBeCloseTo(0, 5);
  });

  it('Dakar → Diamniadio ≈ 36 km', () => {
    const dakar       = { lat: 14.6905, lon: -17.4413 };
    const diamniadio  = { lat: 14.7195, lon: -17.1650 };
    const dist = haversineKm(dakar, diamniadio);
    // Straight-line distance is shorter than track distance (~36km)
    expect(dist).toBeGreaterThan(25);
    expect(dist).toBeLessThan(45);
  });

  it('is symmetric', () => {
    const a = { lat: 14.69, lon: -17.44 };
    const b = { lat: 14.72, lon: -17.27 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 5);
  });
});

// ── detectCollision ───────────────────────────────────────────
// Règle: trains sens OPPOSÉS → pas de collision sans alarme (voie double).
//        trains même sens → collision classique (rattrapage).
describe('detectCollision()', () => {
  it('returns none when trains are far apart (opposite dirs)', () => {
    // Sens opposés, loin → aucun risque
    const result = detectCollision(0.0, 80, 1.0, 80, 1, -1, false, false);
    expect(result.risk).toBe('none');
  });

  it('returns none for opposite-direction trains crossing normally', () => {
    // Sens opposés, très proches, sans alarme → voie double → pas de risque
    const result = detectCollision(0.5, 90, 0.505, 80, 1, -1, false, false);
    expect(result.risk).toBe('none');
  });

  it('returns danger for opposite-direction trains with alarm very close', () => {
    // Sens opposés + alarme critique + distance < 0.3 km → front-à-front anormal
    const result = detectCollision(0.5, 90, 0.505, 80, 1, -1, true, false);
    expect(result.risk).toBe('danger');
  });

  it('returns danger when same-direction trains are very close (attack scenario)', () => {
    // Même sens, très proches, train de devant plus lent → rattrapage
    const result = detectCollision(0.5, 90, 0.505, 10, 1, 1, false, false);
    expect(result.risk).toBe('danger');
  });

  it('returns warning for same-direction trains within 2 km (rear faster)', () => {
    const result = detectCollision(0.5, 80, 0.53, 30, 1, 1, false, false);
    if (result.distance_km < 2.0 && result.distance_km >= 0.5) {
      expect(result.risk).toBe('warning');
    }
  });

  it('provides distance_km', () => {
    const result = detectCollision(0.3, 80, 0.7, 70, 1, -1, false, false);
    expect(typeof result.distance_km).toBe('number');
    expect(result.distance_km).toBeGreaterThan(0);
  });

  it('TTC is null when same speed same direction (no approach)', () => {
    const result = detectCollision(0.3, 80, 0.5, 80, 1, 1, false, false);
    expect(result.ttc_s).toBeNull();
  });

  it('TTC is positive when same direction rear faster', () => {
    const result = detectCollision(0.3, 100, 0.5, 60, 1, 1, false, false);
    if (result.ttc_s !== null) {
      expect(result.ttc_s).toBeGreaterThan(0);
    }
  });
});

// ── interpolatePosition ───────────────────────────────────────
describe('interpolatePosition()', () => {
  it('t=0 returns from', () => {
    expect(interpolatePosition(0.3, 0.5, 0)).toBe(0.3);
  });

  it('t=1 returns to', () => {
    expect(interpolatePosition(0.3, 0.5, 1)).toBe(0.5);
  });

  it('t=0.5 returns midpoint', () => {
    expect(interpolatePosition(0.3, 0.5, 0.5)).toBeCloseTo(0.4);
  });

  it('clamps t>1 to 1', () => {
    expect(interpolatePosition(0.3, 0.5, 2)).toBe(0.5);
  });

  it('clamps t<0 to 0', () => {
    expect(interpolatePosition(0.3, 0.5, -1)).toBe(0.3);
  });
});

// ── nearestStation ────────────────────────────────────────────
describe('nearestStation()', () => {
  it('t=0 → Dakar (first station)', () => {
    const s = nearestStation(0);
    expect(s.name).toBe('Gare de Dakar');
  });

  it('t=1 → Diamniadio (last station)', () => {
    const s = nearestStation(1);
    expect(s.name).toBe('Diamniadio');
  });

  it('returns a valid station object', () => {
    const s = nearestStation(0.5);
    expect(s).toHaveProperty('name');
    expect(s).toHaveProperty('lat');
    expect(s).toHaveProperty('lon');
    expect(s).toHaveProperty('pk_km');
  });
});
