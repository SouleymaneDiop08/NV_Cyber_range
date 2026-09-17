(() => {
  const C = { green: '#4CD89A', teal: '#528A96', orange: '#E0912F', red: '#D9483B', white: '#F9F9FA' };
  const params = new URLSearchParams(location.search);
  /* Même origine que la page : nginx proxifie /api vers la
     Digital Twin API. Une adresse absolue en http casserait la
     vue dès qu'elle est servie en https (contenu mixte). Le
     paramètre ?api= permet toujours de pointer ailleurs. */
  const API_BASE = (params.get('api') || '').replace(/\/$/, '');
  const POLL_MS = Number(params.get('poll') || 2000);
  const FLOW_TTL_MS = Number(params.get('ttl') || 60000);
  const HISTORY_WINDOW_MS = Number(params.get('history') || 30 * 60 * 1000);

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const assetByIp = {
    '192.168.20.10': 'plc',
    '192.168.20.20': 'scada',
    '192.168.30.10': 'scada',
    '192.168.30.20': 'operator',
    '192.168.30.30': 'rogue',
    '192.168.40.11': 'billetterie',
    '192.168.40.12': 'siv',
    '192.168.40.13': 'siv',
    '192.168.40.14': 'pipc',
    '192.168.40.15': 'cctv',
    '192.168.40.88': 'rogue',
  };

  const serviceLabels = { billettique: 'BILLETTERIE', siv: 'SIV', sono: 'SONO', pipc: 'PIPC', cctv: 'CCTV' };
  const serviceIdByAsset = { billetterie: 'billettique', siv: 'siv', pipc: 'pipc', cctv: 'cctv' };

  const state = {
    twin: null,
    selectedAsset: 'scada',
    eventHistory: [],
    selectedEvent: null,
    eventFilters: { q: '', source: '', destination: '', type: '', severity: '', from: '', to: '' },
  };

  function cleanText(value) {
    return String(value ?? '')
      .replace(/simulées/gi, '').replace(/simulée/gi, '').replace(/simulé/gi, '')
      .replace(/simulees/gi, '').replace(/simulee/gi, '').replace(/simule/gi, '')
      .replace(/\s{2,}/g, ' ').trim();
  }

  function fmtTime(value) {
    const d = value ? new Date(value) : new Date();
    return Number.isNaN(d.getTime()) ? '--:--:--' : d.toLocaleTimeString('fr-FR', { hour12: false });
  }

  function ageMs(value) {
    const ts = Date.parse(value || '');
    return Number.isNaN(ts) ? Infinity : Date.now() - ts;
  }

  function severityColor(severity) {
    if (severity === 'critical' || severity === 'high') return C.red;
    if (severity === 'medium') return C.orange;
    return C.teal;
  }

  function severityClass(severity) {
    if (severity === 'critical' || severity === 'high') return 'crit';
    if (severity === 'medium') return 'warn';
    return '';
  }

  function operatorName(entity, fallback = 'Inconnu') {
    const ip = entity?.ip || '';
    const name = cleanText(entity?.name || '');
    const normalized = name.toLowerCase();
    if (ip === '192.168.30.30' || entity?.type === 'attacker' || (normalized.includes('poste') && normalized.includes('exercice'))) {
      return 'Source inconnue';
    }
    return name || ip || fallback;
  }

  function incidentLabel(alert) {
    const ruleId = String(alert?.rule_id || '');
    if (ruleId.startsWith('930002')) return 'Découverte réseau';
    if (ruleId.startsWith('930004')) return 'Information voyageurs';
    if (ruleId.startsWith('930003')) return 'Signalisation';
    if (ruleId.startsWith('930000')) return 'Énergie traction';
    if (ruleId.startsWith('930005')) return 'Télémétrie';
    if (ruleId.startsWith('930001')) return 'Communication non autorisée';
    return cleanText(alert?.title || alert?.family || 'Incident cyber');
  }

  function apiGet(path) {
    return fetch(`${API_BASE}${path}`, { cache: 'no-store' }).then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
  }

  function eventQuery() {
    const query = new URLSearchParams({ limit: '150' });
    if (state.eventFilters.q) query.set('q', state.eventFilters.q);
    if (state.eventFilters.source) query.set('source', state.eventFilters.source);
    if (state.eventFilters.destination) query.set('destination', state.eventFilters.destination);
    if (state.eventFilters.type) query.set('type', state.eventFilters.type);
    if (state.eventFilters.severity) query.set('severity', state.eventFilters.severity);
    const from = parseDateFilter(state.eventFilters.from);
    const to = parseDateFilter(state.eventFilters.to);
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    return `/api/twin/events?${query.toString()}`;
  }

  function hasEventFilters() {
    return Object.values(state.eventFilters).some(Boolean);
  }

  function parseDateFilter(value) {
    const normalized = String(value || '').trim().replace(' ', 'T');
    if (!normalized) return '';
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
  }

  function svgPoint(svg, el) {
    if (!svg || !el) return null;
    const sr = svg.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    if (!sr.width || !sr.height) return null;
    return {
      x: ((er.left + er.width / 2) - sr.left) * vb.width / sr.width,
      y: ((er.top + er.height / 2) - sr.top) * vb.height / sr.height,
    };
  }

  function cubic(a, c1, c2, b) {
    return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }

  function softCurve(a, b, bend = 0) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return cubic(a, { x: a.x + dx * .28, y: a.y + dy * .18 + bend }, { x: a.x + dx * .72, y: a.y + dy * .82 + bend }, b);
  }

  function setPath(id, d) {
    const p = $(`#${id}`);
    if (p && d) p.setAttribute('d', d);
  }

  function hotspotPoint(id) {
    const svg = $('.gare-flow-layer');
    const root = $('#gare-scene');
    if (id === 'rogue') return svgPoint(svg, $('#gare-rogue'));
    return svgPoint(svg, $(`.scene-hotspot[data-asset="${id}"]`, root));
  }

  function updateBaseFlowGeometry() {
    const sw = hotspotPoint('switch');
    const op = hotspotPoint('operator');
    const plc = hotspotPoint('plc');
    const scada = hotspotPoint('scada');
    const bill = hotspotPoint('billetterie');
    const siv = hotspotPoint('siv');
    const cctv = hotspotPoint('cctv');
    const pipc = hotspotPoint('pipc');
    if (sw && op) setPath('gare-flow-operator-switch', cubic(op, { x: op.x - 20, y: op.y + 95 }, { x: sw.x + 90, y: sw.y - 45 }, sw));
    if (sw && plc) setPath('gare-flow-plc-switch', cubic(plc, { x: plc.x + 24, y: plc.y + 6 }, { x: sw.x - 24, y: sw.y + 6 }, sw));
    if (sw && scada) setPath('gare-flow-scada-switch', cubic(scada, { x: scada.x + 92, y: scada.y + 12 }, { x: sw.x - 82, y: sw.y + 24 }, sw));
    if (sw && bill) setPath('gare-flow-billetterie-switch', cubic(bill, { x: bill.x + 40, y: bill.y + 118 }, { x: sw.x - 250, y: sw.y + 24 }, sw));
    if (sw && siv) setPath('gare-flow-siv-switch', cubic(siv, { x: siv.x + 18, y: siv.y + 138 }, { x: sw.x - 38, y: sw.y - 118 }, sw));
    if (sw && pipc) setPath('gare-flow-pipc-switch', cubic(pipc, { x: pipc.x - 38, y: pipc.y + 10 }, { x: sw.x + 38, y: sw.y + 10 }, sw));
    if (sw && cctv) setPath('gare-flow-cctv-switch', cubic(cctv, { x: cctv.x + 16, y: cctv.y + 120 }, { x: sw.x - 58, y: sw.y - 138 }, sw));
  }

  function activeAlerts() {
    return (state.twin?.alerts || [])
      .filter(alert => (alert.views || []).includes('gare'))
      .filter(alert => ageMs(alert.timestamp) <= FLOW_TTL_MS)
      .sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0));
  }

  function historyAlerts() {
    const source = state.eventHistory.length || hasEventFilters() ? state.eventHistory : (state.twin?.alerts || []);
    return source
      .filter(alert => (alert.views || []).includes('gare'))
      .sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0));
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    return el;
  }

  /* Sélection des tracés à représenter : les alertes de la fenêtre
     temps réel, plus l'événement historique sélectionné.

     Un seul flux par couple source → destination : une attaque
     envoie en rafale de nombreuses commandes vers le même
     équipement (l'automate, par exemple), ce qui superposait autant
     de flèches. On n'en garde qu'une par paire — la plus sévère,
     puis la plus récente — pour un synoptique lisible, sans changer
     la réalité de ce que la supervision a détecté. */
  function severityRank(sev) {
    return (sev === 'critical' || sev === 'high') ? 2 : (sev === 'medium' ? 1 : 0);
  }
  function pairKey(alert) {
    const fromId = assetByIp[alert.source?.ip] || 'rogue';
    const toId = assetByIp[alert.destination?.ip] || 'switch';
    return fromId + '>' + toId;
  }

  function flowsToDraw() {
    const byPair = new Map();
    /* activeAlerts() est trié du plus récent au plus ancien : le
       premier vu par paire est donc le plus récent, et on ne le
       remplace que par une alerte strictement plus sévère. */
    activeAlerts().forEach(alert => {
      const key = pairKey(alert);
      const cur = byPair.get(key);
      if (!cur || severityRank(alert.severity) > severityRank(cur.alert.severity)) {
        byPair.set(key, { alert, selected: false, toId: assetByIp[alert.destination?.ip] || 'switch' });
      }
    });

    const flows = Array.from(byPair.values());

    /* L'événement historique sélectionné remplace le flux de sa
       paire s'il existe, sinon il s'ajoute. */
    if (state.selectedEvent) {
      const key = pairKey(state.selectedEvent);
      const item = {
        alert: state.selectedEvent, selected: true,
        toId: assetByIp[state.selectedEvent.destination?.ip] || 'switch',
      };
      const idx = flows.findIndex(f => pairKey(f.alert) === key);
      if (idx >= 0) flows[idx] = item; else flows.unshift(item);
    }
    return flows;
  }

  /* Le calque n'est reconstruit que lorsque l'ensemble des tracés
     change. Le reconstruire à chaque image relançait les animations
     CSS en boucle : les pointillés paraissaient figés et aucune
     animation SVG ne pouvait se dérouler. */
  let flowSignature = null;

  function renderLiveFlows() {
    updateBaseFlowGeometry();
    const layer = $('#gare-live-flows');
    if (!layer) return;

    /* Seuls les tracés dont les deux extrémités sont résolues sont
       retenus : un point d'ancrage manquant produirait une flèche
       partant du coin du cadre. */
    const drawable = flowsToDraw().map((item, index) => {
      const fromId = assetByIp[item.alert.source?.ip] || 'rogue';
      return { ...item, index, from: hotspotPoint(fromId), to: hotspotPoint(item.toId) };
    }).filter(item => item.from && item.to);

    const signature = drawable.map(f => `${f.alert.id}:${f.toId}:${f.selected ? 1 : 0}`).join('|');
    const rebuild = signature !== flowSignature;
    if (rebuild) {
      flowSignature = signature;
      layer.innerHTML = '';
    }

    drawable.forEach(({ alert, selected, index, from, to }, slot) => {
      const red = alert.severity === 'critical' || alert.severity === 'high';
      const tone = red ? 'red' : 'orange';
      const stroke = red ? C.red : C.orange;
      const d = softCurve(from, to, ((index % 5) - 2) * 10);

      let group = layer.children[slot];
      if (rebuild || !group) {
        group = svgEl('g', { class: 'flow-group' });

        /* Faisceau diffus sous le tracé : donne l'épaisseur
           lumineuse, sans masquer la scène. */
        group.appendChild(svgEl('path', { class: `flow-halo ${tone}` }));

        const main = svgEl('path', {
          class: `flow-path ${tone} ${selected ? 'selected-flow' : 'fast live-flow'}`,
          'marker-end': red ? 'url(#gare-red)' : 'url(#gare-orange)',
        });
        main.dataset.ruleId = alert.rule_id || '';
        group.appendChild(main);

        /* Comète parcourant le tracé de la source vers la cible :
           c'est elle qui donne le sens de l'attaque au premier
           coup d'œil. */
        const comet = svgEl('circle', { class: 'flow-comet', r: 4.2, fill: stroke, color: stroke });
        comet.appendChild(svgEl('animateMotion', {
          dur: selected ? '2.4s' : '1.7s', repeatCount: 'indefinite', rotate: 'auto', path: d,
        }));
        comet.appendChild(svgEl('animate', {
          attributeName: 'opacity', values: '0;1;1;0', keyTimes: '0;0.12;0.8;1',
          dur: selected ? '2.4s' : '1.7s', repeatCount: 'indefinite',
        }));
        group.appendChild(comet);

        /* Onde d'impact sur la cible. */
        const ring = svgEl('circle', { class: 'flow-impact', stroke, cx: to.x, cy: to.y, r: 6 });
        ring.appendChild(svgEl('animate', {
          attributeName: 'r', values: '5;26', dur: '1.7s', repeatCount: 'indefinite',
        }));
        ring.appendChild(svgEl('animate', {
          attributeName: 'opacity', values: '.85;0', dur: '1.7s', repeatCount: 'indefinite',
        }));
        group.appendChild(ring);

        layer.appendChild(group);
      }

      /* La géométrie est rafraîchie à chaque image : la scène est
         responsive, les points d'ancrage bougent avec elle. */
      const [halo, main, comet, ring] = group.children;
      halo.setAttribute('d', d);
      main.setAttribute('d', d);
      const motion = comet.querySelector('animateMotion');
      if (motion && motion.getAttribute('path') !== d) motion.setAttribute('path', d);
      ring.setAttribute('cx', to.x.toFixed(1));
      ring.setAttribute('cy', to.y.toFixed(1));
    });

    /* Retire les groupes en trop si la liste a raccourci. */
    while (layer.children.length > drawable.length) layer.removeChild(layer.lastChild);
  }

  function serviceState(...items) {
    const known = items.filter(Boolean);
    if (!known.length) return 'NON RENSEIGNÉ';
    if (known.some(s => !s.connected)) return 'HORS LIGNE';
    if (known.some(s => s.availability && s.availability !== 'nominal')) return 'DÉGRADÉ';
    return 'OK';
  }

  function serviceColor(...items) {
    const known = items.filter(Boolean);
    if (!known.length || known.some(s => !s.connected)) return C.red;
    if (known.some(s => s.availability && s.availability !== 'nominal')) return C.orange;
    return C.green;
  }

  function hasServiceDegradation(twin) {
    const services = twin.gare_services?.items || [];
    const process = twin.process || {};
    const dkr = (process.trains || []).find(t => t.train_id === 'DKR') || {};
    return services.some(s => !s.connected || (s.availability && s.availability !== 'nominal')) ||
      Boolean(dkr.siv?.niveau_desinformation > 0 || process.ctc?.alm_aiguille || process.ctc?.alm_collision);
  }

  function renderHeader(twin, alerts) {
    const health = twin.health || {};
    const connected = Boolean(health?.alerts_connected && health?.gare_services_connected);
    $('#api-dot').className = `dot ${connected ? 'good' : ''}`;
    $('#api-status').textContent = connected ? 'Connectée' : 'Dégradée';
    const topOculoxDot = $('#top-oculox-dot');
    const topPlcDot = $('#top-plc-dot');
    if (topOculoxDot) topOculoxDot.className = `dot ${health?.alerts_connected ? 'good' : 'warn'}`;
    if (topPlcDot) topPlcDot.className = `dot ${twin.process?.connected ? 'good' : 'warn'}`;
    const critical = alerts.filter(a => ['critical', 'high'].includes(a.severity)).length;
    const degraded = hasServiceDegradation(twin);
    const hs = $('#gare-head-status');
    hs.style.color = critical ? C.red : alerts.length || degraded ? C.orange : C.green;
    hs.innerHTML = `<i></i>${critical ? 'Incident en cours' : alerts.length ? 'Activité observée' : degraded ? 'Service dégradé' : 'Exploitation normale'}`;
  }

  function renderStatuses(twin, alerts) {
    const services = twin.gare_services?.items || [];
    const byId = Object.fromEntries(services.map(s => [s.id, s]));
    const process = twin.process || {};
    const ctc = process.ctc || {};
    const dkr = (process.trains || []).find(t => t.train_id === 'DKR') || {};
    const rows = [
      ['BILLETTERIE', serviceState(byId.billettique), serviceColor(byId.billettique)],
      ['SIV / SONO', dkr.siv?.niveau_desinformation > 0 ? 'INCOHÉRENT' : serviceState(byId.siv, byId.sono), serviceColor(byId.siv, byId.sono)],
      ['CCTV', serviceState(byId.cctv), serviceColor(byId.cctv)],
      ['PIPC', ctc.alm_collision ? 'RISQUE COLLISION' : ctc.alm_aiguille || ctc.aiguille_deviee ? 'AIGUILLE À CONTRÔLER' : serviceState(byId.pipc), ctc.alm_aiguille || ctc.alm_collision ? C.red : serviceColor(byId.pipc)],
      ['SCADA LOCAL', twin.health?.process_connected ? 'CONNECTÉ' : 'HORS LIGNE', twin.health?.process_connected ? C.green : C.red],
      ['PLC', process.connected ? 'CONNECTÉ' : 'HORS LIGNE', process.connected ? C.green : C.red],
      ['RÉSEAU / SEGMENTATION', alerts.length ? 'ACTIVITÉ OBSERVÉE' : 'NOMINAL', alerts.length ? C.orange : C.teal],
      ['POSTE OPÉRATEUR', 'AUTORISÉ', C.green],
    ];
    $('#gare-status-list').innerHTML = rows.map(([k, v, c]) => `<div class="gare-status-row"><span>${k}</span><strong style="--row-color:${c};color:${c}"><i></i>${cleanText(v)}</strong></div>`).join('');
  }

  function renderCyber(twin, liveAlerts, historicalAlerts) {
    const displayAlerts = liveAlerts.length ? liveAlerts : historicalAlerts;
    const critical = displayAlerts.filter(a => ['critical', 'high'].includes(a.severity)).length;
    const sources = new Set(displayAlerts.map(a => a.source?.ip).filter(Boolean)).size;
    const targets = new Set(displayAlerts.map(a => a.destination?.ip).filter(Boolean)).size;
    const cs = $('#gare-cyber-state');
    cs.className = `cyber-state ${critical && liveAlerts.length ? 'crit' : displayAlerts.length ? 'warn' : ''}`;
    const title = liveAlerts.length
      ? (critical ? 'ALERTE PRIORITAIRE' : 'ACTIVITÉ DÉTECTÉE')
      : historicalAlerts.length ? 'HISTORIQUE D’ALERTES' : 'SITUATION NORMALE';
    const subtitle = liveAlerts.length
      ? 'Alertes actives reçues depuis Oculox'
      : historicalAlerts.length ? 'Derniers événements conservés pour analyse' : 'Aucune alerte récente';
    cs.innerHTML = `<i></i><div><strong>${title}</strong><span>${subtitle}</span></div>`;
    const metrics = [
      ['ALERTES ACTIVES', String(liveAlerts.length), liveAlerts.length ? C.orange : C.green],
      ['ALERTES HISTORIQUE', String(historicalAlerts.length), historicalAlerts.length ? C.orange : C.green],
      ['SOURCES ACTIVES', String(sources), sources ? C.orange : C.green],
      ['CIBLES TOUCHÉES', String(targets), targets ? C.orange : C.green],
    ];
    $('#gare-cyber-metrics').innerHTML = metrics.map(([k, v, c]) => `<div class="cyber-metric-card"><strong style="color:${c}">${v}</strong><span>${k}</span></div>`).join('');
  }

  function renderContext(twin, alerts, isLive) {
    const latest = state.selectedEvent || alerts[0];
    $('#gare-incident-clock').textContent = fmtTime(latest?.timestamp || twin.timestamp);
    if (!latest) {
      $('#gare-incident-detail').innerHTML = '<div class="incident-detail-head normal"><div><span>ÉTAT TEMPS RÉEL</span><strong>AUCUNE ALERTE RÉCENTE</strong></div></div><p class="incident-detail-summary">La vue attend les événements Oculox et les états du cyber range. Les flux affichés correspondent aux communications nominales connues.</p><div class="incident-impact normal"><span>IMPACT</span><strong>AUCUN IMPACT CONFIRMÉ</strong><p>Aucun changement opérationnel critique n’est remonté par le jumeau numérique.</p></div>';
      $('#incident-alert').classList.remove('show', 'warn', 'crit');
      return;
    }
    const tone = ['critical', 'high'].includes(latest.severity) ? 'crit' : 'warn';
    const selectedHistorical = Boolean(state.selectedEvent);
    const src = operatorName(latest.source, 'Source inconnue');
    const dst = operatorName(latest.destination, 'Destination inconnue');
    const impact = latest.impact?.status || 'Aucun impact confirmé';
    const facts = [
      ['TYPE D’INCIDENT', incidentLabel(latest), severityColor(latest.severity)],
      ['SOURCE', src, C.white],
      ['DESTINATION', dst, C.white],
      ['PROTOCOLE', latest.protocol || '-', C.white],
      ['RÈGLE', latest.rule_id || '-', C.white],
      ['IMPACT', impact, latest.impact?.observed ? C.red : C.green],
    ];
    $('#gare-incident-detail').innerHTML = `<div class="incident-detail-head ${tone}"><div><span>${selectedHistorical ? 'ÉVÉNEMENT HISTORIQUE SÉLECTIONNÉ' : isLive ? 'ALERTE OCULOX ACTIVE' : 'DERNIÈRE ALERTE OCULOX'}</span><strong>${cleanText(latest.title || 'Activité détectée')}</strong></div></div><p class="incident-detail-summary">${cleanText(latest.operator_message || latest.rule_name || '')}</p><div class="incident-route"><div><small>SOURCE</small><strong>${cleanText(src)}</strong></div><b>→</b><div><small>DESTINATION</small><strong>${cleanText(dst)}</strong></div></div><div class="incident-facts">${facts.map(([k, v, c]) => `<div><span>${k}</span><strong style="color:${c}">${cleanText(v)}</strong></div>`).join('')}</div><div class="incident-impact ${tone}"><span>IMPACT</span><strong>${cleanText(impact)}</strong><p>${cleanText(latest.impact?.details || latest.potential_impact || 'Impact non déterminé.')}</p></div>`;
    const box = $('#incident-alert');
    if (!isLive || state.selectedEvent) {
      box.classList.remove('show', 'warn', 'crit');
      return;
    }
    box.className = `incident-alert ${tone} show`;
    $('#incident-alert-badge').textContent = latest.severity === 'critical' ? 'ALERTE CRITIQUE' : 'SIGNALEMENT OCULOX';
    $('#incident-alert-title').textContent = cleanText(latest.title || 'Activité détectée');
    $('#incident-alert-body').textContent = cleanText(latest.operator_message || latest.rule_name || '');
  }

  function renderEvents(twin, alerts) {
    $('#gare-events-caption').textContent = alerts.length ? `${alerts.length} événement(s) conservé(s)` : 'Aucun événement trouvé';
    const rows = alerts.slice(0, 30);
    $('#gare-events-table').innerHTML = rows.length ? rows.map(alert => {
      const src = cleanText(operatorName(alert.source, '-'));
      const dst = cleanText(operatorName(alert.destination, '-'));
      const selected = state.selectedEvent?.id === alert.id ? ' selected' : '';
      return `<button class="event-row${selected}" type="button" data-event-id="${encodeURIComponent(alert.id || '')}"><time>${fmtTime(alert.timestamp)}</time><span>${cleanText(alert.operator_message || alert.title || '')}</span><strong>${src} → ${dst}</strong><span class="event-tag" style="--tag-color:${severityColor(alert.severity)}">${incidentLabel(alert)}</span></button>`;
    }).join('') : '<div class="empty-events">Aucun événement Oculox à afficher avec les filtres actuels.</div>';
    $$('.event-row', $('#gare-events-table')).forEach(row => {
      row.addEventListener('click', () => {
        const id = decodeURIComponent(row.dataset.eventId || '');
        state.selectedEvent = state.eventHistory.find(event => event.id === id) || null;
        render(state.twin);
      });
    });
  }

  function markHotspot(id, cls) {
    const el = $(`.scene-hotspot[data-asset="${id}"]`);
    if (!el || !cls) return;
    if (cls === 'crit') {
      el.classList.remove('warn');
      el.classList.add('crit');
      return;
    }
    if (!el.classList.contains('crit')) el.classList.add('warn');
  }

  function renderHotspots(twin, alerts) {
    $$('.scene-hotspot').forEach(h => h.classList.remove('warn', 'crit'));
    const services = Object.fromEntries((twin.gare_services?.items || []).map(s => [s.id, s]));
    Object.entries({ billettique: 'billetterie', siv: 'siv', sono: 'siv', pipc: 'pipc', cctv: 'cctv' }).forEach(([serviceId, hotspotId]) => {
      const service = services[serviceId];
      if (!service) return;
      if (!service.connected) markHotspot(hotspotId, 'crit');
      else if (service.availability && service.availability !== 'nominal') markHotspot(hotspotId, 'warn');
    });
    if (!twin.process?.connected) {
      markHotspot('plc', 'crit');
      markHotspot('scada', 'crit');
    }
    if (!twin.health?.alerts_connected || !twin.health?.gare_services_connected) markHotspot('switch', 'warn');

    const markedAlerts = state.selectedEvent ? [state.selectedEvent, ...alerts] : alerts;
    for (const alert of markedAlerts) {
      const cls = severityClass(alert.severity);
      [assetByIp[alert.source?.ip], assetByIp[alert.destination?.ip]].filter(Boolean).forEach(id => {
        if (id === 'rogue') return;
        const el = $(`.scene-hotspot[data-asset="${id}"]`);
        if (el && cls) el.classList.add(cls);
      });
    }
    /* Le marqueur de source externe doit être visible dès qu'un
       tracé part de lui — y compris pour un événement historique
       sélectionné. Tant qu'il restait masqué, son cadre mesurait
       zéro : la flèche partait alors du coin du cadre au lieu de
       la source, et l'incident ancien était illisible. */
    const latestUnknown = markedAlerts.find(a => (assetByIp[a.source?.ip] || 'rogue') === 'rogue');
    $('#gare-rogue').classList.toggle('hidden', !latestUnknown);
    if (latestUnknown) {
      $('#gare-rogue-label').textContent = 'SOURCE INCONNUE';
      $('#gare-rogue-ip').textContent = cleanText(latestUnknown.source?.ip || 'Adresse non identifiée');
    }
  }

  function renderSivMismatch(twin) {
    const dkr = (twin.process?.trains || []).find(t => t.train_id === 'DKR') || {};
    const siv = dkr.siv || {};
    const serviceSiv = twin.gare_services?.items?.find(s => s.id === 'siv');
    const show = Boolean(siv.niveau_desinformation > 0 || serviceSiv?.availability !== 'nominal');
    $('#siv-mismatch').classList.toggle('hidden', !show);
    if (!show) return;
    const cells = $$('#siv-mismatch .mismatch-grid div');
    if (cells[0]) cells[0].innerHTML = `<small>RÉALITÉ</small><strong>${cleanText(siv.zone_annoncee || 'Position réelle')}</strong><span>${Number(siv.retard_annonce_min || 0)} min</span>`;
    if (cells[2]) cells[2].innerHTML = `<small>AFFICHÉ</small><strong>${cleanText(serviceSiv?.published?.position || '-')}</strong><span>${Number(serviceSiv?.metrics?.retard_minutes || 0)} min</span>`;
  }

  function recentSourceRows() {
    const latest = activeAlerts().find(a => (assetByIp[a.source?.ip] || 'rogue') === 'rogue') || historyAlerts()[0];
    if (!latest) return [['Aucune source', 'Aucune alerte récente']];
    return [['Nom', operatorName(latest.source, '-')], ['Adresse', latest.source?.ip || '-'], ['Dernière action', latest.title || latest.rule_name || '-'], ['Destination', operatorName(latest.destination, '-')]];
  }

  function assetData(id) {
    const twin = state.twin || {};
    const services = twin.gare_services?.items || [];
    const service = services.find(s => s.id === (serviceIdByAsset[id] || id));
    const dkr = (twin.process?.trains || []).find(t => t.train_id === 'DKR') || {};
    const process = twin.process || {};
    const energy = twin.energy || {};
    if (service) {
      return {
        title: serviceLabels[id] || cleanText(service.name),
        meta: cleanText(`${service.role} · ${service.ip}`),
        rows: [['État', service.connected ? service.status : 'Hors ligne'], ['Disponibilité', service.availability || '-'], ['Adresse', service.ip], ['Dernière mise à jour', fmtTime(service.updated_at)], ...Object.entries(service.metrics || {}).slice(0, 3).map(([k, v]) => [k.replaceAll('_', ' '), String(v)])],
      };
    }
    const staticData = {
      scada: { title: 'SCADA LOCAL', meta: 'Supervision locale de la gare · 192.168.20.20', rows: [['État', twin.health?.process_connected ? 'Connecté' : 'Hors ligne'], ['Adresse', '192.168.20.20'], ['Données procédé', process.connected ? 'Disponibles' : 'Indisponibles'], ['Dernière mise à jour', fmtTime(process.last_poll)]] },
      plc: { title: 'AUTOMATE ÉNERGIE', meta: 'Traction et procédé ferroviaire · 192.168.20.10', rows: [['État', process.connected ? 'Connecté' : 'Hors ligne'], ['Adresse', '192.168.20.10'], ['Train DKR', dkr.etat_train || '-'], ['Tension caténaire', `${Number(dkr.tension_kv || 0).toFixed(1)} kV`], ['Signal vert', dkr.signal_vert ? 'Oui' : 'Non'], ['TX2 bobinage', `${energy.transformers?.tx2?.winding_temp ?? '-'} °C`], ['Feeder 2', energy.feeders?.feeder2?.cb_closed ? 'Fermé' : 'Ouvert']] },
      switch: { title: 'RÉSEAU / SWITCH', meta: 'Routeur R2 · passerelle gare · 192.168.40.254', rows: [['Adresse gare', '192.168.40.254'], ['Zone', 'Services gare'], ['Flux actifs', String(activeAlerts().length)], ['Alertes historique', String(historyAlerts().length)], ['Oculox', twin.health?.alerts_connected ? 'Connecté' : 'Dégradé'], ['Services Gare', twin.health?.gare_services_connected ? 'Connectés' : 'Dégradés']] },
      operator: { title: 'POSTE OPÉRATEUR', meta: 'Supervision locale', rows: [['État', 'Autorisé'], ['Accès', 'Vue Gare'], ['Source données', 'Digital Twin API'], ['Alertes', String(activeAlerts().length)]] },
      quai: { title: 'QUAI 1', meta: 'Zone voyageurs / circulation', rows: [['Train', dkr.label || 'Train DKR'], ['Vitesse', `${Number(dkr.vitesse_kmh || 0)} km/h`], ['Position', dkr.siv?.zone_annoncee || '-'], ['SIV', dkr.siv?.message || '-']] },
      rogue: { title: 'SOURCE ACTIVE', meta: 'Source observée par Oculox', rows: recentSourceRows() },
    };
    return staticData[id] || staticData.scada;
  }

  function showAsset(id, toast = false) {
    state.selectedAsset = id;
    const a = assetData(id);
    $('#gare-asset-title').textContent = cleanText(a.title);
    $('#gare-asset-body').innerHTML = `<div style="font-size:8px;color:#6E625D;margin-bottom:7px">${cleanText(a.meta)}</div>` + a.rows.map(([k, v]) => `<div class="asset-row"><span>${cleanText(k)}</span><strong>${cleanText(v)}</strong></div>`).join('');
    if (toast) showToast(`${a.title} - données temps réel`);
  }

  function showTooltip(el, a, x, y) {
    el.innerHTML = `<div class="tooltip-title">${cleanText(a.title)}</div><div class="tooltip-meta">${cleanText(a.meta)}</div>${a.rows.slice(0, 3).map(([k, v]) => `<div class="tooltip-row"><span>${cleanText(k)}</span><strong>${cleanText(v)}</strong></div>`).join('')}`;
    el.classList.add('visible');
    moveTooltip(el, x, y);
  }

  function moveTooltip(el, x, y) {
    const pad = 16;
    let left = x + 16;
    let top = y + 16;
    if (left + 260 > innerWidth - pad) left = x - 278;
    if (top + 170 > innerHeight - pad) top = y - 188;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function bindInteractions() {
    const tip = $('#gare-tooltip');
    $$('.scene-hotspot').forEach(el => {
      const id = el.dataset.asset;
      el.addEventListener('mouseenter', e => { showAsset(id); showTooltip(tip, assetData(id), e.clientX, e.clientY); });
      el.addEventListener('mousemove', e => moveTooltip(tip, e.clientX, e.clientY));
      el.addEventListener('mouseleave', () => tip.classList.remove('visible'));
      el.addEventListener('focus', () => showAsset(id));
      el.addEventListener('click', () => showAsset(id, true));
    });
    $('#gare-rogue').addEventListener('mouseenter', e => showTooltip(tip, assetData('rogue'), e.clientX, e.clientY));
    $('#gare-rogue').addEventListener('mousemove', e => moveTooltip(tip, e.clientX, e.clientY));
    $('#gare-rogue').addEventListener('mouseleave', () => tip.classList.remove('visible'));
    $('#op-mode').addEventListener('click', () => setSceneMode(false));
    $('#net-mode').addEventListener('click', () => setSceneMode(true));
    $('#event-filter-q').addEventListener('input', debounce(async event => {
      state.eventFilters.q = event.target.value.trim();
      state.selectedEvent = null;
      await poll();
    }, 250));
    $('#event-filter-source').addEventListener('input', debounce(async event => {
      state.eventFilters.source = event.target.value.trim();
      state.selectedEvent = null;
      await poll();
    }, 250));
    $('#event-filter-destination').addEventListener('input', debounce(async event => {
      state.eventFilters.destination = event.target.value.trim();
      state.selectedEvent = null;
      await poll();
    }, 250));
    $('#event-filter-type').addEventListener('change', async event => {
      state.eventFilters.type = event.target.value;
      state.selectedEvent = null;
      await poll();
    });
    $('#event-filter-severity').addEventListener('change', async event => {
      state.eventFilters.severity = event.target.value;
      state.selectedEvent = null;
      await poll();
    });
    $('#event-filter-from').addEventListener('change', async event => {
      state.eventFilters.from = event.target.value;
      state.selectedEvent = null;
      await poll();
    });
    $('#event-filter-to').addEventListener('change', async event => {
      state.eventFilters.to = event.target.value;
      state.selectedEvent = null;
      await poll();
    });
    $('#event-filter-reset').addEventListener('click', async () => {
      state.eventFilters = { q: '', source: '', destination: '', type: '', severity: '', from: '', to: '' };
      state.selectedEvent = null;
      $('#event-filter-q').value = '';
      $('#event-filter-source').value = '';
      $('#event-filter-destination').value = '';
      $('#event-filter-type').value = '';
      $('#event-filter-severity').value = '';
      $('#event-filter-from').value = '';
      $('#event-filter-to').value = '';
      await poll();
    });
  }

  function debounce(fn, wait) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  function setSceneMode(network) {
    $('#gare-scene').classList.toggle('network-mode', network);
    $('#op-mode').classList.toggle('active', !network);
    $('#net-mode').classList.toggle('active', network);
  }

  function showToast(text) {
    const t = $('#toast');
    t.textContent = cleanText(text);
    t.classList.add('show');
    clearTimeout(t._to);
    t._to = setTimeout(() => t.classList.remove('show'), 1800);
  }

  function render(twin) {
    state.twin = twin;
    const live = activeAlerts();
    const history = historyAlerts();
    renderHeader(twin, live);
    renderStatuses(twin, live);
    renderCyber(twin, live, history);
    renderContext(twin, live.length ? live : history, Boolean(live.length));
    renderEvents(twin, history);
    renderHotspots(twin, live);
    renderSivMismatch(twin);
    showAsset(state.selectedAsset);
    requestAnimationFrame(renderLiveFlows);
  }

  async function poll() {
    try {
      const twin = await apiGet('/api/twin/state');
      try {
        const events = await apiGet(eventQuery());
        state.eventHistory = Array.isArray(events.items) ? events.items : [];
        if (state.selectedEvent) {
          state.selectedEvent = state.eventHistory.find(event => event.id === state.selectedEvent.id) || state.selectedEvent;
        }
      } catch {
        state.eventHistory = [];
      }
      render(twin);
    } catch (err) {
      $('#api-dot').className = 'dot';
      $('#api-status').textContent = 'Indisponible';
      $('#gare-cyber-state').className = 'cyber-state crit';
      $('#gare-cyber-state').innerHTML = '<i></i><div><strong>API INDISPONIBLE</strong><span>Impossible de lire le jumeau numérique</span></div>';
      $('#gare-events-caption').textContent = err.message;
    }
  }

  function updateClock() {
    $('#clock').textContent = new Date().toLocaleTimeString('fr-FR', { hour12: false });
  }

  $$('.view').forEach(view => view.classList.toggle('active', view.dataset.view === 'gare'));
  $$('.nav-btn[data-view-target]').forEach(btn => btn.classList.toggle('active', btn.dataset.viewTarget === 'gare'));
  bindInteractions();
  updateClock();
  setInterval(updateClock, 1000);
  poll();
  setInterval(poll, POLL_MS);
  (function flowAnimationLoop() {
    renderLiveFlows();
    requestAnimationFrame(flowAnimationLoop);
  })();
})();
