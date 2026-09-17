import React, { useEffect, useRef } from 'react';
import { Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { TrainData, LatLon } from '../../types/index.js';
import { nearestStation, formatDistance } from '../../utils/geo.js';
import { useTrainStore } from '../../store/useTrainStore.js';

interface TrainMarkerProps {
  train: TrainData;
  position: LatLon;
  theme: 'light' | 'dark';
  isCollisionWarning: boolean;
  isCollisionDanger: boolean;
}

const STATE_COLORS = {
  marche:   { fill: '#27AE60', ring: '#1E8449' },
  arret:    { fill: '#607D8B', ring: '#455A64' },
  degrade:  { fill: '#F39C12', ring: '#D68910' },
  critique: { fill: '#E74C3C', ring: '#C0392B' },
  offline:  { fill: '#37474F', ring: '#263238' },
};

function buildTrainIcon(
  train: TrainData,
  theme: 'light' | 'dark',
  isWarning: boolean,
  isDanger: boolean,
  direction: number,  // +1 = Dakar→Diamniadio, -1 = inverse
): L.DivIcon {
  const colors = STATE_COLORS[train.etat_train] ?? STATE_COLORS.offline;
  const bg = colors.fill;
  const border = colors.ring;
  const label = train.train_id;
  const speed = train.vitesse_kmh;

  const pulseClass = isDanger ? 'ter-train-danger' : isWarning ? 'ter-train-warning' : '';
  // Flèche directionnelle : → si avant, ← si arrière
  const arrow = direction >= 0 ? '→' : '←';
  // État affiché en bas du marqueur
  const stateLabel = train.etat_train === 'arret' ? '⏸ ARRÊT'
    : train.etat_train === 'degrade' ? '⚠ DÉGRADÉ'
    : train.etat_train === 'critique' ? '🔴 CRITIQUE'
    : '';

  const html = `
    <div class="ter-train-marker ${pulseClass}" style="
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      filter: drop-shadow(0 2px 6px rgba(0,0,0,0.6));
    ">
      <div style="
        background: ${bg};
        border: 2px solid ${border};
        border-radius: 5px;
        padding: 3px 7px;
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 88px;
        justify-content: space-between;
      ">
        <span style="
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          font-weight: 800;
          color: #FFFFFF;
          letter-spacing: 0.5px;
        ">${label}</span>
        <span style="
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          color: rgba(255,255,255,0.85);
          white-space: nowrap;
        ">${speed > 0 ? speed + ' km/h' : '⏸'}</span>
        <span style="
          font-size: 11px;
          color: rgba(255,255,255,0.9);
          font-weight: bold;
        ">${arrow}</span>
      </div>
      ${stateLabel ? `<div style="
        background: rgba(0,0,0,0.75);
        color: #FFF;
        font-family: monospace;
        font-size: 9px;
        padding: 1px 5px;
        border-radius: 2px;
        margin-top: 1px;
        white-space: nowrap;
      ">${stateLabel}</div>` : ''}
      <div style="
        width: 0; height: 0;
        border-left: 5px solid transparent;
        border-right: 5px solid transparent;
        border-top: 6px solid ${bg};
      "></div>
    </div>
  `;

  const height = stateLabel ? 46 : 34;
  return L.divIcon({
    className: '',
    html,
    iconSize: [96, height],
    iconAnchor: [48, height],
    popupAnchor: [0, -(height + 4)],
  });
}

export function TrainMarker({
  train,
  position,
  theme,
  isCollisionWarning,
  isCollisionDanger,
}: TrainMarkerProps) {
  const markerRef = useRef<L.Marker | null>(null);
  const { selectTrain, trainDirections } = useTrainStore();
  const direction = trainDirections[train.train_id] ?? 1;
  const map = useMap();
  const prevPositionRef = useRef(position);

  // Smooth animation: interpolate marker position on each update
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;

    const from = prevPositionRef.current;
    const to = position;
    prevPositionRef.current = position;

    if (from.lat === to.lat && from.lon === to.lon) return;

    const STEPS = 20;
    const STEP_MS = 25;
    let step = 0;

    const interval = setInterval(() => {
      step++;
      const t = step / STEPS;
      const lat = from.lat + (to.lat - from.lat) * t;
      const lon = from.lon + (to.lon - from.lon) * t;
      marker.setLatLng([lat, lon]);

      if (step >= STEPS) clearInterval(interval);
    }, STEP_MS);

    return () => clearInterval(interval);
  }, [position.lat, position.lon]);

  const icon = buildTrainIcon(train, theme, isCollisionWarning, isCollisionDanger, direction);
  const nearest = nearestStation(train.progression_norm);

  return (
    <Marker
      ref={markerRef}
      position={[position.lat, position.lon]}
      icon={icon}
      eventHandlers={{
        click: () => selectTrain(train.train_id),
      }}
      zIndexOffset={train.etat_train === 'critique' ? 1000 : 100}
    >
      <Popup className="ter-popup" maxWidth={260}>
        <div className="p-1 font-sans text-sm">
          <div className="font-bold text-base mb-2 flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-sm inline-block"
              style={{ background: train.color }}
            />
            {train.label}
          </div>
          <table className="w-full text-xs">
            <tbody>
              <tr><td className="text-gray-500 pr-2">Vitesse</td>
                  <td className="font-mono font-bold">{train.vitesse_kmh} km/h</td></tr>
              <tr><td className="text-gray-500 pr-2">Position</td>
                  <td className="font-mono">{Math.round(train.progression_norm * 36.0 * 10) / 10} km</td></tr>
              <tr><td className="text-gray-500 pr-2">Gare proche</td>
                  <td>{nearest.shortName}</td></tr>
              <tr><td className="text-gray-500 pr-2">Caténaire</td>
                  <td className="font-mono">{train.tension_kv.toFixed(1)} kV</td></tr>
              <tr><td className="text-gray-500 pr-2">Courant</td>
                  <td className="font-mono">{train.courant_a} A</td></tr>
              <tr><td className="text-gray-500 pr-2">Transfo</td>
                  <td className="font-mono">{train.temp_transfo_c}°C</td></tr>
              <tr><td className="text-gray-500 pr-2">Signal</td>
                  <td className={train.signal_vert ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>
                    {train.signal_vert ? '🟢 VERT' : '🔴 ROUGE'}
                  </td></tr>
              {train.alarmes_actives.length > 0 && (
                <tr>
                  <td colSpan={2} className="pt-1">
                    <span className="text-red-500 font-bold text-xs">
                      ⚠ {train.alarmes_actives.join(' · ')}
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="mt-1 text-xs text-gray-400">
            {new Date(train.updated_at).toLocaleTimeString('fr-SN')}
          </div>
        </div>
      </Popup>
    </Marker>
  );
}
