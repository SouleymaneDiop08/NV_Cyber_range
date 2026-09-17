# Vue Gare - Oculox Digital Twin

Cette vue est l'interface métier Gare du cyber range TER.

Elle ne contient plus de démo codée en dur. Les états, alertes, messages et flèches sont alimentés par la Digital Twin API.

## Source des données

Par défaut, la vue lit :

```text
http://<hote>:4010/api/twin/state
```

L'URL API peut être surchargée :

```text
http://<hote>:3011/?api=http://10.5.6.3:4010
```

## Données consommées

- `health` : état de connexion aux sources du cyber range ;
- `process` : état du PLC, trains, énergie, CTC et SIV ;
- `gare_services` : billettique, SIV, SONO, PIPC et CCTV ;
- `alerts` : alertes Oculox enrichies par la Digital Twin API.

## Logique des flèches

Les flèches orange ou rouges sont générées à partir des alertes récentes :

```text
alerte Oculox récente -> source -> destination -> flèche dans la vue
```

Si aucune alerte récente ne concerne une relation source/destination, la flèche disparaît automatiquement.

La fenêtre de visibilité des flèches actives est de 60 secondes par défaut. Elle peut être modifiée avec :

```text
?ttl=60000
```

Les événements récents et la timeline utilisent une fenêtre d'historique séparée. Les anciennes alertes restent donc consultables même lorsque la flèche disparaît :

```text
?history=1800000
```

Exemple de démonstration avec flèches visibles pendant 2 minutes et historique sur 30 minutes :

```text
http://10.5.6.3:3011/?ttl=120000&history=1800000
```

## Fichiers

- `index.html` : structure de la vue Gare ;
- `styles.css` : design et animations ;
- `app.js` : polling API, rendu des états, alertes et flèches ;
- `assets/gare_scene.png` : fond visuel de la gare.
