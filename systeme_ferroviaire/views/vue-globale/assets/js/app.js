/* ============================================================
   Contrôleur de la vue globale.

   Aucun moteur de scénario, aucune horloge simulée, aucun bouton
   de commande : la vue est un observateur. Elle reçoit un état,
   elle le rend. Tout ce qui bouge à l'écran bouge parce qu'une
   donnée a changé côté API.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var state = null;
  var historyOpen = false;

  function tone(t) { return t && t !== 'ok' ? ' ' + t : ''; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ============================================================
     RENDU
     ============================================================ */
  function renderAll() {
    if (!state) return;
    renderBanner();
    renderHeader();
    renderSystem();
    renderFlows();
    renderSynopticHead();
    renderCards();
    renderIncident();
    renderCyber();
    renderEvents();
    window.Synoptic.render(state);
  }

  /* Bandeau d'incident majeur — pleine largeur, sous le titre.
     N'apparaît que pour l'incident physique le plus grave du
     moment (collision, défaut transformateur). C'est le message
     que l'opérateur doit voir immédiatement. */
  function renderBanner() {
    var el = $('collision-banner');
    if (!el) return;
    var b = state.banner;
    if (!b) { el.className = 'collision-banner'; el.innerHTML = ''; return; }
    el.className = 'collision-banner show' + (b.level === 'warn' ? ' warn' : '');
    var metrics = (b.metrics || []).map(function (m) {
      return '<div class="cb-metric"><b>' + esc(m.value) + (m.unit ? '<i>' + esc(m.unit) + '</i>' : '') + '</b><span>' + esc(m.label) + '</span></div>';
    }).join('');
    el.innerHTML =
      '<div class="cb-mark">▲</div>' +
      '<div class="cb-txt">' +
        '<div class="cb-title">' + esc(b.title) + '</div>' +
        '<div class="cb-sub">' + esc(b.lead) + '</div>' +
      '</div>' +
      '<div class="cb-meta">' + metrics + '</div>';
  }

  function renderHeader() {
    var mb = $('mode-badge');
    mb.className = 'mode-badge' + tone(state.mode.tone);
    mb.querySelector('span').textContent = state.mode.label;

    /* Bandeau de fiabilité : l'opérateur doit savoir si ce qu'il
       regarde est frais. */
    var link = $('link-state');
    if (state.offline) {
      link.className = 'link-state crit';
      link.textContent = 'DONNÉES NON RAFRAÎCHIES';
    } else {
      var age = Math.round((state.dataAgeMs || 0) / 1000);
      link.className = 'link-state' + (age > 10 ? ' watch' : '');
      link.textContent = 'DONNÉES À JOUR · ' + age + ' s';
    }

    var src = $('source-chips');
    var defs = [['Procédé', state.sources && state.sources.process], ['Énergie', state.sources && state.sources.energy],
                ['Détection', state.sources && state.sources.alerts], ['Services gare', state.sources && state.sources.gare]];
    src.innerHTML = defs.map(function (d) {
      var ok = d[1] !== false && !state.offline;
      return '<span class="src-chip' + (ok ? '' : ' crit') + '"><i></i>' + esc(d[0]) + '</span>';
    }).join('');
  }

  function renderSystem() {
    var sv = $('state-value');
    sv.className = 'state-value' + tone(state.system.tone);
    sv.textContent = state.system.value;
    $('state-sub').textContent = state.system.sub || '';

    $('kpi-list').innerHTML = state.kpis.map(function (k) {
      return '<div class="kpi"><div class="kpi-k">' + esc(k.k) + '</div>' +
        '<div class="kpi-v"><i class="dot' + tone(k.tone) + '"></i>' + esc(k.v) + '</div></div>';
    }).join('');

    var hn = $('health-num');
    hn.textContent = state.system.health == null ? '—' : state.system.health;
    hn.className = state.system.health === 0 ? 'zero' : '';
    var hf = $('health-fill');
    hf.className = state.system.healthTone && state.system.healthTone !== 'ok' ? state.system.healthTone : '';
    hf.style.width = (state.system.health == null ? 0 : state.system.health) + '%';
    $('health-trend').textContent = state.system.trend || '';

    $('situation-title').textContent = state.situation.title;
    $('situation-text').innerHTML = state.situation.html;
  }

  function renderFlows() {
    $('flows-title').textContent = state.flowsTitle;
    var list = $('flow-list');
    if (!state.flows.length) {
      list.innerHTML = '<div class="flow-empty">' + esc(state.flowsNote) + '</div>';
    } else {
      list.innerHTML = state.flows.map(function (f) {
        return '<div class="flow' + tone(f.tone) + '">' +
          '<div class="flow-t">' + esc(f.title) + '</div>' +
          '<div class="flow-s">' + esc(f.sub) + '</div>' +
          '<div class="flow-n">' + esc(f.count) + '</div></div>';
      }).join('') + '<div class="flow-note">' + esc(state.flowsNote) + '</div>';
    }

    var oc = $('oculox-last');
    oc.textContent = state.offline ? 'lien interrompu' : 'il y a ' + Math.round((state.dataAgeMs || 0) / 1000) + ' s';
    oc.className = 'of-time' + (state.offline ? ' crit' : '');
  }

  function renderSynopticHead() {
    $('syn-note').textContent = state.synNote;
    var ss = $('syn-status');
    ss.className = state.synStatus.tone !== 'ok' ? state.synStatus.tone : '';
    ss.textContent = state.synStatus.text;
  }

  function renderCards() {
    /* --- trains --- */
    var tt = $('trains-tag');
    tt.className = 'card-tag' + tone(state.cards.trainsTagTone);
    tt.textContent = state.cards.trainsTag;

    var order = state.trainOrder || [];
    $('trains-list').innerHTML = order.length ? order.map(function (id) {
      var t = state.trains[id];
      var chips = [
        '<span class="chip' + tone(t.tractionTone) + '">' + esc(t.traction) + '</span>',
        '<span class="chip' + tone(t.signalTone) + '">' + esc(t.signalLabel) + '</span>'
      ];
      if (t.siv && !t.siv.coherent) chips.push('<span class="chip crit">INFO VOYAGEURS INCOHÉRENTE</span>');
      (t.alarms || []).forEach(function (a) { chips.push('<span class="chip crit">' + esc(a) + '</span>'); });

      return '<div class="trow' + (t.tone === 'crit' ? ' crit' : (t.tone === 'watch' ? ' watch' : '')) + '">' +
        '<div class="trow-top"><span class="trow-id">' + esc(t.label) + '</span>' +
        '<span class="trow-sp">' + (t.speed == null ? '—' : t.speed) + '<small>km/h</small></span></div>' +
        '<div class="trow-path">' + esc(t.dirLabel) + ' · ' + esc(t.status) + '</div>' +
        '<div class="trow-pos">PK ' + (t.km == null ? '—' : t.km.toFixed(1)) + ' · ' + esc(t.posText) +
        ' · prochain arrêt ' + esc(t.nextName) + '</div>' +
        '<div class="chips">' + chips.join('') + '</div></div>';
    }).join('') : '<div class="flow-empty">Aucune donnée train reçue.</div>';

    /* L'espacement des deux trains est une information de
       circulation : sa place est ici, pas dans la carte énergie. */
    var ct = state.ctc || {};
    $('trains-note').innerHTML = ct.distanceKm == null
      ? ''
      : '<span class="tn-k">Espacement</span> <span class="tn-v' + tone(ct.tone) + '">' +
        ct.distanceKm + ' km · ' + esc(ct.label) + '</span>';

    /* --- services gare --- */
    var st2 = $('services-tag');
    st2.className = 'card-tag' + tone(state.cards.servicesTagTone);
    st2.textContent = state.cards.servicesTag;
    $('services-list').innerHTML = window.GARE_SERVICES.map(function (def) {
      var s = (state.services || {})[def.id] || {};
      return '<div class="srow' + (s.tone === 'crit' ? ' crit' : (s.tone === 'watch' ? ' watch' : '')) + '">' +
        '<div class="srow-h"><span class="srow-n">' + esc(def.full) + '</span>' +
        '<span class="srow-v' + tone(s.tone) + '">' + esc(s.status || '—') + '</span></div>' +
        '<div class="srow-d">' + esc(s.detail || '') + '</div></div>';
    }).join('');
    $('services-note').textContent = state.cards.garesNote;

    /* --- énergie --- */
    var et = $('energie-tag');
    et.className = 'card-tag' + tone(state.cards.energieTagTone);
    et.textContent = state.cards.energieTag;
    var p = state.power;
    $('energy-metrics').innerHTML =
      metric(p.hv, 'kV', 'ARRIVÉE HT', '') +
      metric(p.freq, 'Hz', 'FRÉQUENCE', '') +
      metric(p.cat, 'kV', 'CATÉNAIRE', p.catTone);
    $('energy-rows').innerHTML =
      erow(p.tx1, p.tx1v, p.tx1Tone) +
      erow(p.tx2, p.tx2v, p.tx2Tone) +
      erow(p.feeders, p.feedersV, p.feedersTone);
  }
  function metric(v, u, k, t) {
    return '<div class="em"><div class="em-v' + tone(t) + '">' + (v == null ? '—' : v) +
      '<small>' + (v == null ? '' : u) + '</small></div><div class="em-k">' + k + '</div></div>';
  }
  function erow(k, v, t) {
    return '<div class="er"><span class="er-k">' + esc(k) + '</span><span class="er-v' + tone(t) + '">' + esc(v) + '</span></div>';
  }

  /* ---------- panneau incident ---------- */
  function renderIncident() {
    $('incident-title').textContent = state.incidentTitle;
    var tg = $('incident-tag');
    tg.className = 'card-tag' + tone(state.incidentTagTone);
    tg.textContent = state.incidentTag;

    var body = $('incident-body');
    var inc = state.incident;

    if (!inc) {
      body.innerHTML =
        '<div class="inc-empty"><div class="inc-empty-i">✓</div>' +
        '<div class="inc-empty-t">AUCUN INCIDENT</div>' +
        '<div class="inc-empty-s">' +
        (state.offline
          ? 'L’état du jumeau numérique n’est pas disponible.'
          : 'Exploitation, alimentation de traction et signalisation nominales. Aucune communication anormale signalée sur la période supervisée.') +
        '</div></div>';
      return;
    }

    var crit = inc.level === 'crit';
    var h = '<div class="inc-card' + (crit ? ' crit' : '') + (inc.live ? '' : ' archived') + '">';
    h += '<div class="inc-h">' + esc(inc.title) + '</div>';
    h += '<div class="inc-s">' + esc(inc.sub) + '</div>';
    if (inc.lead) h += '<div class="inc-lead">' + esc(inc.lead) + '</div>';

    (inc.blocks || []).forEach(function (b) {
      h += '<div class="inc-block"><div class="inc-block-t' + tone(b.tone) + '">' + esc(b.t) + '</div>';
      b.rows.forEach(function (r) {
        h += '<div class="inc-r"><span class="inc-k">' + esc(r.k) + '</span>' +
          '<span class="inc-v' + tone(r.tone) + '">' + esc(r.v) + '</span></div>';
      });
      h += '</div>';
    });

    if (inc.impact) {
      h += '<div class="inc-impact' + (inc.impact.level === 'crit' ? ' crit' : '') + '">' +
        '<div class="inc-impact-t">' + esc(inc.impact.t) + '</div>' +
        '<div class="inc-impact-v">' + esc(inc.impact.v) + '</div>' +
        '<div class="inc-impact-s">' + esc(inc.impact.s) + '</div></div>';
    }

    if (inc.chain) {
      h += '<div class="chain">' + inc.chain.map(function (c, i) {
        var on = i < (inc.chainOn || 0);
        var k = on ? (crit ? ' on' : ' warnon') : '';
        return '<span class="chain-i' + k + '">' + esc(c) + '</span>' +
          (i < inc.chain.length - 1 ? '<span class="chain-a">→</span>' : '');
      }).join('') + '</div>';
      h += '<div class="chain-legend">Chaque étape allumée correspond à un fait constaté par la supervision.</div>';
    }

    h += '</div>';
    body.innerHTML = h;
  }

  /* ---------- carte détection ---------- */
  function renderCyber() {
    var ct = $('cyber-tag');
    ct.className = 'card-tag' + tone(state.cyber.tagTone);
    ct.textContent = state.cyber.tag;
    $('cyber-stats').innerHTML = state.cyber.stats.map(function (s) {
      return '<div class="cs"><div class="cs-v' + tone(s.tone) + '">' + esc(s.v) + '</div>' +
        '<div class="cs-k">' + s.k + '</div></div>';
    }).join('');
    $('cyber-biz-title').textContent = state.cyber.bizTitle;
    $('cyber-biz-body').innerHTML = state.cyber.bizHtml;
  }

  /* ---------- journal ----------
     Les événements actifs et l'historique cohabitent, distingués
     visuellement. L'historique reste consultable après la
     disparition des flèches. */
  function renderEvents() {
    $('timeline-title').textContent = state.timelineTitle;
    var c = state.counts || {};
    $('tl-counts').innerHTML =
      '<span class="c-live">EN COURS ' + (c.active || 0) + '</span>' +
      '<span class="c-w">PRIORITAIRES ' + (c.priority || 0) + '</span>' +
      '<span class="c-c">IMPACTS ' + (c.confirmed || 0) + '</span>';

    var evts = state.events || [];
    var track = $('timeline');
    if (!evts.length) {
      track.innerHTML = '<div class="tl-empty">Aucun événement sur la période. La supervision reste active.</div>';
      return;
    }
    track.innerHTML = evts.map(function (e) {
      var k = e.lv === 'crit' ? 'crit' : e.lv === 'warn' ? 'warn' : 'info';
      return '<div class="tl-item ' + k + (e.live ? ' live' : '') + '">' +
        '<div class="tl-t">' + esc(e.t) + (e.live ? ' <i class="tl-live">EN COURS</i>' : '') + '</div>' +
        '<div class="tl-l">' + esc(e.l) + '</div>' +
        '<div class="tl-r">' + esc(e.src) + ' → ' + esc(e.dst) + '</div>' +
        '<div class="tl-i' + (e.confirmed ? ' crit' : '') + '">' + esc(e.impact) + '</div>' +
        '</div>';
    }).join('');
  }

  /* ============================================================
     Horloge locale — l'heure du poste, jamais une heure simulée
     ============================================================ */
  function tickClock() {
    var d = new Date();
    var s = d.toLocaleTimeString('fr-FR', { hour12: false });
    var parts = s.split(':');
    $('clock').innerHTML = parts[0] + ':' + parts[1] + '<small>:' + (parts[2] || '00') + '</small>';
  }

  /* ============================================================
     Démarrage
     ============================================================ */
  function init() {
    window.Synoptic.build($('syn-scroll'), $('syn-canvas'));

    tickClock();
    setInterval(tickClock, 1000);

    window.TwinAPI.onUpdate(function (snap) {
      state = window.Mapper.build(snap);
      renderAll();
    });
    window.TwinAPI.start();

    /* Recentrage sur la communication signalée dès qu'une nouvelle
       apparaît. On vise l'étendue réelle du tracé — encart de
       source compris — et non une gare approchante, sinon l'encart
       se retrouve coupé au bord du cadre. Le défilement manuel de
       l'opérateur reprend la main et n'est jamais contrarié. */
    var lastAttackKey = null;
    setInterval(function () {
      if (!state || !state.attack) { lastAttackKey = null; return; }
      var key = state.attack.target + '|' + state.attack.destName + '|' + state.attack.sourceName;
      if (key !== lastAttackKey) {
        lastAttackKey = key;
        window.Synoptic.releaseFocus();
        window.Synoptic.focusCommunication();
      }
    }, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
