/* ============================================================
   Référentiel de la ligne — source d'autorité : ter-map
   /home/sdiop/ter-map/frontend/src/constants/stations.ts

   14 arrêts (phase Dakar — Diamniadio, 36 km), points
   kilométriques issus des tracés OSM réels. Ce référentiel
   NE DOIT PAS diverger de ter-map : la vue globale et la carte
   dynamique doivent nommer et situer les gares à l'identique.
   ============================================================ */
window.STATIONS = [
  { id: 'dakar',      name: 'DAKAR',           full: 'Gare de Dakar',        pk: 0.0,  kind: 'terminus' },
  { id: 'colobane',   name: 'COLOBANE',        full: 'Colobane',             pk: 2.5,  kind: 'gare' },
  { id: 'hann',       name: 'HANN',            full: 'Hann',                 pk: 5.0,  kind: 'gare' },
  { id: 'dalifort',   name: 'DALIFORT',        full: 'Dalifort',             pk: 7.5,  kind: 'gare' },
  { id: 'baux',       name: 'BAUX MARAÎCHERS', full: 'Baux Maraîchers',      pk: 10.5, kind: 'gare' },
  { id: 'pikine',     name: 'PIKINE',          full: 'Pikine',               pk: 13.0, kind: 'gare' },
  { id: 'thiaroye',   name: 'THIAROYE',        full: 'Thiaroye',             pk: 15.5, kind: 'majeure' },
  { id: 'yeumbeul',   name: 'YEUMBEUL',        full: 'Yeumbeul',             pk: 18.0, kind: 'gare' },
  { id: 'kmf',        name: 'KEUR MBAYE FALL', full: 'Keur Mbaye Fall',      pk: 21.0, kind: 'gare' },
  { id: 'mbao',       name: "M'BAO",           full: "M'Bao",                pk: 23.5, kind: 'gare' },
  { id: 'pnr',        name: 'PNR',             full: 'PNR (Parc Industriel)', pk: 26.0, kind: 'gare' },
  { id: 'rufisque',   name: 'RUFISQUE',        full: 'Rufisque',             pk: 28.0, kind: 'majeure' },
  { id: 'bargny',     name: 'BARGNY',          full: 'Bargny',               pk: 32.5, kind: 'gare' },
  { id: 'diamniadio', name: 'DIAMNIADIO',      full: 'Diamniadio',           pk: 36.0, kind: 'terminus' }
];

window.STATION_INDEX = window.STATIONS.reduce(function (acc, s, i) {
  acc[s.id] = i;
  return acc;
}, {});

/* ------------------------------------------------------------
   Conversion position automate → point kilométrique.
   Constantes reprises de ter-map (railway1.st) :
     PLC_POS_MIN = 120, PLC_POS_MAX = 1960, LINE_LENGTH_KM = 36
   Vérifiée sur 16 relevés successifs des deux trains : la gare
   la plus proche calculée correspond à chaque fois à la zone
   annoncée par l'API.
   ------------------------------------------------------------ */
window.LINE = {
  PLC_MIN: 120,
  PLC_MAX: 1960,
  LENGTH_KM: 36.0
};

window.plcToKm = function (plc) {
  var p = Number(plc);
  if (!isFinite(p)) return null;
  var t = (p - window.LINE.PLC_MIN) / (window.LINE.PLC_MAX - window.LINE.PLC_MIN);
  return Math.max(0, Math.min(1, t)) * window.LINE.LENGTH_KM;
};

window.kmToRatio = function (km) {
  if (km == null) return null;
  return Math.max(0, Math.min(1, km / window.LINE.LENGTH_KM));
};

/* Gare la plus proche d'un point kilométrique */
window.nearestStation = function (km) {
  if (km == null) return null;
  var best = window.STATIONS[0], bd = Infinity;
  for (var i = 0; i < window.STATIONS.length; i++) {
    var d = Math.abs(window.STATIONS[i].pk - km);
    if (d < bd) { bd = d; best = window.STATIONS[i]; }
  }
  return best;
};

/* Gare suivante dans le sens de marche (dir : +1 vers Diamniadio) */
window.nextStation = function (km, dir) {
  if (km == null) return null;
  var list = window.STATIONS;
  if (dir >= 0) {
    for (var i = 0; i < list.length; i++) if (list[i].pk > km + 0.15) return list[i];
    return list[list.length - 1];
  }
  for (var j = list.length - 1; j >= 0; j--) if (list[j].pk < km - 0.15) return list[j];
  return list[0];
};

/* ------------------------------------------------------------
   Sous-station de traction. Elle alimente la caténaire de toute
   la ligne : sa dégradation prive l'ensemble du parcours.
   Nommage aligné sur digital-twin-api/config/assets.json
   (192.168.20.10 → « Automate énergie traction »).
   ------------------------------------------------------------ */
window.POWER_PLANT = {
  id: 'sous-station',
  name: 'SOUS-STATION DE TRACTION',
  plcName: 'Automate énergie traction',
  scadaName: 'SCADA local gare',
  anchorBetween: ['yeumbeul', 'kmf']
};

/* ------------------------------------------------------------
   Services gare supervisés (réseau 192.168.40.0/24).
   Les identifiants correspondent à ceux renvoyés par
   /api/twin/gare/services ; les IP à config/assets.json.
   ------------------------------------------------------------ */
window.GARE_SERVICES = [
  { id: 'billettique', name: 'BILLETTIQUE',  full: 'Billettique Gare',  ip: '192.168.40.11' },
  { id: 'siv',         name: 'SIV',          full: 'SIV Gare',          ip: '192.168.40.12' },
  { id: 'sono',        name: 'SONO',         full: 'SONO Gare',         ip: '192.168.40.13' },
  { id: 'pipc',        name: 'PIPC',         full: 'PIPC',              ip: '192.168.40.14' },
  { id: 'cctv',        name: 'CCTV / VMS',   full: 'CCTV / VMS Gare',   ip: '192.168.40.15' }
];

window.SERVICE_BY_IP = window.GARE_SERVICES.reduce(function (acc, s) {
  acc[s.ip] = s;
  return acc;
}, {});
