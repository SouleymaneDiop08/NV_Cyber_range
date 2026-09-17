# Vue globale d'exploitation — TER Dakar / Diamniadio

Vue opérateur unique, ferroviaire et cyber, alimentée exclusivement par la
`Digital Twin API`. Elle n'embarque aucun scénario, aucune donnée figée et
aucune commande : c'est un observateur.

## Principe

```
ter-map (PLC)  ─┐
viewer3d       ─┼─►  Digital Twin API  ──►  Vue globale
OCULOX/Suricata─┤        :4010                :3012
services gare  ─┘
```

La vue n'interroge **qu'un seul endpoint**, `/api/twin/state`, qui agrège déjà
tout. Le bloc `process` de cette réponse est le snapshot de `ter-map` relayé
tel quel : la cohérence avec la carte dynamique est donc structurelle, pas
recopiée.

## Règles tenues

| Règle | Mise en œuvre |
|---|---|
| Aucune donnée inventée | Chaque valeur affichée provient d'un champ de l'API. Quand une donnée manque, la vue affiche `—` ou `INDISPONIBLE`. |
| Séparation temps réel / historique | Fenêtre active 60 s → flèche et halos. Historique 30 min → journal et panneau incident en mode `ARCHIVÉ`. |
| Historique consultable | La vue mémorise localement les alertes reçues. L'API n'en conserve que 15 min ; sans cette mémoire, l'historique de 30 min serait tronqué. |
| Vocabulaire opérateur | Les libellés viennent de `digital-twin-api/config/rule-mapping.json`. Le champ `scenario` (S1…S6) est présent dans la charge utile et **délibérément jamais affiché**. |
| Noms métier | Fournis par `config/assets.json` (Billettique Gare, SIV Gare, Automate énergie traction, Source inconnue…). |
| Pas d'artefact de simulation | Ni sélecteur de scénario, ni bouton lecture/pause, ni action de remédiation. Seules subsistent les deux flèches de défilement du synoptique. |

## Référentiel de la ligne

`assets/js/data-stations.js` est aligné sur `ter-map`
(`frontend/src/constants/stations.ts`) : **14 arrêts**, M'Bao inclus, avec les
points kilométriques réels issus d'OSM.

Position d'un train :

```
pk_km = (progression_plc - 120) / (1960 - 120) * 36
```

Vérifiée sur 16 relevés successifs : la gare la plus proche calculée
correspond à chaque fois à la zone annoncée par l'API.

Le sens de marche est **déduit du delta de `progression_norm`** (filtre de
bruit 0.0005, dernière direction conservée à l'arrêt), comme dans `ter-map`.
Le champ `direction` de l'API est une étiquette d'identité du train, pas son
sens instantané : les deux trains font la navette.

## Fichiers

```
index.html                  Structure de la vue
assets/css/styles.css       Palette d'origine + composants ajoutés
assets/js/data-stations.js  Référentiel ligne, services gare, conversions
assets/js/api.js            Polling, horodatage, fenêtres, sens de marche
assets/js/mapper.js         Projection état API → modèle d'affichage
assets/js/synoptic.js       Rendu SVG, positions réelles, communications
assets/js/app.js            Rendu des panneaux
nginx.conf                  Statique + proxy /api (même origine)
Dockerfile                  nginx:1.27-alpine
devserver.py                Serveur de validation locale uniquement
```

## Pourquoi un proxy nginx

La vue gare appelle l'API en inter-origine (`hostname:4010`). Ça fonctionne,
mais ça dépend des politiques du navigateur sur les adresses privées. Ici,
nginx sert la page et proxifie `/api` : **même origine**, aucune dépendance.
Le résolveur Docker est déclaré explicitement pour que le redémarrage de
l'API ne laisse pas nginx sur une adresse périmée.

## Paramètres d'URL (mise au point)

| Paramètre | Défaut | Rôle |
|---|---|---|
| `?poll=` | 2000 | Période de rafraîchissement (ms) |
| `?ttl=` | 60000 | Fenêtre temps réel (ms) |
| `?history=` | 1800000 | Fenêtre d'historique (ms) |
| `?api=` | *(vide)* | Base d'API alternative |

## Déploiement

Les fichiers de la vue sont dans `new/Vue globale/`, la surcouche compose à la
racine du projet.

```bash
cd /home/sdiop/ICSHUB_V2_used
COMPOSE="-f docker-compose.yml -f docker-compose.vue-gare.yml -f docker-compose.vue-globale.yml"
docker compose $COMPOSE build vue_globale
docker compose $COMPOSE up -d --no-deps --no-build vue_globale
```

**Construire et démarrer en deux temps, avec `--no-deps`.** Un
`up -d --build vue_globale` en une seule commande se bloque : compose tente
alors de résoudre la dépendance `digital_twin_api` et reste suspendu.
`--no-deps` garantit en outre qu'aucun conteneur existant n'est recréé.

Pour mettre à jour la vue ensuite, les deux mêmes commandes suffisent : seul
`vue_globale` est reconstruit.

- Vue globale : http://10.5.6.3:3012/
- Vue gare (inchangée) : http://10.5.6.3:3011/
- Carte dynamique (inchangée) : http://10.5.6.3:3001/
