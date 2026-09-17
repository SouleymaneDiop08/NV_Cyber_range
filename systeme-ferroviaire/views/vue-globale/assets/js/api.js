/* ============================================================
   Couche d'accès à la Digital Twin API.

   Un seul point de corrélation : /api/twin/state renvoie déjà
   l'état procédé (relayé de ter-map), l'énergie, les services
   gare, les alertes OCULOX enrichies, les incidents, la timeline
   et une synthèse. La vue n'interroge donc aucun autre backend.

   Cette couche ne décide rien de l'affichage : elle collecte,
   normalise et fenêtre. Aucune donnée n'est fabriquée ici.
   ============================================================ */
window.TwinAPI = (function () {
  'use strict';

  var params = new URLSearchParams(location.search);

  /* La vue est servie derrière un nginx qui proxifie /api vers
     l'API : même origine, aucune dépendance aux politiques
     navigateur sur les requêtes inter-origines. Le paramètre
     ?api= permet de pointer une API distante en secours. */
  var BASE = (params.get('api') || '').replace(/\/$/, '');

  var POLL_MS = Number(params.get('poll') || 2000);
  var ACTIVE_WINDOW_MS = Number(params.get('ttl') || 60000);          /* flèches temps réel */
  var HISTORY_WINDOW_MS = Number(params.get('history') || 30 * 60000); /* historique consultable */
  var STALE_MS = Number(params.get('stale') || 12000);                 /* API considérée muette */

  /* ---------- horodatage ----------------------------------------
     Suricata émet « 2026-09-04T18:17:07.514471+0000 » : six
     décimales et un décalage sans deux-points. Chromium l'accepte,
     mais on ne dépend pas de la tolérance du moteur. */
  function parseTs(value) {
    if (!value) return NaN;
    var direct = Date.parse(value);
    if (!isNaN(direct)) return direct;
    var s = String(value)
      .replace(/(\.\d{3})\d+/, '$1')
      .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    return Date.parse(s);
  }

  function ageMs(value) {
    var ts = parseTs(value);
    return isNaN(ts) ? Infinity : Date.now() - ts;
  }

  /* ---------- état interne -------------------------------------- */
  var twin = null;              /* dernier état complet reçu */
  var lastOkAt = 0;             /* horodatage de la dernière réponse valide */
  var online = false;
  var lastError = null;
  var pollCount = 0;

  var alertStore = new Map();   /* id -> alerte (historique local, 30 min) */
  var dirState = {};            /* train_id -> +1 / -1 */
  var lastNorm = {};            /* train_id -> dernière progression_norm */
  var listeners = [];

  /* ---------- suivi du sens de marche ---------------------------
     Réplique exacte de ter-map (useTrainStore.ts) : le sens est
     déduit du delta de progression, avec filtre de bruit ; à
     l'arrêt, la dernière direction connue est conservée. Le champ
     `direction` de l'API est une étiquette d'identité du train,
     pas son sens de circulation instantané. */
  var DIR_NOISE = 0.0005;

  function trackDirections(trains) {
    (trains || []).forEach(function (t) {
      var id = t.train_id;
      var cur = Number(t.progression_norm);
      if (!isFinite(cur)) return;
      var prev = lastNorm[id];
      if (prev != null) {
        var delta = cur - prev;
        if (Math.abs(delta) > DIR_NOISE) dirState[id] = delta > 0 ? 1 : -1;
      }
      lastNorm[id] = cur;
      if (dirState[id] == null) dirState[id] = 1;
    });
  }

  /* ---------- accumulation de l'historique ----------------------
     L'API ne conserve que sa propre fenêtre (15 min par défaut).
     Pour offrir 30 min d'historique consultable, la vue mémorise
     les alertes déjà vues. Rien n'est inventé : seules des alertes
     réellement reçues sont conservées, puis purgées par âge. */
  function absorbAlerts(alerts) {
    (alerts || []).forEach(function (a) {
      if (!a || !a.id) return;
      if (!alertStore.has(a.id)) alertStore.set(a.id, a);
      else alertStore.set(a.id, Object.assign(alertStore.get(a.id), a));
    });
    alertStore.forEach(function (a, id) {
      if (ageMs(a.timestamp) > HISTORY_WINDOW_MS) alertStore.delete(id);
    });
  }

  /* ---------- sélection ------------------------------------------ */
  function forView(list) {
    return list.filter(function (a) {
      var v = a.views || ['global'];
      return v.indexOf('global') !== -1;
    });
  }

  function byRecency(a, b) {
    return parseTs(b.timestamp) - parseTs(a.timestamp);
  }

  /* Alertes actives : dans la fenêtre temps réel. Ce sont elles,
     et elles seules, qui matérialisent une communication à l'écran. */
  function activeAlerts() {
    return forView(Array.from(alertStore.values()))
      .filter(function (a) { return ageMs(a.timestamp) <= ACTIVE_WINDOW_MS; })
      .sort(byRecency);
  }

  /* Historique : conservé bien après la disparition des flèches. */
  function historyAlerts() {
    return forView(Array.from(alertStore.values()))
      .filter(function (a) { return ageMs(a.timestamp) <= HISTORY_WINDOW_MS; })
      .sort(byRecency);
  }

  /* ---------- polling -------------------------------------------- */
  function fetchState() {
    return fetch(BASE + '/api/twin/state', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      });
  }

  function poll() {
    return fetchState()
      .then(function (data) {
        twin = data;
        lastOkAt = Date.now();
        online = true;
        lastError = null;
        pollCount++;
        trackDirections(data.process && data.process.trains);
        absorbAlerts(data.alerts);
        emit();
      })
      .catch(function (err) {
        lastError = err && err.message ? err.message : String(err);
        if (Date.now() - lastOkAt > STALE_MS) online = false;
        emit();
      });
  }

  function emit() {
    var snap = current();
    listeners.forEach(function (fn) {
      try { fn(snap); } catch (e) { /* un abonné fautif n'interrompt pas les autres */ }
    });
  }

  function current() {
    return {
      twin: twin,
      online: online,
      lastError: lastError,
      lastOkAt: lastOkAt,
      ageOfDataMs: lastOkAt ? Date.now() - lastOkAt : Infinity,
      pollCount: pollCount,
      directions: dirState,
      active: activeAlerts(),
      history: historyAlerts()
    };
  }

  function start() {
    poll();
    setInterval(poll, POLL_MS);
  }

  function onUpdate(fn) { listeners.push(fn); }

  return {
    start: start,
    onUpdate: onUpdate,
    current: current,
    parseTs: parseTs,
    ageMs: ageMs,
    ACTIVE_WINDOW_MS: ACTIVE_WINDOW_MS,
    HISTORY_WINDOW_MS: HISTORY_WINDOW_MS,
    POLL_MS: POLL_MS
  };
})();
