// ============================================================
// TER Sénégal — Arrêts réels Dakar ↔ Diamniadio
// Source: OpenStreetMap ways 810068961, 31461113, 31974823
//         (TER Dakar-AIBD + Chemin de fer Dakar-Niger)
// 14 stations Phase 1 (36 km, ouverte décembre 2021)
// Coordonnées GPS extraites des voies OSM réelles — route 100 %
// sur terre, contourne l'Anse de Hann via le corridor urbain nord.
// ============================================================

import type { Station } from '../types/index.js';

// ── Route waypoints with pk_km — used for geo interpolation ─
export interface RoutePoint {
  lat: number;
  lon: number;
  pk_km: number;
}

// Waypoints issus des nœuds OSM réels du TER Dakar-AIBD.
// La ligne monte nord le long du corridor ferroviaire (lon ~-17.44)
// avant de piquer NE vers Pikine, puis redescend SE vers Rufisque
// et continue est vers Diamniadio — entièrement sur terre.
export const ROUTE_POINTS: RoutePoint[] = [
  // === DAKAR → COLOBANE (corridor nord, voie OSM 810068961) ====
  { lat: 14.70043, lon: -17.44163, pk_km:  0.0  },  // Gare de Dakar
  { lat: 14.71081, lon: -17.44104, pk_km:  0.7  },  // wp: monte nord corridor
  { lat: 14.71682, lon: -17.43477, pk_km:  2.1  },  // wp: virage NE
  { lat: 14.71946, lon: -17.43331, pk_km:  2.5  },  // Colobane

  // === COLOBANE → HANN → DALIFORT ==============================
  { lat: 14.72657, lon: -17.42975, pk_km:  3.5  },  // wp
  { lat: 14.73154, lon: -17.42336, pk_km:  4.2  },  // wp
  { lat: 14.73506, lon: -17.41767, pk_km:  5.0  },  // Hann
  { lat: 14.73822, lon: -17.41183, pk_km:  5.7  },  // wp
  { lat: 14.74201, lon: -17.39830, pk_km:  7.0  },  // wp
  { lat: 14.74362, lon: -17.39694, pk_km:  7.5  },  // Dalifort

  // === DALIFORT → BAUX MAR. → PIKINE ===========================
  { lat: 14.74934, lon: -17.39217, pk_km:  8.6  },  // wp
  { lat: 14.75432, lon: -17.38745, pk_km:  9.5  },  // wp
  { lat: 14.76079, lon: -17.37604, pk_km: 10.5  },  // Baux Maraîchers
  { lat: 14.76295, lon: -17.37035, pk_km: 11.2  },  // wp
  { lat: 14.76466, lon: -17.35864, pk_km: 12.2  },  // wp
  { lat: 14.76525, lon: -17.35340, pk_km: 13.0  },  // Pikine

  // === PIKINE → THIAROYE (virage SE, point le + nord = 14.765) =
  { lat: 14.76541, lon: -17.35146, pk_km: 13.2  },  // wp: apogée nord
  { lat: 14.76058, lon: -17.34239, pk_km: 14.0  },  // wp: descend SE
  { lat: 14.75875, lon: -17.33945, pk_km: 14.9  },  // wp
  { lat: 14.75732, lon: -17.33278, pk_km: 15.5  },  // Thiaroye

  // === THIAROYE → YEUMBEUL → KMF ================================
  { lat: 14.75014, lon: -17.32265, pk_km: 16.5  },  // wp
  { lat: 14.74748, lon: -17.31817, pk_km: 17.1  },  // wp
  { lat: 14.74433, lon: -17.31414, pk_km: 18.0  },  // Yeumbeul
  { lat: 14.73633, lon: -17.30701, pk_km: 19.3  },  // wp
  { lat: 14.73446, lon: -17.30455, pk_km: 19.6  },  // wp
  { lat: 14.72784, lon: -17.29253, pk_km: 21.0  },  // Keur Mbaye Fall

  // === KMF → M'BAO → PNR → RUFISQUE ===========================
  // (voie OSM 810068961 fin + 31461113 : descend SE vers Rufisque)
  { lat: 14.72356, lon: -17.28468, pk_km: 21.4  },  // wp
  { lat: 14.71814, lon: -17.27491, pk_km: 22.5  },  // wp
  { lat: 14.71667, lon: -17.27236, pk_km: 23.5  },  // M'Bao
  { lat: 14.71353, lon: -17.26367, pk_km: 24.4  },  // wp
  { lat: 14.70826, lon: -17.25490, pk_km: 25.3  },  // wp
  { lat: 14.70643, lon: -17.25185, pk_km: 26.0  },  // PNR (Parc Industriel)
  { lat: 14.70228, lon: -17.24545, pk_km: 26.8  },  // wp
  { lat: 14.69750, lon: -17.23931, pk_km: 27.5  },  // wp
  { lat: 14.69777, lon: -17.23720, pk_km: 28.0  },  // Rufisque

  // === RUFISQUE → BARGNY → DIAMNIADIO ==========================
  // (voies OSM 31974823 + extrapolation vers Diamniadio)
  { lat: 14.69649, lon: -17.23359, pk_km: 28.5  },  // wp: repart NE
  { lat: 14.70080, lon: -17.22157, pk_km: 29.5  },  // wp
  { lat: 14.70872, lon: -17.20611, pk_km: 31.1  },  // wp
  { lat: 14.71473, lon: -17.19966, pk_km: 31.9  },  // wp
  { lat: 14.72000, lon: -17.19091, pk_km: 32.5  },  // Bargny
  { lat: 14.72165, lon: -17.18717, pk_km: 33.0  },  // wp
  { lat: 14.72600, lon: -17.17700, pk_km: 34.0  },  // wp
  { lat: 14.72937, lon: -17.16652, pk_km: 34.9  },  // wp
  { lat: 14.71950, lon: -17.16500, pk_km: 36.0  },  // Diamniadio
];

// ── Center-line route coords (backward compat) ───────────────
export const ROUTE_COORDS: [number, number][] =
  ROUTE_POINTS.map(p => [p.lat, p.lon] as [number, number]);

// ── DKR direction: north track (+0.0004 lat offset) ──────────
export const DKR_ROUTE_COORDS: [number, number][] =
  ROUTE_POINTS.map(p => [p.lat + 0.0004, p.lon] as [number, number]);

// ── DMD direction: south track (-0.0004 lat offset) ──────────
export const DMD_ROUTE_COORDS: [number, number][] =
  ROUTE_POINTS.map(p => [p.lat - 0.0004, p.lon] as [number, number]);

// ── Stations: coords must match ROUTE_POINTS at their pk_km ─
export const STATIONS: Station[] = [
  {
    id: 1,
    name: 'Gare de Dakar',
    shortName: 'Dakar',
    lat: 14.70043,
    lon: -17.44163,
    pk_km: 0.0,
    is_major: true,
  },
  {
    id: 2,
    name: 'Colobane',
    shortName: 'Colobane',
    lat: 14.71946,
    lon: -17.43331,
    pk_km: 2.5,
    is_major: false,
  },
  {
    id: 3,
    name: 'Hann',
    shortName: 'Hann',
    lat: 14.73506,
    lon: -17.41767,
    pk_km: 5.0,
    is_major: false,
  },
  {
    id: 4,
    name: 'Dalifort',
    shortName: 'Dalifort',
    lat: 14.74362,
    lon: -17.39694,
    pk_km: 7.5,
    is_major: false,
  },
  {
    id: 5,
    name: 'Baux Maraîchers',
    shortName: 'Baux Mar.',
    lat: 14.76079,
    lon: -17.37604,
    pk_km: 10.5,
    is_major: false,
  },
  {
    id: 6,
    name: 'Pikine',
    shortName: 'Pikine',
    lat: 14.76525,
    lon: -17.35340,
    pk_km: 13.0,
    is_major: false,
  },
  {
    id: 7,
    name: 'Thiaroye',
    shortName: 'Thiaroye',
    lat: 14.75732,
    lon: -17.33278,
    pk_km: 15.5,
    is_major: true,
  },
  {
    id: 8,
    name: 'Yeumbeul',
    shortName: 'Yeumbeul',
    lat: 14.74433,
    lon: -17.31414,
    pk_km: 18.0,
    is_major: false,
  },
  {
    id: 9,
    name: 'Keur Mbaye Fall',
    shortName: 'KMF',
    lat: 14.72784,
    lon: -17.29253,
    pk_km: 21.0,
    is_major: false,
  },
  {
    id: 10,
    name: "M'Bao",
    shortName: "M'Bao",
    lat: 14.71667,
    lon: -17.27236,
    pk_km: 23.5,
    is_major: false,
  },
  {
    id: 11,
    name: 'PNR (Parc Industriel)',
    shortName: 'PNR',
    lat: 14.70643,
    lon: -17.25185,
    pk_km: 26.0,
    is_major: false,
  },
  {
    id: 12,
    name: 'Rufisque',
    shortName: 'Rufisque',
    lat: 14.69777,
    lon: -17.23720,
    pk_km: 28.0,
    is_major: true,
  },
  {
    id: 13,
    name: 'Bargny',
    shortName: 'Bargny',
    lat: 14.72000,
    lon: -17.19091,
    pk_km: 32.5,
    is_major: false,
  },
  {
    id: 14,
    name: 'Diamniadio',
    shortName: 'Diamniadio',
    lat: 14.71950,
    lon: -17.16500,
    pk_km: 36.0,
    is_major: true,
  },
];

// Total line length (Phase 1)
export const LINE_LENGTH_KM = 36.0;

// PLC position constants (from railway1.st)
export const PLC_POS_MIN = 120;
export const PLC_POS_MAX = 1960;

// Map bounds for initial view
export const MAP_BOUNDS: [[number, number], [number, number]] = [
  [14.66, -17.47],  // SW
  [14.80, -17.14],  // NE
];

// Map center — milieu de la ligne
export const MAP_CENTER: [number, number] = [14.733, -17.307];
export const MAP_ZOOM_DEFAULT = 11;
export const MAP_ZOOM_MIN = 9;
export const MAP_ZOOM_MAX = 16;

// Tile URLs
export const TILES = {
  light: {
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  dark: {
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
};
