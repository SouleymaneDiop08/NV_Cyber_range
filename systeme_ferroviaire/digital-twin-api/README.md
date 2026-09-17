# Digital Twin API OCULOX TER

Cette API est la couche de corrélation entre le procédé ferroviaire, les alertes cyber et les vues métier.

Elle ne commande pas le PLC. Elle consomme les sources existantes, enrichit les données et expose un état unique pour les vues Global, Gare, Ligne et 3D.

## Sources consommées

| Source | Endpoint par défaut | Rôle |
|---|---|---|
| TER Map | `http://ter-map-backend:4000/api/snapshot` | Trains, énergie, SIV, CTC déjà normalisés |
| Vue 3D | `http://viewer3d_station_b:8090/api/telemetry` | Télémétrie énergie détaillée |
| Oculox/Suricata | `OCULOX_PROVIDER` | Alertes cyber |
| Services Gare | `config/gare-services.json` | Billettique, SIV, SONO, PIPC et CCTV simulés |

## Endpoints exposés

```text
GET  /api/health
GET  /api/twin/state
GET  /api/twin/alerts
GET  /api/twin/timeline
GET  /api/twin/incidents
GET  /api/twin/gare/services
POST /api/twin/events
POST /api/twin/reset
GET  /ws/twin
```

`/ws/twin` expose actuellement un flux Server-Sent Events compatible navigateur. Il garde le chemin prévu pour les vues temps réel tout en évitant une dépendance WebSocket supplémentaire dans ce MVP.

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `4010` | Port HTTP de l'API |
| `TER_MAP_URL` | `http://ter-map-backend:4000` | Base URL de la Vue Ligne |
| `VIEWER3D_URL` | `http://viewer3d_station_b:8090` | Base URL de la Vue 3D |
| `OCULOX_PROVIDER` | `disabled` | `disabled`, `http` ou `local-eve` |
| `OCULOX_URL` | vide | URL OpenSearch/Oculox si provider `http` |
| `OCULOX_INDEX` | `malcolm_beats_suricata_*` | Index OpenSearch |
| `OCULOX_EVE_PATH` | vide | Fichier ou dossier `eve.json` si provider `local-eve` |
| `POLL_MS` | `1000` | Fréquence de lecture procédé |
| `ALERT_POLL_MS` | `5000` | Fréquence de lecture alertes |

## Modèle d'enrichissement

L'API enrichit les alertes avec :

- nom métier de la source ;
- nom métier de la destination ;
- scénario associé ;
- zone impactée ;
- message opérateur clair ;
- impact potentiel ;
- impact confirmé ou non par l'état PLC.

Les mappings sont dans :

```text
config/assets.json
config/rule-mapping.json
```

## Tests

```bash
npm test
```

Les tests démarrent des serveurs mock pour `ter-map` et la Vue 3D, injectent une alerte Suricata EVE et vérifient :

- `/api/health` ;
- `/api/twin/state` ;
- enrichissement source/destination ;
- corrélation d'un scénario énergie S5 ;
- génération de timeline.
