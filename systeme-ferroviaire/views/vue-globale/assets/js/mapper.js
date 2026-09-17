/* ============================================================
   Projection de l'état API vers le modèle d'affichage.

   Règle unique et non négociable : tout ce qui est affiché
   provient d'un champ réellement renvoyé par la Digital Twin
   API. Aucune valeur n'est simulée, extrapolée ni temporisée.
   Quand une donnée manque, la vue le dit ("—", "Indisponible")
   au lieu de combler.

   Vocabulaire : les libellés destinés à l'opérateur ne
   contiennent ni identifiant de scénario, ni nom d'outil, ni
   jargon offensif. Le champ `scenario` (S1…S6) présent dans la
   charge utile est délibérément ignoré à l'affichage.
   ============================================================ */
window.Mapper = (function () {
  'use strict';

  var S = window.STATIONS;

  /* ---------- utilitaires ---------- */
  function num(v, dec) {
    if (v == null || v === '' || !isFinite(Number(v))) return null;
    var n = Number(v);
    return dec == null ? n : Number(n.toFixed(dec));
  }
  function show(v, suffix) {
    if (v == null) return '—';
    return suffix ? v + suffix : String(v);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var SEV_RANK = { critical: 3, high: 2, medium: 1, low: 0 };
  function sevTone(sev) {
    if (sev === 'critical') return 'crit';
    if (sev === 'high') return 'crit';
    if (sev === 'medium') return 'watch';
    return 'ok';
  }
  function sevLabel(sev) {
    if (sev === 'critical') return 'ALERTE PRIORITAIRE';
    if (sev === 'high') return 'ALERTE PRIORITAIRE';
    if (sev === 'medium') return 'ACTIVITÉ OBSERVÉE';
    return 'INFORMATION';
  }
  function mostSevere(list) {
    return list.slice().sort(function (a, b) {
      return (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0);
    })[0] || null;
  }

  /* ============================================================
     ÉTAT HORS LIGNE — l'API ne répond pas.
     La vue reste honnête : elle ne rejoue pas le dernier état
     comme s'il était courant.
     ============================================================ */
  function offlineState(snap) {
    var stations = {};
    S.forEach(function (s) {
      stations[s.id] = { tone: 'unknown', op: 'INDISPONIBLE', net: 'INDISPONIBLE', netTone: 'unknown', halo: false, sub: 'DONNÉE INDISPONIBLE' };
    });
    var services = {};
    window.GARE_SERVICES.forEach(function (sv) {
      services[sv.id] = { tone: 'unknown', status: 'INDISPONIBLE', detail: 'Aucune donnée reçue', halo: false };
    });
    return {
      offline: true,
      mode: { label: 'SUPERVISION INDISPONIBLE', tone: 'crit' },
      system: { value: 'INDISPONIBLE', tone: 'crit', sub: snap.lastError ? 'Lien avec le jumeau numérique interrompu' : '', health: null, healthTone: 'crit', trend: 'Aucune donnée depuis la dernière réponse' },
      kpis: [
        { k: 'Trains actifs', v: '—', tone: 'unknown' },
        { k: 'Gares supervisées', v: '—', tone: 'unknown' },
        { k: 'Services gare', v: '—', tone: 'unknown' },
        { k: 'Traction électrique', v: '—', tone: 'unknown' },
        { k: 'Réseau OT', v: '—', tone: 'unknown' },
        { k: 'Détection', v: 'INDISPONIBLE', tone: 'crit' }
      ],
      situation: { title: 'ÉTAT DE LA SUPERVISION', html: 'La vue ne reçoit plus l’état du jumeau numérique. Les informations affichées ne sont plus rafraîchies et ne doivent pas servir de base à une décision d’exploitation.' },
      synNote: 'Phase Dakar — Diamniadio · 14 arrêts',
      synStatus: { text: 'SUPERVISION INDISPONIBLE', tone: 'crit' },
      stations: stations,
      services: services,
      segments: { degraded: false },
      oculox: { branches: {}, busTone: 'crit', connected: false },
      power: emptyPower(),
      trains: {},
      trainOrder: [],
      flows: [],
      flowsTitle: 'COMMUNICATIONS OBSERVÉES',
      flowsNote: 'Aucune donnée disponible.',
      incident: null,
      incidentTitle: 'INCIDENTS ACTIFS',
      incidentTag: 'INDISPONIBLE',
      incidentTagTone: 'crit',
      cyber: {
        tag: 'INDISPONIBLE', tagTone: 'crit',
        stats: [{ v: '—', k: 'ACTIFS<br>SUPERVISÉS', tone: 'unknown' }, { v: '—', k: 'ALERTES<br>PRIORITAIRES', tone: 'unknown' }, { v: '—', k: 'IMPACTS<br>CONFIRMÉS', tone: 'unknown' }],
        bizTitle: 'DERNIER ÉVÉNEMENT', bizHtml: 'Aucune information disponible.'
      },
      cards: { trainsTag: '—', trainsTagTone: 'unknown', garesTag: '—', garesTagTone: 'unknown', garesNote: '', energieTag: 'INDISPONIBLE', energieTagTone: 'crit' },
      timelineTitle: 'ÉVÉNEMENTS RÉCENTS',
      events: [],
      attack: null
    };
  }

  function emptyPower() {
    return {
      hv: null, freq: null, cat: null, catTone: 'unknown',
      tx1: 'Transformateur 1', tx1v: '—', tx1Tone: 'unknown',
      tx2: 'Transformateur 2', tx2v: '—', tx2Tone: 'unknown',
      feeders: 'Feeders 1 · 2', feedersV: '—', feedersTone: 'unknown',
      tone: 'unknown', connected: false
    };
  }

  /* ============================================================
     CONSTRUCTION DE L'ÉTAT D'AFFICHAGE
     ============================================================ */
  function build(snap) {
    if (!snap.twin || !snap.online) return offlineState(snap);

    var twin = snap.twin;
    var proc = twin.process || {};
    var energy = twin.energy || {};
    var gare = twin.gare_services || {};
    var health = twin.health || {};
    var summary = twin.summary || {};

    var active = snap.active || [];
    var history = snap.history || [];
    var confirmed = history.filter(function (a) { return a.impact && a.impact.observed; });
    var activeConfirmed = active.filter(function (a) { return a.impact && a.impact.observed; });

    var st = {
      offline: false,
      stations: {}, services: {}, trains: {}, trainOrder: [],
      segments: { degraded: false },
      oculox: { branches: {}, busTone: 'ok', connected: health.alerts_connected !== false }
    };

    /* ---------- trains ---------- */
    var trains = proc.trains || [];
    var trainAlarmCount = 0;
    trains.forEach(function (t) {
      var id = t.train_id;
      st.trainOrder.push(id);
      var dir = (snap.directions && snap.directions[id] != null) ? snap.directions[id] : 1;
      var km = window.plcToKm(t.progression_plc);
      var near = window.nearestStation(km);
      /* À quai, le prochain arrêt est celui d'après : on repart du
         point kilométrique de la gare et non de celui du train,
         sinon la gare courante est annoncée comme destination. */
      var inStation = near && km != null && Math.abs(km - near.pk) <= 0.3;
      var next = window.nextStation(inStation ? near.pk : km, dir);
      var nextName = (next && near && next.id === near.id) ? 'terminus' : (next ? next.full : '—');
      var alarms = t.alarmes_actives || [];
      trainAlarmCount += alarms.length;

      var running = t.train_en_marche !== false && t.etat_train !== 'arrete';
      var offlineTrain = t.qualite_donnee === 'offline';
      var tone = 'ok';
      if (offlineTrain || t.alm_critique) tone = 'crit';
      else if (t.mode_degrade || t.alm_tension_basse || alarms.length) tone = 'watch';

      /* Statut d'exploitation : reflète l'état réel du procédé */
      var statusTxt;
      if (offlineTrain) statusTxt = 'COMMUNICATION PERDUE';
      else if (t.etat_train === 'arrete' || !running) statusTxt = 'À L’ARRÊT';
      else if (t.mode_degrade) statusTxt = 'MARCHE DÉGRADÉE';
      else statusTxt = 'CIRCULATION NORMALE';

      st.trains[id] = {
        id: id,
        label: (t.label || id).replace(/^Train\s+/i, ''),
        shortLabel: id,
        dir: dir,
        dirLabel: dir >= 0 ? '→ DIAMNIADIO' : '← DAKAR',
        speed: num(t.vitesse_kmh, 0),
        km: km == null ? null : Number(km.toFixed(1)),
        ratio: window.kmToRatio(km),
        posText: describePosition(km, near),
        nearName: near ? near.full : '—',
        nextName: nextName,
        zoneApi: t.siv && t.siv.zone_annoncee ? t.siv.zone_annoncee : null,
        tension: num(t.tension_kv, 2),
        courant: num(t.courant_a, 0),
        status: statusTxt,
        tone: tone,
        running: running,
        offline: offlineTrain,
        signalGreen: t.signal_vert !== false,
        signalLabel: t.signal_rouge ? 'SIGNAL ROUGE' : (t.signal_vert ? 'SIGNAL VERT' : 'SIGNAL INDÉTERMINÉ'),
        signalTone: t.signal_rouge ? 'crit' : 'ok',
        traction: t.catenaire_ok === false ? 'TRACTION DÉGRADÉE' : 'TRACTION OK',
        tractionTone: t.catenaire_ok === false ? 'crit' : 'ok',
        alarms: alarms,
        incidentLevel: num(t.niveau_incident, 0),
        siv: buildSiv(t.siv),
        quality: t.qualite_donnee || 'unknown'
      };
    });

    /* Situation d'un train sur la ligne. En gare quand il est à
       moins de 300 m du marqueur, entre deux arrêts sinon — ne
       jamais répéter la même gare comme repère et comme
       destination. */
    function describePosition(km, near) {
      if (km == null) return 'position indisponible';
      if (near && Math.abs(km - near.pk) <= 0.3) return 'en gare de ' + near.full;
      var L = window.STATIONS, before = L[0], after = L[L.length - 1];
      for (var i = 0; i < L.length - 1; i++) {
        if (km >= L[i].pk && km <= L[i + 1].pk) { before = L[i]; after = L[i + 1]; break; }
      }
      return 'entre ' + before.full + ' et ' + after.full;
    }

    /* ---------- cohérence information voyageurs ---------- */
    function buildSiv(siv) {
      if (!siv) return { coherent: true, label: 'INFORMATION VOYAGEURS CONFORME', tone: 'ok', detail: null };
      var ecart = num(siv.ecart_position, 0) || 0;
      var niveau = num(siv.niveau_desinformation, 0) || 0;
      var retard = num(siv.retard_annonce_min, 0) || 0;
      if (ecart === 0 && niveau === 0) {
        return {
          coherent: true, tone: 'ok',
          label: 'INFORMATION VOYAGEURS CONFORME',
          zone: siv.zone_annoncee || null,
          detail: siv.message || null, retard: retard
        };
      }
      var ecartKm = window.plcToKm(window.LINE.PLC_MIN + Math.abs(ecart));
      return {
        coherent: false, tone: 'crit',
        label: 'INCOHÉRENCE INFORMATION VOYAGEURS',
        zone: siv.zone_annoncee || null,
        detail: siv.message || 'L’information affichée aux voyageurs ne correspond plus à la position réelle du train.',
        ecartKm: ecartKm == null ? null : Number(ecartKm.toFixed(1)),
        retard: retard
      };
    }

    /* ---------- énergie ---------- */
    var grid = energy.grid || {};
    var tx = energy.transformers || {};
    var tx1 = tx.tx1 || {}, tx2 = tx.tx2 || {};
    var fd = energy.feeders || {};
    var f1 = fd.feeder1 || {}, f2 = fd.feeder2 || {};
    var energyAlarms = energy.alarms || [];

    /* Tension caténaire : valeur procédé réelle, commune aux trains */
    var catKv = null;
    trains.forEach(function (t) { if (catKv == null && t.tension_kv != null) catKv = Number(t.tension_kv); });

    var catTone = 'ok';
    if (catKv != null) {
      if (catKv < 20) catTone = 'crit';
      else if (catKv < 23.5) catTone = 'watch';
    } else catTone = 'unknown';

    var feedersClosed = [f1.cb_closed, f2.cb_closed].filter(function (v) { return v === true; }).length;
    var feedersKnown = [f1.cb_closed, f2.cb_closed].filter(function (v) { return v != null; }).length;

    st.power = {
      connected: energy.connected !== false,
      hv: num(grid.voltage, 0),
      freq: num(grid.frequency, 1),
      cat: catKv == null ? null : Number(catKv.toFixed(1)),
      catTone: catTone,
      current: num(grid.current, 0),
      power: num(grid.power, 0),
      tx1: 'Transformateur 1 · ' + show(num(tx1.oil_temp, 0), ' °C'),
      tx1v: tx1.alarm_critical ? 'CRITIQUE' : tx1.alarm_high ? 'TEMPÉRATURE HAUTE' : (tx1.cb_closed === false ? 'HORS SERVICE' : 'NORMAL'),
      tx1Tone: tx1.alarm_critical ? 'crit' : tx1.alarm_high ? 'watch' : (tx1.cb_closed === false ? 'crit' : 'ok'),
      tx2: 'Transformateur 2 · ' + show(num(tx2.oil_temp, 0), ' °C'),
      tx2v: tx2.alarm_critical ? 'CRITIQUE' : tx2.alarm_high ? 'TEMPÉRATURE HAUTE' : (tx2.cb_closed === false ? 'HORS SERVICE' : 'NORMAL'),
      tx2Tone: tx2.alarm_critical ? 'crit' : tx2.alarm_high ? 'watch' : (tx2.cb_closed === false ? 'crit' : 'ok'),
      feeders: 'Feeders 1 · 2',
      feedersV: feedersKnown ? feedersClosed + ' / ' + feedersKnown + ' FERMÉS' : '—',
      feedersTone: (feedersKnown && feedersClosed < feedersKnown) ? 'crit' : (f1.alarm_overload || f2.alarm_overload ? 'crit' : (f1.alarm_imbalance || f2.alarm_imbalance ? 'watch' : 'ok')),
      alarms: energyAlarms,
      busbarLive: energy.busbar ? energy.busbar.live : null
    };
    st.power.tone = (st.power.catTone === 'crit' || st.power.tx1Tone === 'crit' || st.power.tx2Tone === 'crit' || st.power.feedersTone === 'crit')
      ? 'crit'
      : (st.power.catTone === 'watch' || st.power.tx1Tone === 'watch' || st.power.tx2Tone === 'watch' || st.power.feedersTone === 'watch' ? 'watch' : 'ok');

    /* Caténaire dégradée sur toute la ligne : la sous-station
       alimente l'ensemble du parcours. */
    st.segments.degraded = st.power.catTone !== 'ok' && st.power.catTone !== 'unknown';

    /* ---------- services gare ---------- */
    var items = gare.items || [];
    var svcByIp = {};
    var svcDown = 0, svcDegraded = 0;
    window.GARE_SERVICES.forEach(function (def) {
      var it = items.filter(function (x) { return x.id === def.id; })[0];
      var tone = 'unknown', status = 'INDISPONIBLE', detail = 'Aucune donnée reçue';
      if (it) {
        var avail = String(it.availability || '').toLowerCase();
        var conn = it.connected !== false && String(it.status || '').toLowerCase() === 'available';
        if (!conn) { tone = 'crit'; status = 'HORS SERVICE'; svcDown++; }
        else if (avail === 'degraded') { tone = 'crit'; status = 'DÉGRADÉ'; svcDegraded++; }
        else if (avail && avail !== 'nominal') { tone = 'watch'; status = avail.toUpperCase(); svcDegraded++; }
        else { tone = 'ok'; status = 'NOMINAL'; }
        detail = describeService(def.id, it);
      } else { svcDown++; }
      st.services[def.id] = {
        tone: tone, status: status, detail: detail, ip: def.ip,
        name: def.full, halo: false, raw: it || null
      };
      svcByIp[def.ip] = def.id;
    });

    function describeService(id, it) {
      var m = it.metrics || {}, p = it.published || {};
      if (id === 'billettique') return show(num(m.validations_last_hour, 0)) + ' validations · ' + show(num(m.transactions_last_hour, 0)) + ' transactions (1 h)';
      if (id === 'siv') return p.message ? String(p.message) : (show(num(m.messages_active, 0)) + ' message(s) affiché(s)');
      if (id === 'sono') return p.current_announcement ? String(p.current_announcement) : (show(num(m.announcements_today, 0)) + ' annonce(s) aujourd’hui');
      if (id === 'pipc') return 'Signalisation ' + show(p.signal) + ' · aiguille ' + show(p.aiguille);
      if (id === 'cctv') return show(num(m.cameras_online, 0)) + ' / ' + show(num(m.cameras_total, 0)) + ' caméras en ligne';
      return it.role || '';
    }

    /* ---------- gares ---------- */
    /* Les alertes ne portent pas de gare : elles portent des
       actifs (services gare, automates). Le halo de gare est donc
       posé sur Dakar, où sont raccordés les services supervisés,
       et uniquement si une alerte active les concerne. */
    var activeServiceIds = {};
    active.forEach(function (a) {
      [a.source, a.destination].forEach(function (side) {
        if (side && svcByIp[side.ip]) activeServiceIds[svcByIp[side.ip]] = true;
      });
    });
    Object.keys(activeServiceIds).forEach(function (id) { if (st.services[id]) st.services[id].halo = true; });

    var gareHalo = Object.keys(activeServiceIds).length > 0;

    S.forEach(function (s) {
      var tone = 'ok', op = 'OPÉRATIONNELLE', net = 'CONFORME', netTone = 'ok';
      if (s.id === 'dakar') {
        if (svcDown) { tone = 'crit'; op = 'SERVICE DÉGRADÉ'; }
        else if (svcDegraded) { tone = 'watch'; op = 'SERVICE PERTURBÉ'; }
        if (gareHalo) { netTone = 'warn'; net = 'ACTIVITÉ OBSERVÉE'; if (tone === 'ok') tone = 'watch'; }
      }
      if (st.segments.degraded && tone === 'ok') { tone = 'watch'; op = 'TRACTION DÉGRADÉE'; }
      st.stations[s.id] = {
        tone: tone, op: op, net: net, netTone: netTone,
        halo: s.id === 'dakar' && gareHalo,
        sub: s.kind === 'terminus' ? 'TERMINUS' : (s.kind === 'majeure' ? 'GARE PRINCIPALE' : 'GARE'),
        pk: s.pk
      };
      st.oculox.branches[s.id] = (s.id === 'dakar' && gareHalo) ? 'warn' : 'ok';
    });

    /* ---------- circulation / signalisation ----------
       La collision est l'incident maximal. Le signal fait autorité
       est `alm_collision` du PLC — le même que celui affiché par la
       carte ter-map. Une attaque Modbus directe sur l'aiguillage
       peut la provoquer SANS aucune alerte OCULOX : la vue ne doit
       donc pas dépendre d'un événement cyber pour la reconnaître,
       mais lire l'état procédé. */
    var ctc = proc.ctc || {};
    var collisionConfirmed = ctc.alm_collision === true;
    st.ctc = {
      distanceKm: num(ctc.distance_km, 1),
      riskLevel: num(ctc.risk_level, 0) || 0,
      collision: collisionConfirmed,
      aiguille: ctc.aiguille_deviee === true,
      aiguilleAlarm: ctc.alm_aiguille === true
    };
    st.ctc.label = collisionConfirmed ? 'COLLISION CONFIRMÉE'
      : st.ctc.riskLevel > 0 ? 'RISQUE DE RAPPROCHEMENT'
      : (ctc.aiguille_deviee ? 'AIGUILLAGE DÉVIÉ' : 'ESPACEMENT NORMAL');
    st.ctc.tone = collisionConfirmed ? 'crit'
      : (st.ctc.riskLevel > 0 || ctc.aiguille_deviee ? 'watch' : 'ok');

    /* Détail de la collision, assemblé uniquement à partir de
       champs réels : trains à l'arrêt, aiguillage dévié. */
    var stoppedTrains = trains.filter(function (t) {
      return t.train_en_marche === false || t.etat_train === 'arret' || t.etat_train === 'critique';
    });
    st.collision = collisionConfirmed ? {
      title: 'COLLISION FERROVIAIRE',
      lead: 'Deux trains se sont retrouvés sur la même voie et sont entrés en collision. La circulation est interrompue.',
      cause: ctc.aiguille_deviee
        ? 'Aiguillage dévié à la suite d’une commande de contrôle non autorisée sur l’automate de signalisation.'
        : 'Anomalie de signalisation ayant conduit deux trains sur la même voie.',
      trainsStopped: stoppedTrains.length,
      trainsTotal: trains.length,
      distanceKm: num(ctc.distance_km, 2)
    } : null;

    /* ---------- défaut transformateur de traction ----------
       Une surchauffe poussée jusqu'au déclenchement de la
       protection prive de tension le rail alimenté par le
       transformateur, et le train qui y circule s'immobilise.
       Comme la collision, cette attaque est une écriture Modbus
       directe : aucune alerte OCULOX ne l'accompagne. La vue la
       reconnaît donc à l'état énergie, jamais à un événement
       cyber. Tous les champs lus sont réels. */
    var txFault = null;
    var txCandidates = [
      { id: 'TX2', d: tx2 },
      { id: 'TX1', d: tx1 }
    ];
    for (var ti = 0; ti < txCandidates.length; ti++) {
      var cand = txCandidates[ti];
      if (cand.d && (cand.d.alarm_critical === true || cand.d.alarm_high === true)) {
        txFault = {
          id: cand.id,
          critical: cand.d.alarm_critical === true,
          oilTemp: num(cand.d.oil_temp, 0),
          windingTemp: num(cand.d.winding_temp, 0)
        };
        break; /* le plus grave d'abord : TX2 puis TX1, critique prime sur high via le champ */
      }
    }

    /* Trains réellement privés d'alimentation : caténaire coupée
       ou tension basse signalée. C'est le lien factuel entre le
       transformateur en défaut et le train immobilisé. */
    var powerlessTrains = trains.filter(function (t) {
      return t.catenaire_ok === false || t.alm_tension_basse === true;
    });
    var powerlessStopped = powerlessTrains.filter(function (t) {
      return t.train_en_marche === false || t.etat_train === 'arret' || t.etat_train === 'critique';
    });

    st.transformer = null;
    if (txFault) {
      var namesStopped = powerlessStopped.map(function (t) { return (t.label || t.train_id).replace(/^Train\s+/i, ''); });
      var affected = namesStopped.length
        ? 'Le train ' + namesStopped.join(' et ') + ' n’est plus alimenté et s’est immobilisé.'
        : (powerlessTrains.length
          ? 'La tension de traction est dégradée sur une partie de la ligne.'
          : 'Les trains sont ralentis par sécurité.');
      st.transformer = {
        id: txFault.id,
        critical: txFault.critical,
        oilTemp: txFault.oilTemp,
        windingTemp: txFault.windingTemp,
        title: txFault.critical ? 'TRANSFORMATEUR DE TRACTION HORS SERVICE' : 'SURCHAUFFE TRANSFORMATEUR',
        lead: txFault.critical
          ? 'Emballement thermique du transformateur ' + txFault.id + ' — la protection a déclenché. ' + affected
          : 'Le transformateur ' + txFault.id + ' est en surchauffe. ' + affected,
        stoppedNames: namesStopped,
        trainsStopped: powerlessStopped.length,
        trainsTotal: trains.length
      };
    }

    /* ---------- indicateur de santé ----------
       Dérivé, jamais inventé : chaque point retiré correspond à un
       signal réellement remonté par l'API. */
    var healthScore = 100;
    var healthReasons = [];
    if (health.process_connected === false) { healthScore -= 25; healthReasons.push('source procédé indisponible'); }
    if (health.energy_connected === false) { healthScore -= 15; healthReasons.push('source énergie indisponible'); }
    if (health.alerts_connected === false) { healthScore -= 15; healthReasons.push('détection indisponible'); }
    if (health.gare_services_connected === false) { healthScore -= 10; healthReasons.push('services gare indisponibles'); }
    if (svcDown) { healthScore -= 8 * svcDown; healthReasons.push(svcDown + ' service(s) gare hors service'); }
    if (svcDegraded) { healthScore -= 4 * svcDegraded; healthReasons.push(svcDegraded + ' service(s) gare dégradé(s)'); }
    if (trainAlarmCount) { healthScore -= 5 * trainAlarmCount; healthReasons.push(trainAlarmCount + ' alarme(s) train'); }
    healthScore -= 5 * energyAlarms.length;
    if (energyAlarms.length) healthReasons.push(energyAlarms.length + ' alarme(s) énergie');
    if (st.power.catTone === 'crit') { healthScore -= 20; healthReasons.push('tension caténaire hors plage'); }
    else if (st.power.catTone === 'watch') { healthScore -= 8; healthReasons.push('tension caténaire basse'); }
    healthScore -= 10 * activeConfirmed.length;
    if (activeConfirmed.length) healthReasons.push(activeConfirmed.length + ' impact(s) confirmé(s)');

    /* Défaut transformateur : lourd, car il touche l'alimentation
       de traction. Chaque train réellement privé d'alimentation
       retire davantage — un train à l'arrêt est un impact majeur. */
    if (st.transformer && st.transformer.critical) {
      healthScore -= 25;
      healthReasons.push('transformateur ' + st.transformer.id + ' hors service');
    } else if (st.transformer) {
      healthScore -= 10;
      healthReasons.push('surchauffe transformateur ' + st.transformer.id);
    }
    if (powerlessStopped.length) {
      healthScore -= 25 * powerlessStopped.length;
      healthReasons.push(powerlessStopped.length + ' train(s) privé(s) d’alimentation');
    }
    healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));

    /* Une collision ferroviaire annule l'indicateur : il n'existe
       pas de situation d'exploitation « partiellement saine » quand
       deux trains sont entrés en collision. Ce forçage vient après
       le calcul, de sorte que rien ne puisse le remonter. */
    if (st.ctc.collision) {
      healthScore = 0;
      healthReasons.unshift('collision ferroviaire confirmée');
    }

    st.system = {
      health: healthScore,
      healthTone: healthScore >= 90 ? 'ok' : healthScore >= 70 ? 'watch' : 'crit',
      trend: healthReasons.length ? 'Écarts pris en compte : ' + healthReasons.join(', ') + '.' : 'Aucun écart relevé sur les sources supervisées.'
    };

    /* ---------- bandeau d'incident majeur ----------
       Un seul bandeau, pour l'incident physique le plus grave du
       moment : collision d'abord, défaut transformateur ensuite.
       C'est le message que l'opérateur voit en premier. */
    if (st.collision) {
      st.banner = {
        level: 'crit',
        title: st.collision.title,
        lead: st.collision.lead,
        metrics: [
          { value: st.collision.trainsStopped + ' / ' + st.collision.trainsTotal, label: 'TRAINS IMMOBILISÉS' },
          { value: '0', unit: '%', label: 'INDICATEUR DE SANTÉ' }
        ]
      };
    } else if (st.transformer) {
      var m = [{ value: st.transformer.oilTemp == null ? '—' : st.transformer.oilTemp, unit: '°C', label: 'HUILE ' + st.transformer.id }];
      if (st.transformer.trainsStopped) {
        m.push({ value: st.transformer.stoppedNames.join(' · ') || String(st.transformer.trainsStopped), label: st.transformer.trainsStopped > 1 ? 'TRAINS IMMOBILISÉS' : 'TRAIN IMMOBILISÉ' });
      }
      st.banner = { level: st.transformer.critical ? 'crit' : 'warn', title: st.transformer.title, lead: st.transformer.lead, metrics: m };
    } else {
      st.banner = null;
    }

    /* ---------- posture générale ----------
       Strates distinctes, comme un opérateur les lit. La collision
       ferroviaire prime sur tout : c'est l'état le plus grave que
       la ligne puisse connaître ; le défaut transformateur critique
       vient juste après (impact physique constaté : train arrêté). */
    var recent = history.length;
    if (st.ctc.collision) {
      st.mode = { label: 'COLLISION FERROVIAIRE', tone: 'crit' };
      st.system.value = 'CRITIQUE';
      st.system.tone = 'crit';
      st.system.sub = 'Deux trains sur la même voie — circulation interrompue';
    } else if (st.transformer && st.transformer.critical) {
      st.mode = { label: 'TRANSFORMATEUR HORS SERVICE', tone: 'crit' };
      st.system.value = 'DÉGRADÉE';
      st.system.tone = 'crit';
      st.system.sub = st.transformer.trainsStopped ? 'Train immobilisé par perte d’alimentation' : 'Alimentation de traction compromise';
    } else if (activeConfirmed.length || confirmed.length) {
      st.mode = { label: 'INCIDENT EN COURS', tone: 'crit' };
      st.system.value = 'DÉGRADÉE';
      st.system.tone = 'crit';
      st.system.sub = 'Impact confirmé par l’état du procédé';
    } else if (active.length) {
      var worst = mostSevere(active);
      var isPrio = worst && SEV_RANK[worst.severity] >= 2;
      st.mode = { label: isPrio ? 'ALERTE PRIORITAIRE' : 'ACTIVITÉ OBSERVÉE', tone: isPrio ? 'crit' : 'watch' };
      st.system.value = 'SOUS SURVEILLANCE';
      st.system.tone = 'watch';
      st.system.sub = 'Aucun impact confirmé sur l’exploitation';
    } else if (recent) {
      st.mode = { label: 'VIGILANCE', tone: 'watch' };
      st.system.value = 'NOMINALE';
      st.system.tone = 'ok';
      st.system.sub = 'Activité récente sans impact confirmé';
    } else if (st.transformer || st.power.tone === 'crit' || trainAlarmCount) {
      st.mode = { label: st.transformer ? 'SURCHAUFFE TRANSFORMATEUR' : 'EXPLOITATION DÉGRADÉE', tone: st.transformer && !st.transformer.critical ? 'watch' : 'crit' };
      st.system.value = 'DÉGRADÉE';
      st.system.tone = st.transformer && !st.transformer.critical ? 'watch' : 'crit';
      st.system.sub = 'Anomalie procédé sans événement cyber associé';
    } else {
      st.mode = { label: 'MODE NOMINAL', tone: 'ok' };
      st.system.value = 'NOMINALE';
      st.system.tone = 'ok';
      st.system.sub = '';
    }

    /* ---------- indicateurs ---------- */
    var running = trains.filter(function (t) { return t.train_en_marche !== false && t.etat_train !== 'arrete'; }).length;
    var svcOk = window.GARE_SERVICES.length - svcDown - svcDegraded;
    st.kpis = [
      { k: 'Trains en circulation', v: running + ' / ' + (trains.length || 0), tone: trains.length && running < trains.length ? 'watch' : 'ok' },
      { k: 'Arrêts supervisés', v: S.length + ' / ' + S.length, tone: 'ok' },
      { k: 'Services gare', v: svcOk + ' / ' + window.GARE_SERVICES.length, tone: svcDown ? 'crit' : svcDegraded ? 'watch' : 'ok' },
      { k: 'Signalisation', v: st.ctc.label === 'ESPACEMENT NORMAL' ? 'NORMALE' : st.ctc.label, tone: st.ctc.tone },
      { k: 'Traction électrique', v: st.power.cat == null ? '—' : st.power.cat + ' kV', tone: st.power.catTone },
      { k: 'Détection réseau', v: health.alerts_connected === false ? 'INDISPONIBLE' : 'ACTIVE', tone: health.alerts_connected === false ? 'crit' : 'ok' }
    ];

    /* ---------- point de situation ----------
       Le texte est construit depuis l'état que la vue détient
       réellement. La synthèse de l'API porte sur sa propre fenêtre
       (15 min) alors que la vue en conserve 30 : la reprendre telle
       quelle ferait cohabiter « aucun incident » avec un journal
       qui affiche encore des événements. La synthèse API n'est
       donc citée que lorsqu'elle porte sur la même réalité. */
    st.situation = {
      title: 'DERNIER POINT DE SITUATION',
      html: esc(situationText()) +
        (st.system.trend ? ' <span class="sit-dim">' + esc(st.system.trend) + '</span>' : '')
    };

    function situationText() {
      if (st.collision) {
        return 'Collision ferroviaire confirmée par la signalisation : ' +
          st.collision.trainsStopped + ' train(s) immobilisé(s) sur ' + st.collision.trainsTotal + '. ' +
          st.collision.cause;
      }
      if (st.transformer) {
        return st.transformer.lead +
          (st.transformer.oilTemp != null ? ' Température de l’huile : ' + st.transformer.oilTemp + ' °C.' : '');
      }
      if (activeConfirmed.length || confirmed.length) {
        var n = (activeConfirmed.length || confirmed.length);
        return n + ' impact(s) métier confirmé(s) par l’état du procédé. Les conséquences sont visibles sur l’exploitation.';
      }
      if (active.length) {
        return active.length + ' communication(s) anormale(s) en cours sur le réseau supervisé. ' +
          'Aucun impact confirmé sur la circulation, l’alimentation ou les services voyageurs à ce stade.';
      }
      if (history.length) {
        return 'Aucune communication anormale en cours. ' + history.length +
          ' événement(s) restent consultables au journal sur les ' +
          Math.round(window.TwinAPI.HISTORY_WINDOW_MS / 60000) + ' dernières minutes, sans impact confirmé.';
      }
      /* Aucun événement : la synthèse de l'API dit la même chose. */
      return summary.message || 'Aucun incident cyber ou impact métier confirmé.';
    }

    /* ---------- communications observées ----------
       Le panneau ne compte pas de paquets : l'API n'en fournit
       pas. Il liste les communications réellement signalées. */
    st.flowsTitle = active.length ? 'COMMUNICATIONS OBSERVÉES · EN COURS' : 'COMMUNICATIONS OBSERVÉES';
    st.flows = active.slice(0, 4).map(function (a) {
      return {
        title: (a.source && a.source.name ? a.source.name : 'Source inconnue') + ' → ' + (a.destination && a.destination.name ? a.destination.name : 'Destination inconnue'),
        sub: a.title || 'Communication signalée',
        count: a.protocol ? a.protocol + (a.destination_port ? ' · port ' + a.destination_port : '') : '—',
        unit: '',
        tone: sevTone(a.severity)
      };
    });
    st.flowsNote = active.length
      ? active.length + ' communication(s) signalée(s) dans la fenêtre temps réel.'
      : (history.length
        ? 'Aucune communication signalée en ce moment. ' + history.length + ' événement(s) conservé(s) à l’historique.'
        : 'Aucune communication anormale signalée sur le réseau supervisé.');

    /* ---------- synoptique ---------- */
    st.synNote = 'Phase Dakar — Diamniadio · ' + S.length + ' arrêts · ' + window.LINE.LENGTH_KM.toFixed(0) + ' km · voie électrifiée';
    st.synStatus = st.collision ? {
      text: 'COLLISION FERROVIAIRE — CIRCULATION INTERROMPUE',
      tone: 'crit'
    } : (st.transformer && st.transformer.critical) ? {
      text: 'TRANSFORMATEUR ' + st.transformer.id + ' HORS SERVICE — ALIMENTATION DE TRACTION PERDUE',
      tone: 'crit'
    } : {
      text: active.length
        ? active.length + ' COMMUNICATION(S) SIGNALÉE(S) — FENÊTRE TEMPS RÉEL'
        : (st.segments.degraded ? 'ALIMENTATION DE TRACTION DÉGRADÉE' : 'AUCUNE ANOMALIE SIGNALÉE SUR LE RÉSEAU SUPERVISÉ'),
      tone: active.length ? (mostSevere(active) && SEV_RANK[mostSevere(active).severity] >= 2 ? 'crit' : 'watch') : (st.segments.degraded ? 'crit' : 'ok')
    };
    st.oculox.busTone = active.length ? 'warn' : 'ok';

    /* ---------- représentation de la communication signalée ----------
       Une flèche n'existe que tant qu'une alerte est active. */
    st.attack = null;
    var lead = mostSevere(active);
    if (lead) {
      var targetSvc = lead.destination && svcByIp[lead.destination.ip] ? svcByIp[lead.destination.ip] : null;
      var targetIsPlant = lead.destination && String(lead.destination.ip || '').indexOf('192.168.20.') === 0;
      st.attack = {
        kind: SEV_RANK[lead.severity] >= 2 ? 'crit' : 'warn',
        target: targetIsPlant ? 'plant' : (targetSvc ? 'service:' + targetSvc : 'gare:dakar'),
        sourceName: lead.source && lead.source.name ? lead.source.name : 'Source inconnue',
        destName: lead.destination && lead.destination.name ? lead.destination.name : '—',
        label: lead.title || 'Communication signalée'
      };
    }

    /* ---------- carte détection ---------- */
    var prio = history.filter(function (a) { return SEV_RANK[a.severity] >= 2; }).length;

    /* Actifs supervisés : uniquement ceux dont la vue reçoit
       réellement un état. Aucune constante d'affichage. */
    var supervised = (gare.count != null ? gare.count : items.length) + trains.length + (energy.connected !== false ? 1 : 0);

    var cyberTag, cyberTone;
    if (health.alerts_connected === false) { cyberTag = 'INDISPONIBLE'; cyberTone = 'crit'; }
    else if (active.length) {
      var lead2 = mostSevere(active) || {};
      cyberTag = SEV_RANK[lead2.severity] >= 2 ? 'ALERTE PRIORITAIRE' : 'ACTIVITÉ OBSERVÉE';
      cyberTone = SEV_RANK[lead2.severity] >= 2 ? 'crit' : 'watch';
    } else if (history.length) { cyberTag = 'VIGILANCE'; cyberTone = 'watch'; }
    else { cyberTag = 'NORMAL'; cyberTone = 'ok'; }

    st.cyber = {
      tag: cyberTag,
      tagTone: cyberTone,
      stats: [
        { v: String(supervised), k: 'ACTIFS<br>SUPERVISÉS', tone: 'ok' },
        { v: String(prio), k: 'ALERTES<br>PRIORITAIRES', tone: prio ? 'crit' : 'ok' },
        { v: String(confirmed.length), k: 'IMPACTS<br>CONFIRMÉS', tone: confirmed.length ? 'crit' : 'ok' }
      ],
      bizTitle: active.length ? 'ÉVÉNEMENT EN COURS' : 'DERNIER ÉVÉNEMENT',
      bizHtml: buildCyberBiz(active, history, health)
    };

    function buildCyberBiz(act, hist, h) {
      if (h.alerts_connected === false) return 'La chaîne de détection réseau ne répond pas. Aucune alerte ne peut être remontée.';
      var a = act[0] || hist[0];
      if (!a) return 'Aucun événement signalé sur la période supervisée. Les communications observées sont conformes au référentiel.';
      var src = a.source && a.source.name ? a.source.name : 'Source inconnue';
      var dst = a.destination && a.destination.name ? a.destination.name : '—';
      return '<b>' + esc(src) + ' → ' + esc(dst) + '.</b> ' + esc(a.operator_message || a.title || '') +
        ' <span class="cb-impact">' + esc(a.impact ? a.impact.status : 'Aucun impact confirmé') + '.</span>';
    }

    /* ---------- panneau incident ----------
       La collision prend la tête du panneau : c'est l'incident que
       l'opérateur doit voir en premier, avant toute alerte réseau. */
    st.incidentTitle = 'INCIDENTS ACTIFS';
    if (st.collision) {
      st.incidentTag = 'COLLISION';
      st.incidentTagTone = 'crit';
      st.incident = buildCollisionIncident(st);
    } else if (st.transformer && st.transformer.critical) {
      st.incidentTag = 'ÉNERGIE';
      st.incidentTagTone = 'crit';
      st.incident = buildTransformerIncident(st);
    } else {
      st.incidentTag = active.length ? 'TEMPS RÉEL · ' + active.length : (history.length ? 'HISTORIQUE · ' + history.length : 'AUCUN');
      st.incidentTagTone = active.length ? 'watch' : '';
      st.incident = buildIncident(lead || history[0], Boolean(lead), st);
    }

    /* Incident transformateur : bâti sur l'état énergie. La chaîne
       va de l'écriture Modbus sur le procédé jusqu'au train arrêté. */
    function buildTransformerIncident(state) {
      var tr = state.transformer;
      var effets = [
        { k: 'Transformateur ' + tr.id, v: (tr.oilTemp == null ? '—' : tr.oilTemp + ' °C') + ' · PROTECTION DÉCLENCHÉE', tone: 'crit' }
      ];
      Object.keys(state.trains).forEach(function (id) {
        var t = state.trains[id];
        if (t.tone !== 'ok') effets.push({ k: 'Train ' + t.label, v: t.status + ' · ' + show(t.speed, ' km/h'), tone: t.tone });
      });
      if (state.power.cat != null) effets.push({ k: 'Tension caténaire', v: state.power.cat + ' kV', tone: state.power.catTone });
      return {
        level: 'crit',
        live: true,
        collision: true,
        title: tr.title,
        sub: 'EN COURS · ' + fmtClock(twin.timestamp),
        lead: tr.lead,
        blocks: [
          {
            t: 'ORIGINE',
            tone: 'crit',
            rows: [
              { k: 'Équipement', v: 'Automate énergie traction', tone: '' },
              { k: 'Nature', v: 'Emballement thermique ' + tr.id, tone: 'crit' },
              { k: 'Huile ' + tr.id, v: tr.oilTemp == null ? '—' : tr.oilTemp + ' °C', tone: 'crit' },
              { k: 'Bobinage ' + tr.id, v: tr.windingTemp == null ? '—' : tr.windingTemp + ' °C', tone: 'crit' }
            ]
          },
          { t: 'CONSÉQUENCES CONSTATÉES SUR L’EXPLOITATION', tone: 'crit', rows: effets }
        ],
        impact: {
          level: 'crit',
          t: 'IMPACT SUR L’EXPLOITATION',
          v: tr.trainsStopped ? (tr.stoppedNames.join(' et ') + ' immobilisé' + (tr.trainsStopped > 1 ? 's' : '')) : 'Alimentation de traction dégradée',
          s: tr.lead
        },
        chain: ['ÉVÉNEMENT RÉSEAU', 'AUTOMATE ÉNERGIE', 'TRANSFORMATEUR', 'ALIMENTATION', 'TRAIN ARRÊTÉ'],
        chainOn: 5
      };
    }

    /* Incident de collision : bâti à partir de l'état procédé, pas
       d'une alerte cyber. La chaîne d'impact est entièrement
       allumée — l'événement a traversé toutes les couches jusqu'à
       la collision physique. */
    function buildCollisionIncident(state) {
      var col = state.collision;
      var effets = [];
      Object.keys(state.trains).forEach(function (id) {
        var t = state.trains[id];
        effets.push({ k: 'Train ' + t.label, v: t.status + ' · ' + show(t.speed, ' km/h'), tone: 'crit' });
      });
      if (state.ctc.distanceKm != null) {
        effets.push({ k: 'Distance inter-trains', v: state.ctc.distanceKm + ' km', tone: 'crit' });
      }
      return {
        level: 'crit',
        live: true,
        collision: true,
        title: col.title,
        sub: 'EN COURS · ' + fmtClock(twin.timestamp),
        lead: col.lead,
        blocks: [
          {
            t: 'ORIGINE',
            tone: 'crit',
            rows: [
              { k: 'Cause', v: state.ctc.aiguille ? 'Aiguillage dévié' : 'Anomalie de signalisation', tone: 'crit' },
              { k: 'Signalisation', v: 'COLLISION CONFIRMÉE', tone: 'crit' }
            ]
          },
          { t: 'CONSÉQUENCES CONSTATÉES SUR L’EXPLOITATION', tone: 'crit', rows: effets }
        ],
        impact: {
          level: 'crit',
          t: 'IMPACT SUR L’EXPLOITATION',
          v: 'Collision confirmée · circulation interrompue',
          s: col.cause
        },
        chain: ['ÉVÉNEMENT RÉSEAU', 'SIGNALISATION', 'AIGUILLAGE', 'TRAINS', 'COLLISION'],
        chainOn: 5
      };
    }

    function buildIncident(a, isLive, state) {
      if (!a) return null;
      var src = a.source || {}, dst = a.destination || {};
      var isConfirmed = a.impact && a.impact.observed;

      var blocks = [{
        t: 'ÉLÉMENTS OBSERVÉS',
        tone: isConfirmed ? 'crit' : 'watch',
        rows: [
          { k: 'Origine', v: src.name || 'Source inconnue', tone: src.type === 'attacker' ? 'crit' : '' },
          { k: 'Cible', v: dst.name || '—' },
          { k: 'Rôle de la cible', v: dst.business_role || '—' },
          { k: 'Nature', v: a.title || '—' },
          { k: 'Niveau', v: sevLabel(a.severity), tone: SEV_RANK[a.severity] >= 2 ? 'crit' : 'watch' }
        ]
      }];

      /* Conséquences réellement observables sur le procédé */
      var effets = [];
      if (state.power.catTone !== 'ok' && state.power.cat != null) {
        effets.push({ k: 'Tension caténaire', v: state.power.cat + ' kV', tone: state.power.catTone });
      }
      Object.keys(state.trains).forEach(function (id) {
        var t = state.trains[id];
        if (t.tone !== 'ok') effets.push({ k: 'Train ' + t.label, v: t.status + ' · ' + show(t.speed, ' km/h'), tone: t.tone });
        if (t.siv && !t.siv.coherent) effets.push({ k: 'Information voyageurs ' + t.label, v: 'INCOHÉRENTE', tone: 'crit' });
      });
      if (state.ctc.tone !== 'ok') effets.push({ k: 'Espacement des trains', v: show(state.ctc.distanceKm, ' km'), tone: state.ctc.tone });
      Object.keys(state.services).forEach(function (sid) {
        var sv = state.services[sid];
        if (sv.tone === 'crit') effets.push({ k: sv.name, v: sv.status, tone: 'crit' });
      });
      if (effets.length) blocks.push({ t: 'CONSÉQUENCES CONSTATÉES SUR L’EXPLOITATION', tone: 'crit', rows: effets });

      return {
        level: SEV_RANK[a.severity] >= 2 ? 'crit' : 'watch',
        live: isLive,
        title: a.title || 'Événement signalé',
        sub: (isLive ? 'EN COURS' : 'ARCHIVÉ') + ' · ' + fmtClock(a.timestamp),
        lead: a.operator_message || '',
        blocks: blocks,
        impact: {
          level: isConfirmed ? 'crit' : 'ok',
          t: 'IMPACT SUR L’EXPLOITATION',
          v: a.impact ? a.impact.status : 'Aucun impact confirmé',
          s: a.impact ? a.impact.details : (a.potential_impact || '')
        },
        chain: ['ÉVÉNEMENT RÉSEAU', 'ÉQUIPEMENT', 'PROCÉDÉ', 'TRAIN', 'EXPLOITATION'],
        chainOn: computeChain(a, state)
      };
    }

    /* Progression de la chaîne d'impact : chaque cran allumé
       correspond à un fait constaté, pas à une hypothèse. */
    function computeChain(a, state) {
      var n = 1;                                   /* l'événement réseau est constaté */
      var dst = a.destination || {};
      if (dst.ip) n = 2;                           /* un équipement identifié est visé */
      var procDegraded = state.power.tone !== 'ok' || (state.power.alarms || []).length > 0;
      if (procDegraded) n = 3;
      var trainDegraded = Object.keys(state.trains).some(function (id) { return state.trains[id].tone !== 'ok'; });
      if (trainDegraded) n = 4;
      if (a.impact && a.impact.observed) n = 5;
      return n;
    }

    /* ---------- cartes ---------- */
    st.cards = {
      trainsTag: trains.length ? running + ' EN LIGNE · ' + trainAlarmCount + ' ALARME(S)' : 'AUCUNE DONNÉE',
      trainsTagTone: trainAlarmCount ? 'crit' : 'ok',
      garesTag: S.length + ' / ' + S.length + ' SUPERVISÉS',
      garesTagTone: 'ok',
      garesNote: svcDown || svcDegraded
        ? svcOk + ' service(s) gare nominaux, ' + (svcDegraded + svcDown) + ' en écart.'
        : 'Billettique, information voyageurs, annonces, interface signalisation et vidéosurveillance nominaux.',
      energieTag: st.power.connected === false ? 'INDISPONIBLE' : (st.power.tone === 'crit' ? 'DÉGRADÉE' : st.power.tone === 'watch' ? 'À SURVEILLER' : 'DISPONIBLE'),
      energieTagTone: st.power.tone,
      servicesTag: svcOk + ' / ' + window.GARE_SERVICES.length + ' NOMINAUX',
      servicesTagTone: svcDown ? 'crit' : svcDegraded ? 'watch' : 'ok'
    };

    /* ---------- journal des événements ----------
       Historique complet (30 min), les actifs en tête. Les
       identifiants de scénario ne sont jamais repris. */
    st.timelineTitle = 'JOURNAL DES ÉVÉNEMENTS · ' + Math.round(window.TwinAPI.HISTORY_WINDOW_MS / 60000) + ' DERNIÈRES MINUTES';
    st.events = history.map(function (a) {
      var live = window.TwinAPI.ageMs(a.timestamp) <= window.TwinAPI.ACTIVE_WINDOW_MS;
      return {
        t: fmtClock(a.timestamp),
        ts: a.timestamp,
        live: live,
        lv: SEV_RANK[a.severity] >= 2 ? 'crit' : (a.severity === 'medium' ? 'warn' : 'info'),
        l: a.title || a.operator_message || 'Événement signalé',
        msg: a.operator_message || '',
        src: (a.source && a.source.name) || 'Source inconnue',
        dst: (a.destination && a.destination.name) || '—',
        impact: a.impact ? a.impact.status : 'Aucun impact confirmé',
        confirmed: Boolean(a.impact && a.impact.observed)
      };
    });

    /* Les alarmes procédé rejoignent le journal : ce sont des
       faits d'exploitation, indépendants de toute alerte cyber. */
    (proc.alarms || []).concat(energyAlarms).forEach(function (al) {
      st.events.push({
        t: fmtClock(twin.timestamp), ts: twin.timestamp, live: true, lv: 'warn',
        l: al.label || 'Alarme procédé', msg: al.label || '', src: 'Procédé', dst: '—',
        impact: 'Constaté sur le procédé', confirmed: true, process: true
      });
    });

    st.counts = {
      active: active.length,
      history: history.length,
      confirmed: confirmed.length,
      priority: prio
    };

    st.sources = {
      process: health.process_connected !== false,
      energy: health.energy_connected !== false,
      alerts: health.alerts_connected !== false,
      gare: health.gare_services_connected !== false
    };
    st.dataAgeMs = snap.ageOfDataMs;
    st.apiTimestamp = twin.timestamp;

    return st;
  }

  function fmtClock(ts) {
    var d = new Date(window.TwinAPI.parseTs(ts));
    if (isNaN(d.getTime())) return '--:--:--';
    return d.toLocaleTimeString('fr-FR', { hour12: false });
  }

  return { build: build, fmtClock: fmtClock };
})();
