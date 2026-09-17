import React, { useEffect, useRef } from 'react';
import { Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { CollisionStatus } from '../../types/index.js';
import { formatDistance, formatTTC } from '../../utils/geo.js';

interface CollisionOverlayProps {
  collision: CollisionStatus;
  theme: 'light' | 'dark';
}

// ── Animated pulse rings using Leaflet DivOverlay ─────────────
function CollisionPulseRings({
  lat,
  lon,
  isDanger,
}: {
  lat: number;
  lon: number;
  isDanger: boolean;
}) {
  const map = useMap();
  const containerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    const color = isDanger ? '#E74C3C' : '#F5A623';

    const icon = L.divIcon({
      className: '',
      html: `
        <div class="collision-pulse-container" style="
          position: relative;
          width: 0;
          height: 0;
        ">
          <div class="collision-ring ring-1" style="
            position: absolute;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            border: 3px solid ${color};
            top: -20px;
            left: -20px;
            animation: collision-pulse 1.2s ease-out infinite;
            opacity: 0.9;
          "></div>
          <div class="collision-ring ring-2" style="
            position: absolute;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            border: 3px solid ${color};
            top: -20px;
            left: -20px;
            animation: collision-pulse 1.2s ease-out infinite 0.4s;
            opacity: 0.9;
          "></div>
          <div class="collision-ring ring-3" style="
            position: absolute;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            border: 3px solid ${color};
            top: -20px;
            left: -20px;
            animation: collision-pulse 1.2s ease-out infinite 0.8s;
            opacity: 0.9;
          "></div>
          <div style="
            position: absolute;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: ${color};
            top: -6px;
            left: -6px;
            box-shadow: 0 0 8px ${color};
            animation: ${isDanger ? 'collision-flash 0.4s ease-in-out infinite' : 'none'};
          "></div>
        </div>
      `,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });

    const marker = L.marker([lat, lon], { icon, zIndexOffset: 2000 });
    marker.addTo(map);
    containerRef.current = marker;

    return () => {
      marker.remove();
      containerRef.current = null;
    };
  }, [map, lat, lon, isDanger]);

  // Update position
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.setLatLng([lat, lon]);
    }
  }, [lat, lon]);

  return null;
}

// ── Collision info banner (Leaflet Control) ───────────────────
function CollisionBanner({
  collision,
  theme,
}: {
  collision: CollisionStatus;
  theme: 'light' | 'dark';
}) {
  const map = useMap();
  const controlRef = useRef<L.Control | null>(null);

  useEffect(() => {
    const isDanger = collision.risk === 'danger';
    const isDark = theme === 'dark';

    const bg = isDanger
      ? 'rgba(231,76,60,0.95)'
      : 'rgba(243,156,18,0.95)';
    const textColor = '#FFFFFF';

    const ttcText = formatTTC(collision.ttc_s);
    const distText = formatDistance(collision.distance_km);
    const speedText = `${Math.round(collision.relative_speed_kmh)} km/h`;

    const ControlClass = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'ter-collision-banner');
        div.innerHTML = `
          <div style="
            background: ${bg};
            backdrop-filter: blur(8px);
            border-radius: 8px;
            padding: 10px 14px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            color: ${textColor};
            font-family: 'IBM Plex Mono', monospace;
            min-width: 220px;
            animation: ${isDanger ? 'ter-banner-flash 0.8s ease-in-out infinite' : 'none'};
          ">
            <div style="font-size: 13px; font-weight: 700; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
              ${isDanger ? '🚨' : '⚠️'}
              ${isDanger ? 'RISQUE COLLISION IMMINENT' : 'RAPPROCHEMENT DÉTECTÉ'}
            </div>
            <div style="font-size: 11px; opacity: 0.9; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px;">
              <span style="opacity:0.7">Distance</span><span>${distText}</span>
              <span style="opacity:0.7">Vit. relative</span><span>${speedText}</span>
              <span style="opacity:0.7">TTC</span><span>${ttcText}</span>
            </div>
          </div>
        `;
        return div;
      },
      onRemove() {},
    });

    const ctrl = new ControlClass({ position: 'topcenter' as L.ControlPosition }) as L.Control & { onAdd: () => HTMLElement };
    // fallback: use topright if topcenter not valid
    const safeCtrl = new (L.Control.extend({
      options: { position: 'topright' as L.ControlPosition },
      onAdd() {
        const div = L.DomUtil.create('div', 'ter-collision-banner');
        div.style.marginTop = '10px';
        div.innerHTML = `
          <div style="
            background: ${bg};
            backdrop-filter: blur(8px);
            border-radius: 8px;
            padding: 10px 14px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            color: ${textColor};
            font-family: 'IBM Plex Mono', monospace;
            min-width: 220px;
            border: 1px solid rgba(255,255,255,0.2);
          ">
            <div style="font-size: 13px; font-weight: 700; margin-bottom: 6px;">
              ${isDanger ? '🚨 RISQUE COLLISION' : '⚠️ RAPPROCHEMENT'}
            </div>
            <div style="font-size: 11px; opacity: 0.9; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px;">
              <span style="opacity:0.7">Distance</span><span>${distText}</span>
              <span style="opacity:0.7">Vit. rel.</span><span>${speedText}</span>
              <span style="opacity:0.7">TTC</span><span>${ttcText}</span>
            </div>
          </div>
        `;
        return div;
      },
      onRemove() {},
    }))();

    safeCtrl.addTo(map);
    controlRef.current = safeCtrl;

    return () => {
      safeCtrl.remove();
      controlRef.current = null;
    };
  }, [map, collision, theme]);

  return null;
}

// ── Main export ───────────────────────────────────────────────
export function CollisionOverlay({ collision, theme }: CollisionOverlayProps) {
  const isDanger = collision.risk === 'danger';

  // Zone radius: 500m danger, 2000m warning
  const zoneRadius = isDanger ? 500 : 2000;
  const zoneColor = isDanger ? '#E74C3C' : '#F5A623';

  return (
    <>
      {/* Transparent zone circle */}
      <Circle
        center={[collision.lat, collision.lon]}
        radius={zoneRadius}
        pathOptions={{
          fillColor: zoneColor,
          fillOpacity: isDanger ? 0.12 : 0.06,
          color: zoneColor,
          weight: isDanger ? 2 : 1,
          opacity: isDanger ? 0.7 : 0.4,
          dashArray: isDanger ? undefined : '6 4',
        }}
      />

      {/* Animated pulse rings */}
      <CollisionPulseRings
        lat={collision.lat}
        lon={collision.lon}
        isDanger={isDanger}
      />

      {/* Info banner */}
      <CollisionBanner collision={collision} theme={theme} />
    </>
  );
}
