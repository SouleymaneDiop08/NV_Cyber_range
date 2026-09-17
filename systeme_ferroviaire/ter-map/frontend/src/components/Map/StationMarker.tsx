import React from 'react';
import { CircleMarker, Tooltip } from 'react-leaflet';
import type { Station } from '../../types/index.js';

interface StationMarkerProps {
  station: Station;
  theme: 'light' | 'dark';
}

export function StationMarker({ station, theme }: StationMarkerProps) {
  const isDark = theme === 'dark';

  // Gares principales : cercle blanc avec contour coloré
  // Haltes : petit point avec contour
  const radius = station.is_major ? 8 : 5;
  const fillColor = station.is_major
    ? (isDark ? '#FFFFFF' : '#FFFFFF')
    : (isDark ? '#94A3B8' : '#64748B');
  const strokeColor = station.is_major
    ? (isDark ? '#2EC5A4' : '#0E9E82')   // contour teal pour gares principales
    : (isDark ? '#4A5568' : '#CBD5E0');
  const strokeWidth = station.is_major ? 2.5 : 1.5;

  return (
    <CircleMarker
      center={[station.lat, station.lon]}
      radius={radius}
      pathOptions={{
        fillColor,
        fillOpacity: 1,
        color: strokeColor,
        weight: strokeWidth,
      }}
    >
      <Tooltip
        permanent={station.is_major}
        direction="top"
        offset={[0, -10]}
        className={`ter-station-tooltip ${isDark ? 'dark' : 'light'}`}
      >
        <span
          style={{
            fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
            fontSize: station.is_major ? '11px' : '10px',
            fontWeight: station.is_major ? '700' : '500',
            color: isDark ? '#E6EDF3' : '#1E293B',
            background: isDark ? 'rgba(13,17,23,0.9)' : 'rgba(255,255,255,0.92)',
            padding: '2px 6px',
            borderRadius: '3px',
            border: `1px solid ${isDark ? 'rgba(46,197,164,0.4)' : 'rgba(14,158,130,0.3)'}`,
            whiteSpace: 'nowrap',
            letterSpacing: '0.02em',
          }}
        >
          {station.shortName}
        </span>
      </Tooltip>
    </CircleMarker>
  );
}
