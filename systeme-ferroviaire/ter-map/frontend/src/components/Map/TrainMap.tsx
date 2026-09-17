import React, { useEffect, useRef, useMemo } from 'react';
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  Popup,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTrainStore } from '../../store/useTrainStore.js';
import {
  MAP_CENTER,
  MAP_ZOOM_DEFAULT,
  MAP_ZOOM_MIN,
  MAP_ZOOM_MAX,
  TILES,
  ROUTE_COORDS,
  DKR_ROUTE_COORDS,
  DMD_ROUTE_COORDS,
  STATIONS,
} from '../../constants/stations.js';
import { plcPosToLatLon, plcPosToTrackLatLon } from '../../utils/geo.js';
import { TrainMarker } from './TrainMarker.js';
import { StationMarker } from './StationMarker.js';
import { CollisionOverlay } from './CollisionOverlay.js';
import { CtcOverlay } from './CtcOverlay.js';
import type { TrainData, LatLon } from '../../types/index.js';
import { nearestStation } from '../../utils/geo.js';

// ── Theme-aware tile layer ────────────────────────────────────
function ThemedTileLayer({ theme }: { theme: 'light' | 'dark' }) {
  const tiles = theme === 'dark' ? TILES.dark : TILES.light;
  return (
    <TileLayer
      url={tiles.url}
      attribution={tiles.attribution}
      maxZoom={19}
    />
  );
}

// ── Keep map reference in sync ────────────────────────────────
function MapRefSync({ mapRef }: { mapRef: React.MutableRefObject<ReturnType<typeof useMap> | null> }) {
  const map = useMap();
  mapRef.current = map;
  return null;
}

function buildSivIcon(train: TrainData): L.DivIcon {
  const html = `
    <div class="ter-siv-ghost">
      <div class="ter-siv-pulse"></div>
      <div class="ter-siv-card">
        <div class="ter-siv-title">SIV ANNONCÉ</div>
        <div class="ter-siv-train">${train.train_id}</div>
      </div>
    </div>
  `;

  return L.divIcon({
    className: '',
    html,
    iconSize: [92, 54],
    iconAnchor: [46, 27],
    popupAnchor: [0, -24],
  });
}

function SivDesinfoOverlay({ train, realPos, announcedPos }: {
  train: TrainData;
  realPos: LatLon;
  announcedPos: LatLon;
}) {
  return (
    <>
      <Polyline
        positions={[[realPos.lat, realPos.lon], [announcedPos.lat, announcedPos.lon]]}
        pathOptions={{ color: '#FF2D6F', weight: 3, opacity: 0.88, dashArray: '8 8' }}
      />
      <Marker
        position={[announcedPos.lat, announcedPos.lon]}
        icon={buildSivIcon(train)}
        zIndexOffset={1200}
      >
        <Popup className="ter-popup" maxWidth={300}>
          <div className="p-2 text-sm">
            <div className="font-bold text-red-600 mb-1">
              Désinformation voyageurs détectée
            </div>
            <div className="text-xs text-gray-700 leading-5">
              <div><b>Train:</b> {train.label}</div>
              <div><b>Position réelle:</b> PLC {train.progression_plc}</div>
              <div><b>Position annoncée:</b> {train.siv.zone_annoncee} (PLC {train.siv.position_annoncee_plc})</div>
              <div><b>Écart:</b> {train.siv.ecart_position} unités PLC</div>
              <div><b>Retard affiché:</b> {train.siv.retard_annonce_min} min</div>
            </div>
          </div>
        </Popup>
      </Marker>
    </>
  );
}

function trainPassengerText(train: TrainData): string {
  const current = nearestStation(train.progression_norm);
  const speedText = train.vitesse_kmh > 2 ? `${train.vitesse_kmh} km/h` : 'à quai / arrêté';
  const service = train.train_id === 'DKR' ? 'Dakar → Diamniadio' : 'Diamniadio → Dakar';

  if (train.siv.actif) {
    return [
      'ALERTE INFORMATION VOYAGEURS',
      `${train.label}`,
      `Annonce affichée: ${train.siv.zone_annoncee}`,
      `Position réelle: ${current.name}`,
      `Retard affiché: ${train.siv.retard_annonce_min} min`,
      `Écart détecté: ${train.siv.ecart_position} unités PLC`,
    ].join('   •   ');
  }

  return [
    `${train.label}`,
    `Mission ${service}`,
    `Position actuelle: ${current.name}`,
    `Vitesse: ${speedText}`,
    train.signal_vert ? 'Signal: voie libre' : 'Signal: arrêt',
    train.catenaire_ok ? 'Traction électrique: normale' : 'Traction électrique: indisponible',
    'Information voyageurs synchronisée',
  ].join('   •   ');
}

// ── SIV crisis message per niveau ────────────────────────────
const SIV_CRISIS_MESSAGES: Record<number, { badge: string; text: string; color: string }> = {
  1: {
    badge: 'DONNÉES FALSIFIÉES',
    text: '⚠ PERTURBATION SYSTÈME — Informations voyageurs non fiables — Consultez le personnel de quai',
    color: '#F5A623',
  },
  2: {
    badge: 'TRAIN EN AVANCE',
    text: '🚨 ALERTE SERVICE — Train annoncé EN AVANCE de 15 min — Rejoignez votre quai IMMÉDIATEMENT — Départ imminent',
    color: '#FF5500',
  },
  3: {
    badge: '⚠ ALERTE SÉCURITÉ',
    text: '🚨🚨 ALERTE SÉCURITÉ CRITIQUE — ÉVACUEZ LE QUAI IMMÉDIATEMENT — Incident grave en cours — Suivez les consignes du personnel — NE PAS PRENDRE LE TRAIN',
    color: '#FF0000',
  },
};

function PassengerInfoBoards({ dkrTrain, dmdTrain }: {
  dkrTrain?: TrainData;
  dmdTrain?: TrainData;
}) {
  const { sivCrisis } = useTrainStore();
  const niveau = sivCrisis?.niveau ?? 0;
  const crisisMsg = SIV_CRISIS_MESSAGES[niveau];

  const boards = [
    {
      station: 'GARE DE DAKAR',
      subtitle: 'Panneau voyageurs quai principal',
      train: dkrTrain,
      boardCompromised: sivCrisis?.dkr_msg_actif ?? false,
    },
    {
      station: 'GARE DE DIAMNIADIO',
      subtitle: 'Panneau voyageurs quai principal',
      train: dmdTrain,
      boardCompromised: sivCrisis?.dmd_msg_actif ?? false,
    },
  ];

  return (
    <div className="ter-siv-board-layer">
      {boards.map(board => {
        const sivAlert = board.train?.siv.actif ?? false;
        const isCrisis = board.boardCompromised && niveau >= 1;
        const isTotalCrisis = isCrisis && niveau >= 3;

        // Crisis overrides normal SIV text
        const text = isCrisis && crisisMsg
          ? crisisMsg.text
          : board.train
            ? trainPassengerText(board.train)
            : 'En attente des données automate...';

        const badge = isCrisis && crisisMsg
          ? crisisMsg.badge
          : sivAlert ? 'SIV INCOHÉRENT' : null;

        return (
          <div
            key={board.station}
            className={`ter-passenger-board
              ${sivAlert && !isCrisis ? 'ter-passenger-board-alert' : ''}
              ${isCrisis ? 'ter-passenger-board-crisis' : ''}
              ${isTotalCrisis ? 'ter-passenger-board-evacuation' : ''}
            `}
            style={isCrisis && crisisMsg ? { borderColor: crisisMsg.color + 'cc' } : undefined}
          >
            <div className="ter-passenger-board-head"
              style={isCrisis && crisisMsg ? { color: crisisMsg.color } : undefined}>
              <span>{board.station}</span>
              {badge && <span className={isCrisis ? 'siv-crisis-badge' : ''}>{badge}</span>}
            </div>
            <div className="ter-passenger-board-subtitle">
              {isCrisis ? `NIVEAU ${niveau} — SIV COMPROMIS — T0832` : board.subtitle}
            </div>
            <div className="ter-passenger-marquee" title={text}>
              <span style={isCrisis && crisisMsg ? { color: crisisMsg.color, fontWeight: 900 } : undefined}>
                {text}
              </span>
              <span aria-hidden="true"
                style={isCrisis && crisisMsg ? { color: crisisMsg.color, fontWeight: 900 } : undefined}>
                {text}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Map component ────────────────────────────────────────
export function TrainMap() {
  const { theme, trains, collision, ctc } = useTrainStore();
  const mapRef = useRef<ReturnType<typeof useMap> | null>(null);

  const dkrTrain = trains.find(t => t.train_id === 'DKR');
  const dmdTrain = trains.find(t => t.train_id === 'DMD');

  const dkrPos = useMemo(
    () => {
      if (!dkrTrain) return null;
      if (ctc?.alm_collision && ctc.collision_position_plc > 0) {
        return plcPosToTrackLatLon(ctc.collision_position_plc, 'DMD');
      }
      const dkrHasPassedSwitch = dkrTrain.progression_plc >= 784;
      const track = ctc?.aiguille_deviee && dkrHasPassedSwitch ? 'DMD' : 'DKR';
      return plcPosToTrackLatLon(dkrTrain.progression_plc, track);
    },
    [dkrTrain?.progression_plc, ctc?.aiguille_deviee, ctc?.alm_collision, ctc?.collision_position_plc],
  );
  const dmdPos = useMemo(
    () => {
      if (!dmdTrain) return null;
      if (ctc?.alm_collision && ctc.collision_position_plc > 0) {
        return plcPosToTrackLatLon(ctc.collision_position_plc, 'DMD');
      }
      return plcPosToTrackLatLon(dmdTrain.progression_plc, 'DMD');
    },
    [dmdTrain?.progression_plc, ctc?.alm_collision, ctc?.collision_position_plc],
  );
  const dkrSivPos = useMemo(
    () => dkrTrain?.siv.actif ? plcPosToLatLon(dkrTrain.siv.position_annoncee_plc) : null,
    [dkrTrain?.siv.actif, dkrTrain?.siv.position_annoncee_plc],
  );
  const dmdSivPos = useMemo(
    () => dmdTrain?.siv.actif ? plcPosToLatLon(dmdTrain.siv.position_annoncee_plc) : null,
    [dmdTrain?.siv.actif, dmdTrain?.siv.position_annoncee_plc],
  );

  // Route line colors by theme
  const routeColorDKR = theme === 'dark' ? '#2EC5A4' : '#0E9E82';
  const routeColorDMD = theme === 'dark' ? '#F5A623' : '#D4860F';

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={MAP_CENTER}
        zoom={MAP_ZOOM_DEFAULT}
        minZoom={MAP_ZOOM_MIN}
        maxZoom={MAP_ZOOM_MAX}
        className="h-full w-full"
        zoomControl={true}
        attributionControl={true}
      >
        <MapRefSync mapRef={mapRef} />
        <ThemedTileLayer theme={theme} />

        {/* ── Route polylines ── */}
        {/* Center-line shadow (glow) — wide background glow */}
        <Polyline
          positions={ROUTE_COORDS}
          pathOptions={{ color: routeColorDKR, weight: 12, opacity: 0.08 }}
        />
        {/* DKR track — north offset, solid */}
        <Polyline
          positions={DKR_ROUTE_COORDS}
          pathOptions={{ color: routeColorDKR, weight: 4, opacity: 0.95 }}
        />
        {/* DMD track — south offset, dashed amber */}
        <Polyline
          positions={DMD_ROUTE_COORDS}
          pathOptions={{
            color: routeColorDMD,
            weight: 3,
            opacity: 0.85,
            dashArray: '8 5',
          }}
        />

        {/* ── Station markers ───────────────────────────────────── */}
        {STATIONS.map(station => (
          <StationMarker
            key={station.id}
            station={station}
            theme={theme}
          />
        ))}

        {/* ── Train markers ─────────────────────────────────────── */}
        {dkrTrain && dkrPos && (
          <TrainMarker
            train={dkrTrain}
            position={dkrPos}
            theme={theme}
            isCollisionWarning={collision?.risk === 'warning'}
            isCollisionDanger={collision?.risk === 'danger'}
          />
        )}
        {dmdTrain && dmdPos && (
          <TrainMarker
            train={dmdTrain}
            position={dmdPos}
            theme={theme}
            isCollisionWarning={collision?.risk === 'warning'}
            isCollisionDanger={collision?.risk === 'danger'}
          />
        )}

        {/* ── SIV/SONO misinformation overlays ───────────────── */}
        {dkrTrain && dkrPos && dkrSivPos && (
          <SivDesinfoOverlay train={dkrTrain} realPos={dkrPos} announcedPos={dkrSivPos} />
        )}
        {dmdTrain && dmdPos && dmdSivPos && (
          <SivDesinfoOverlay train={dmdTrain} realPos={dmdPos} announcedPos={dmdSivPos} />
        )}

        {/* ── Collision overlay ─────────────────────────────────── */}
        {collision && collision.risk !== 'none' && (
          <CollisionOverlay collision={collision} theme={theme} />
        )}

        {/* ── CTC switch / aiguille overlay ─────────────────────── */}
        {ctc && (
          <CtcOverlay
            ctc={ctc}
            dkrTrain={dkrTrain}
            dmdTrain={dmdTrain}
            theme={theme}
          />
        )}
      </MapContainer>

      <PassengerInfoBoards dkrTrain={dkrTrain} dmdTrain={dmdTrain} />
    </div>
  );
}
