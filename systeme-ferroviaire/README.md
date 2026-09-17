# Jumeau Numérique Ferroviaire — TER Dakar / Diamniadio

Package autonome regroupant **les 4 vues** du système ferroviaire et leur socle de
données, orchestré par **un seul `docker-compose.yml`**.

> Sur demande : **ni HTTPS** (certificats auto‑signés) **ni landing page** ne sont inclus.

---

## 1. Les 4 vues

| # | Vue | Port | Conteneur | Rôle |
|---|-----|------|-----------|------|
| 1 | **Représentation physique gare & équipements** | `3011` | `dtf_vue_gare` | Synoptique de la gare, équipements, flux d'attaque |
| 2 | **Supervision globale / PCC** | `3012` | `dtf_vue_globale` | Poste de Commandement Centralisé, corrélation, bannières d'alerte |
| 3 | **Circulation & incidents (ter-map)** | `3001` | `ter-map-frontend` | Carte de la ligne, positions/vitesses des trains, incidents |
| 4 | **Vue 3D sous-station électrique** | `8090` | `dtf_viewer3d_station_b` | Énergie traction, transformateurs, explosion |

Vue bonus consolidée :

| Mur d'écrans temps réel | `3013` | `dtf_mur` | Les 4 vues en direct dans une grille 2×2, cliquables |

---

## 2. Socle de données (automatique)

Ces services tournent « sous » les vues et n'ont pas besoin d'être ouverts manuellement :

| Service | Port | Rôle |
|---------|------|------|
| `plc_station_b` (OpenPLC) | `8081` (web) · `502` (Modbus) | **Cœur de la simulation** : train, vitesse, énergie traction |
| `ter-map-backend` | `4000` | Poll Modbus → positions, vitesses, collisions |
| `viewer3d_station_b` | `8090` | Poll Modbus → températures transformateurs, tension caténaire |
| `digital_twin_api` | `4010` | **Agrège** ter-map + viewer3d + services gare et expose l'état corrélé |
| `gare_siv / sono / pipc / cctv / billettique` | interne | États des équipements métier de la gare |

**Chaîne de données :**

```
PLC Station B (Modbus 502)
   ├── ter-map-backend ──┐
   ├── viewer3d ─────────┼──► digital_twin_api (4010) ──► vue_gare / vue_globale / mur
   └── services gare ────┘
   └── viewer3d (8090)  et  ter-map-frontend (3001) sont aussi des vues directes
```

---

## 3. Lancement

Prérequis : Docker + Docker Compose v2, sur un hôte Linux.

```bash
cd digital-twin-ferroviaire
docker compose up -d --build
```

Premier build : quelques minutes (OpenPLC se compile, ter-map/React se build).

Puis, dans un navigateur **sur l'hôte** :

- http://localhost:3011 — vue gare
- http://localhost:3012 — supervision globale / PCC
- http://localhost:3001 — circulation & incidents (ter-map)
- http://localhost:8090 — vue 3D sous-station
- http://localhost:3013 — mur d'écrans consolidé

Arrêt :

```bash
docker compose down
```

> ℹ️ Si l'hôte n'est pas `localhost` (machine distante), remplacez `localhost` par son IP.
> ter-map appelle son backend sur le **port publié 4000** : ce port doit rester accessible
> depuis le navigateur.

---

## 4. Scénarios de démonstration (`scenarios/`)

Scripts d'attaque ICS joués **depuis un poste attaquant** (ex. conteneur Kali), ciblant
le PLC `192.168.20.10:502`. À l'intérieur de ce package ils sont fournis à titre de
référence — adaptez l'IP cible à votre réseau Docker.

| Script | Scénario | Effet visible |
|--------|----------|---------------|
| `ctc.py` | Collision ferroviaire (CTC) | Bannière collision + indicateur de santé à 0 % (vue globale) |
| `feeder.py` | Emballement thermique transformateur TX2 | Explosion transformateur (3D) + « un train hors service » (vue globale) |
| `traction_survitesse.py` | S7 — emballement de traction (race condition Modbus) | Martèlement des consignes de vitesse |
| `netcarto.py` | Cartographie réseau / reconnaissance | (sert côté poste attaquant ; interface premium) |

Exemple :

```bash
python3 scenarios/feeder.py            # explosion transformateur
python3 scenarios/ctc.py               # collision
python3 scenarios/traction_survitesse.py --reset   # rétablit les consignes
```

---

## 5. Limites connues de ce package

- **Alertes réseau (Suricata / Oculox) non incluses.** Elles proviennent d'une stack
  IDS séparée (capteur + routeurs + Oculox). Le dossier `digital-twin-api/oculox-live`
  est monté vide : l'API démarre normalement et les **scénarios physiques**
  (collision, explosion transformateur, survitesse) fonctionnent pleinement car ils
  sont dérivés du PLC via ter-map/viewer3d. Seules les flèches de *reconnaissance
  réseau* (déclenchées par un scan netcarto et corrélées par Suricata) n'apparaissent
  pas sans cette stack.
- **Station A, SCADA (FUXA), routeurs, capteur, portail, EWS** ne sont pas inclus :
  inutiles au fonctionnement des 4 vues.
- Réseaux et IP internes conservés (`192.168.20/30/40.0/24`) pour ne modifier aucune
  adresse codée en dur dans les configurations.

---

## 6. Arborescence

```
digital-twin-ferroviaire/
├── docker-compose.yml          ← orchestration unique
├── README.md
├── digital-twin-api/           API d'agrégation (Node.js) + config (assets, règles)
├── ter-map/                    backend (Modbus/WS) + frontend (React/Vite) + config
├── viewer3d-station-b/         vue 3D (Python) + assets 3D sous-station
├── station_b/plc_b/            automate OpenPLC (simulation train/énergie)
├── services-gare/              image commune des services gare (SIV/SONO/PIPC/CCTV/billettique)
├── views/
│   ├── vue-gare/               vue 1 (nginx statique + proxy /api)
│   ├── vue-globale/            vue 2 (nginx statique + proxy /api)
│   └── mur/                    mur d'écrans (nginx statique + proxy /api)
└── scenarios/                  scripts d'attaque de démonstration
```
