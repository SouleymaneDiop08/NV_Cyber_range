import React, { useEffect, useRef } from 'react';
import { Circle, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { CtcInfo, TrainData } from '../../types/index.js';
import { plcPosToLatLon, plcPosToTrackLatLon } from '../../utils/geo.js';

// ── Switch location: between Pikine and Thiaroye ─────────────
// PLC ~784 → pk_km ≈ 13.0 (Pikine area)
const SWITCH_LAT = 14.76525;
const SWITCH_LON = -17.35340;

interface CtcOverlayProps {
  ctc: CtcInfo;
  dkrTrain?: TrainData;
  dmdTrain?: TrainData;
  theme: 'light' | 'dark';
}

// ── Animated switch marker ────────────────────────────────────
function SwitchMarker({ deviated, theme }: { deviated: boolean; theme: 'light' | 'dark' }) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    const color = deviated ? '#FF2D2D' : '#2EC5A4';
    const glowColor = deviated ? 'rgba(255,45,45,0.6)' : 'rgba(46,197,164,0.4)';
    const iconChar = deviated ? '⚡' : '✓';

    const divIcon = L.divIcon({
      className: '',
      html: `
        <div class="ctc-switch-marker ${deviated ? 'ctc-switch-deviated' : 'ctc-switch-nominal'}">
          <div class="ctc-switch-ring" style="border-color: ${color}; box-shadow: 0 0 0 0 ${glowColor};"></div>
          <div class="ctc-switch-core" style="background: ${color}; box-shadow: 0 0 12px ${color};">
            <span class="ctc-switch-icon">${iconChar}</span>
          </div>
        </div>
      `,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });

    const marker = L.marker([SWITCH_LAT, SWITCH_LON], { icon: divIcon, zIndexOffset: 1500 });
    marker.addTo(map);
    markerRef.current = marker;

    return () => {
      marker.remove();
      markerRef.current = null;
    };
  }, [map, deviated, theme]);

  return null;
}

// ── Collision shockwave marker ────────────────────────────────
function CollisionShockwave({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    const icon = L.divIcon({
      className: '',
      html: `
        <div style="position:relative;width:0;height:0;">
          <div class="ctc-shockwave sw-1"></div>
          <div class="ctc-shockwave sw-2"></div>
          <div class="ctc-shockwave sw-3"></div>
          <div class="ctc-explosion-core"></div>
        </div>
      `,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });

    const marker = L.marker([lat, lon], { icon, zIndexOffset: 3000 });
    marker.addTo(map);
    markerRef.current = marker;

    return () => {
      marker.remove();
      markerRef.current = null;
    };
  }, [map, lat, lon]);

  return null;
}

// ── Main CTC Overlay ──────────────────────────────────────────
export function CtcOverlay({ ctc, dkrTrain, dmdTrain, theme }: CtcOverlayProps) {
  const deviated = ctc.aiguille_deviee;
  const collision = ctc.alm_collision;

  // The collision animation must stay on the railway line. When the PLC
  // provides IR72, it is used as the authoritative impact position.
  const dkrPos = dkrTrain ? plcPosToLatLon(dkrTrain.progression_plc) : null;
  const dmdPos = dmdTrain ? plcPosToLatLon(dmdTrain.progression_plc) : null;
  const impactPos = ctc.collision_position_plc > 0
    ? plcPosToTrackLatLon(ctc.collision_position_plc, 'DMD')
    : { lat: SWITCH_LAT, lon: SWITCH_LON };
  const midLat = impactPos.lat;
  const midLon = impactPos.lon;

  // Risk zone radius (200m–3000m based on risk level)
  const zoneRadius = Math.max(200, (ctc.risk_level / 100) * 3000);
  const zoneColor = collision ? '#FF1A1A' : ctc.risk_level > 60 ? '#FF5500' : '#FF9900';

  return (
    <>
      {/* ── Always show switch marker ── */}
      <SwitchMarker deviated={deviated} theme={theme} />

      {deviated && (
        <>
          {/* Danger zone circle between trains */}
          <Circle
            center={[midLat, midLon]}
            radius={zoneRadius}
            pathOptions={{
              fillColor: zoneColor,
              fillOpacity: collision ? 0.25 : 0.10,
              color: zoneColor,
              weight: collision ? 3 : 1.5,
              opacity: collision ? 0.9 : 0.5,
              dashArray: collision ? undefined : '10 6',
            }}
          />

          {/* Convergence line from switch to midpoint */}
          {dkrPos && dmdPos && (
            <Polyline
              positions={[
                [SWITCH_LAT, SWITCH_LON],
                [dkrPos.lat, dkrPos.lon],
              ]}
              pathOptions={{
                color: '#FF3300',
                weight: 2,
                opacity: 0.7,
                dashArray: '6 4',
              }}
            />
          )}
          {dkrPos && dmdPos && (
            <Polyline
              positions={[
                [SWITCH_LAT, SWITCH_LON],
                [dmdPos.lat, dmdPos.lon],
              ]}
              pathOptions={{
                color: '#FF3300',
                weight: 2,
                opacity: 0.7,
                dashArray: '6 4',
              }}
            />
          )}

          {/* Collision shockwave */}
          {collision && (
            <CollisionShockwave lat={midLat} lon={midLon} />
          )}
        </>
      )}
    </>
  );
}
