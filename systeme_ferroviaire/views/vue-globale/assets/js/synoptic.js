/* ============================================================
   Synoptique de la ligne — rendu SVG.

   Les trains ne sont plus animés par une physique interne : leur
   abscisse est calculée depuis la position réelle remontée par
   l'automate (progression_plc → point kilométrique → pixel).
   Entre deux relevés, la position affichée converge doucement
   vers la position reçue : c'est un lissage de rendu, jamais une
   extrapolation — la vitesse et le point kilométrique affichés
   restent les valeurs brutes de l'API.
   ============================================================ */
window.Synoptic = (function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  var M = 110, GAP = 152;
  var N = window.STATIONS.length;
  var W = M * 2 + (N - 1) * GAP;
  var H = 400;
  var Y_OC = 52, Y_BUS = 122, Y_BR_END = 288, Y_CAT = 272, Y_RAIL = 304;
  var Y_LAB = [330, 356];

  var svg, gTrains, tip, scroller, canvas;
  var xs = [];
  var refs = { branch: {}, node: {}, nodeIn: {}, halo: {}, label: {}, sub: {}, pulse: {}, cat: [], hit: {} };
  var svc = {};                 /* chips des services gare */
  var plantX, plantBox = {}, attackLayer, ocx, ocRing;
  var commSpan = null;          /* étendue de la communication signalée */
  var trains = {};              /* id -> { g, xCur, xTarget, ... } */
  var userScrolled = false;
  var viewState = null;

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function txt(x, y, s, cls, parent, anchor) {
    var t = el('text', { x: x, y: y, 'class': cls }, parent);
    if (anchor) t.setAttribute('text-anchor', anchor);
    t.textContent = s;
    return t;
  }
  function cls(node, base, tone) {
    node.setAttribute('class', tone && tone !== 'ok' ? base + ' ' + tone : base);
  }

  /* Point kilométrique → abscisse. L'interpolation se fait entre
     les deux gares encadrantes, donc un train à quai tombe
     exactement sur le marqueur de sa gare. */
  function kmToX(km) {
    if (km == null) return null;
    var L = window.STATIONS;
    if (km <= L[0].pk) return xs[0];
    for (var i = 0; i < L.length - 1; i++) {
      if (km <= L[i + 1].pk) {
        var span = L[i + 1].pk - L[i].pk;
        var f = span > 0 ? (km - L[i].pk) / span : 0;
        return xs[i] + f * (xs[i + 1] - xs[i]);
      }
    }
    return xs[L.length - 1];
  }

  /* ---------------------------------------------------------- */
  function build(scrollerEl, canvasEl) {
    scroller = scrollerEl;
    canvas = canvasEl;
    canvas.style.width = W + 'px';

    svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMinYMid meet' });
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    canvas.appendChild(svg);

    var i;
    for (i = 0; i < N; i++) xs.push(M + i * GAP);
    plantX = (xs[window.STATION_INDEX[window.POWER_PLANT.anchorBetween[0]]] +
              xs[window.STATION_INDEX[window.POWER_PLANT.anchorBetween[1]]]) / 2;

    var gGrid = el('g', {}, svg);
    for (i = 0; i <= W; i += 64) el('line', { x1: i, y1: 0, x2: i, y2: H, 'class': 'sy-grid' }, gGrid);
    for (i = 0; i <= H; i += 64) el('line', { x1: 0, y1: i, x2: W, y2: i, 'class': 'sy-grid' }, gGrid);

    /* --- plateforme de supervision --- */
    var gOc = el('g', {}, svg);
    ocx = 520;
    ocRing = el('circle', { cx: ocx, cy: Y_OC, r: 26, 'class': 'sy-oc-ring2' }, gOc);
    el('circle', { cx: ocx, cy: Y_OC, r: 22, 'class': 'sy-oc-ring' }, gOc);
    el('circle', { cx: ocx, cy: Y_OC, r: 14, 'class': 'sy-oc-core' }, gOc);
    txt(ocx, Y_OC + 5, 'PCC', 'sy-oc-o', gOc, 'middle');
    txt(ocx + 38, Y_OC - 3, 'PCC', 'sy-oc-t', gOc);
    txt(ocx + 38, Y_OC + 15, 'POSTE DE COMMANDEMENT CENTRALISÉ', 'sy-oc-s', gOc);

    el('path', { d: 'M' + ocx + ' ' + (Y_OC + 27) + ' L' + ocx + ' ' + Y_BUS, 'class': 'sy-bus' }, svg);
    el('line', { x1: xs[0] - 30, y1: Y_BUS, x2: xs[N - 1] + 30, y2: Y_BUS, 'class': 'sy-bus' }, svg);

    /* Les impulsions remontent des équipements vers la
       plateforme : sens de la collecte, jamais de la commande. */
    var gBusPulse = el('g', {}, svg);
    for (i = 0; i < 2; i++) {
      var bl = el('circle', { cx: xs[0] - 30, cy: Y_BUS, r: 2.4, 'class': 'sy-buspulse left' }, gBusPulse);
      bl.style.animationDelay = (i * 3) + 's';
    }
    for (i = 0; i < 5; i++) {
      var br = el('circle', { cx: xs[N - 1] + 30, cy: Y_BUS, r: 2.4, 'class': 'sy-buspulse right' }, gBusPulse);
      br.style.animationDelay = (i * 4.8) + 's';
    }
    for (i = 0; i < 2; i++) {
      var up = el('circle', { cx: ocx, cy: Y_BUS, r: 2.4, 'class': 'sy-uplink' }, gBusPulse);
      up.style.animationDelay = (i * 0.55) + 's';
    }

    /* --- branches de supervision vers chaque arrêt --- */
    var gBranch = el('g', {}, svg);
    window.STATIONS.forEach(function (s, idx) {
      var x = xs[idx];
      refs.branch[s.id] = el('line', { x1: x, y1: Y_BUS, x2: x, y2: Y_BR_END, 'class': 'sy-branch' }, gBranch);
      var p = el('circle', { cx: x, cy: Y_BR_END, r: 2.2, 'class': 'sy-pulse' }, gBranch);
      p.style.animationDelay = ((idx % 6) * 0.55) + 's';
      refs.pulse[s.id] = p;
    });

    /* --- caténaire par inter-gare --- */
    var gCat = el('g', {}, svg);
    for (i = 0; i < N - 1; i++) {
      refs.cat.push(el('line', { x1: xs[i], y1: Y_CAT, x2: xs[i + 1], y2: Y_CAT, 'class': 'sy-cat' }, gCat));
    }

    /* --- voie --- */
    el('line', { x1: xs[0] - 34, y1: Y_RAIL, x2: xs[N - 1] + 34, y2: Y_RAIL, 'class': 'sy-rail-base' }, svg);

    /* --- services de la gare de Dakar --- */
    buildServices();

    /* --- sous-station de traction --- */
    var gP = el('g', {}, svg);
    var bx = plantX - 116, by = 168, bw = 232, bh = 68;
    plantBox.rect = el('rect', { x: bx, y: by, width: bw, height: bh, rx: 4, 'class': 'sy-box' }, gP);
    txt(bx + 12, by + 21, window.POWER_PLANT.name, 'sy-box-t', gP);
    plantBox.s1 = txt(bx + 12, by + 38, '—', 'sy-box-s', gP);
    plantBox.s2 = txt(bx + 12, by + 54, '—', 'sy-box-s', gP);
    plantBox.x = plantX; plantBox.y = by; plantBox.w = bw; plantBox.h = bh;
    el('line', { x1: plantX, y1: Y_BUS, x2: plantX, y2: by, 'class': 'sy-branch' }, gP);
    plantBox.feed = el('path', { d: 'M' + plantX + ' ' + (by + bh) + ' L' + plantX + ' ' + Y_CAT, 'class': 'sy-feed' }, gP);

    /* --- couche des communications signalées --- */
    attackLayer = el('g', {}, svg);
    attackLayer.style.display = 'none';

    /* --- arrêts --- */
    var gS = el('g', {}, svg);
    window.STATIONS.forEach(function (s, idx) {
      var x = xs[idx], ly = Y_LAB[idx % 2];
      refs.halo[s.id] = el('circle', { cx: x, cy: Y_RAIL, r: 11, 'class': 'sy-halo' }, gS);
      if (s.kind === 'terminus') {
        refs.node[s.id] = el('rect', { x: x - 9, y: Y_RAIL - 9, width: 18, height: 18, rx: 3, 'class': 'sy-node' }, gS);
      } else {
        refs.node[s.id] = el('circle', { cx: x, cy: Y_RAIL, r: s.kind === 'majeure' ? 10 : 9, 'class': 'sy-node' }, gS);
      }
      refs.nodeIn[s.id] = el('circle', { cx: x, cy: Y_RAIL, r: 3.2, 'class': 'sy-node-in' }, gS);
      el('line', { x1: x, y1: Y_RAIL + 12, x2: x, y2: ly - 11, stroke: '#2A2220', 'stroke-width': 1 }, gS);
      refs.label[s.id] = txt(x, ly, s.name, 'sy-label', gS, 'middle');
      refs.sub[s.id] = txt(x, ly + 14, 'PK ' + s.pk.toFixed(1), 'sy-sub', gS, 'middle');

      var hit = el('rect', { x: x - 26, y: Y_RAIL - 26, width: 52, height: 52, 'class': 'sy-hit', tabindex: 0 }, gS);
      hit.setAttribute('role', 'button');
      hit.setAttribute('aria-label', 'Arrêt ' + s.full);
      refs.hit[s.id] = hit;
      hit.addEventListener('mouseenter', function () { showTip(s.id, x); });
      hit.addEventListener('focus', function () { showTip(s.id, x); });
      hit.addEventListener('mouseleave', hideTip);
      hit.addEventListener('blur', hideTip);
    });

    gTrains = el('g', {}, svg);

    tip = document.createElement('div');
    tip.className = 'sy-tip';
    canvas.appendChild(tip);

    initScrollControls();
    requestAnimationFrame(loop);
  }

  /* --- panneau des services de gare ------------------------- */
  function buildServices() {
    var g = el('g', {}, svg);
    var bx = xs[0] - 74, by = 138, bw = 176, rowH = 21;
    var list = window.GARE_SERVICES;
    var bh = 22 + list.length * rowH + 8;

    el('rect', { x: bx, y: by, width: bw, height: bh, rx: 4, 'class': 'sy-box' }, g);
    txt(bx + 10, by + 16, 'GARE DE DAKAR · SERVICES', 'sy-box-t', g);
    el('line', { x1: xs[0], y1: Y_BUS, x2: xs[0], y2: by, 'class': 'sy-branch' }, g);

    list.forEach(function (s, i) {
      var y = by + 22 + i * rowH + 12;
      var o = {};
      o.dot = el('circle', { cx: bx + 14, cy: y - 4, r: 3.4, 'class': 'sy-svc-dot' }, g);
      o.halo = el('circle', { cx: bx + 14, cy: y - 4, r: 8, 'class': 'sy-svc-halo' }, g);
      o.name = txt(bx + 26, y, s.name, 'sy-svc-n', g);
      o.state = txt(bx + bw - 10, y, '—', 'sy-svc-v', g, 'end');
      o.x = bx + bw; o.y = y - 4;
      svc[s.id] = o;
    });
    svc._box = { x: bx, y: by, w: bw, h: bh };
  }

  /* ---------------------------------------------------------- */
  function showTip(id, x) {
    if (!viewState) return;
    var s = viewState.stations[id] || {};
    var meta = window.STATIONS[window.STATION_INDEX[id]];
    var rows =
      '<div class="t-r"><span>Point kilométrique</span><span>PK ' + meta.pk.toFixed(1) + '</span></div>' +
      '<div class="t-r"><span>État opérationnel</span><span>' + (s.op || '—') + '</span></div>' +
      '<div class="t-r"><span>État réseau</span><span>' + (s.net || '—') + '</span></div>';

    /* Train présent à cet arrêt, s'il y en a un */
    Object.keys(viewState.trains).forEach(function (tid) {
      var t = viewState.trains[tid];
      if (t.km != null && Math.abs(t.km - meta.pk) < 0.8) {
        rows += '<div class="t-r"><span>Train en zone</span><span>' + t.label + ' · ' + (t.speed == null ? '—' : t.speed + ' km/h') + '</span></div>';
      }
    });

    tip.innerHTML = '<div class="t-n">' + meta.full + '</div>' + rows;
    var scale = canvas.clientHeight / H || 1;
    tip.style.left = Math.max(6, x * (svg.clientWidth / W) - 90) + 'px';
    tip.style.top = (Y_RAIL * scale - 132) + 'px';
    tip.classList.add('on');
  }
  function hideTip() { tip.classList.remove('on'); }

  /* ---------------------------------------------------------- */
  function initScrollControls() {
    var down = false, sx = 0, sl = 0;
    scroller.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.syn-nav')) return;
      down = true; sx = e.clientX; sl = scroller.scrollLeft;
      scroller.classList.add('dragging');
    });
    window.addEventListener('pointermove', function (e) {
      if (!down) return;
      var d = e.clientX - sx;
      if (Math.abs(d) > 3) userScrolled = true;
      scroller.scrollLeft = sl - d;
    });
    window.addEventListener('pointerup', function () {
      down = false; scroller.classList.remove('dragging');
    });
    scroller.addEventListener('wheel', function (e) {
      if (e.deltaY !== 0 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        scroller.scrollLeft += e.deltaY;
        userScrolled = true;
        e.preventDefault();
      }
    }, { passive: false });
    scroller.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { scroller.scrollLeft += 200; userScrolled = true; e.preventDefault(); }
      if (e.key === 'ArrowLeft') { scroller.scrollLeft -= 200; userScrolled = true; e.preventDefault(); }
    });
    var l = document.getElementById('syn-left'), r = document.getElementById('syn-right');
    if (l) l.addEventListener('click', function () { userScrolled = true; scroller.scrollBy({ left: -340, behavior: 'smooth' }); });
    if (r) r.addEventListener('click', function () { userScrolled = true; scroller.scrollBy({ left: 340, behavior: 'smooth' }); });
  }

  function focusStation(id, force) {
    if (id == null) return;
    if (userScrolled && !force) return;
    var idx = window.STATION_INDEX[id];
    if (idx == null) return;
    var ratio = svg.clientWidth / W || 1;
    var target = xs[idx] * ratio - scroller.clientWidth / 2;
    scroller.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }
  function releaseFocus() { userScrolled = false; }

  /* Recentrage sur une abscisse précise du canevas. Utilisé pour
     amener la communication signalée dans le champ : viser la
     cible réelle plutôt que la gare la plus proche évite qu'un
     encart se retrouve coupé au bord. */
  function focusX(x, force) {
    if (x == null) return;
    if (userScrolled && !force) return;
    var ratio = (svg.clientWidth / W) || 1;
    var target = x * ratio - scroller.clientWidth / 2;
    var max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    scroller.scrollTo({ left: Math.min(max, Math.max(0, target)), behavior: 'smooth' });
  }

  /* Centre la vue sur la communication signalée en cours, encart
     de source compris. */
  function focusCommunication(force) {
    if (commSpan == null) return false;
    focusX((commSpan.from + commSpan.to) / 2, force);
    return true;
  }

  /* ============================================================
     RENDU
     ============================================================ */
  function render(state) {
    viewState = state;

    /* arrêts */
    window.STATIONS.forEach(function (s) {
      var st = state.stations[s.id] || {};
      var tone = st.tone === 'watch' ? 'watch' : (st.tone === 'crit' ? 'crit' : (st.tone === 'unknown' ? 'unknown' : 'ok'));
      cls(refs.node[s.id], 'sy-node', tone);
      cls(refs.nodeIn[s.id], 'sy-node-in', tone);
      cls(refs.label[s.id], 'sy-label', tone);
      refs.halo[s.id].setAttribute('class', 'sy-halo' + (st.halo ? ' on' : '') + (tone === 'crit' ? ' crit' : ''));
      var bt = state.oculox.branches[s.id];
      cls(refs.branch[s.id], 'sy-branch', bt);
      cls(refs.pulse[s.id], 'sy-pulse', bt);
    });

    /* services gare */
    window.GARE_SERVICES.forEach(function (def) {
      var o = svc[def.id], d = (state.services || {})[def.id] || {};
      if (!o) return;
      cls(o.dot, 'sy-svc-dot', d.tone);
      cls(o.name, 'sy-svc-n', d.tone === 'crit' ? 'crit' : null);
      cls(o.state, 'sy-svc-v', d.tone);
      o.state.textContent = d.status || '—';
      o.halo.setAttribute('class', 'sy-svc-halo' + (d.halo ? ' on' : ''));
    });

    /* caténaire */
    refs.cat.forEach(function (l) {
      l.setAttribute('class', 'sy-cat' + (state.segments.degraded ? ' degraded' : ''));
    });

    /* sous-station */
    var p = state.power;
    cls(plantBox.rect, 'sy-box', p.tone === 'crit' ? 'crit' : null);
    plantBox.s1.textContent = (p.hv == null ? '—' : p.hv + ' kV') + ' · ' +
      (p.tx2Tone === 'crit' ? 'TRANSFORMATEUR 2 EN DÉFAUT' : p.tx1Tone === 'crit' ? 'TRANSFORMATEUR 1 EN DÉFAUT' : 'TRANSFORMATEURS 1 ET 2') +
      ' · ' + (p.feedersV || '—');
    plantBox.s2.textContent = 'CATÉNAIRE ' + (p.cat == null ? '—' : p.cat + ' kV') +
      (p.freq == null ? '' : ' · ' + p.freq + ' Hz');
    cls(plantBox.s2, 'sy-box-s', p.catTone === 'crit' ? 'crit' : (p.catTone === 'watch' ? 'watch' : null));
    cls(plantBox.feed, 'sy-feed', state.segments.degraded ? 'crit' : null);

    ocRing.setAttribute('class', 'sy-oc-ring2' + (state.oculox.connected === false ? ' off' : ''));

    renderCommunication(state.attack);
    syncTrains(state);
  }

  /* --- communication signalée : n'existe que si une alerte est
     dans la fenêtre temps réel --------------------------------- */
  function renderCommunication(att) {
    while (attackLayer.firstChild) attackLayer.removeChild(attackLayer.firstChild);
    if (!att) { attackLayer.style.display = 'none'; commSpan = null; return; }
    attackLayer.style.display = '';
    var crit = att.kind === 'crit';

    var tx, ty;
    if (att.target === 'plant') {
      tx = plantBox.x + plantBox.w / 2 - 6; ty = plantBox.y + 12;
    } else if (att.target.indexOf('service:') === 0) {
      var o = svc[att.target.split(':')[1]];
      tx = o ? o.x : xs[0]; ty = o ? o.y : 200;
    } else {
      tx = xs[0]; ty = Y_RAIL - 16;
    }

    /* Encart de la source, posé à gauche du synoptique */
    var sx = Math.max(12, tx - 300), sy = Math.max(12, ty - 78), w = 236, h = 36;
    el('rect', { x: sx, y: sy, width: w, height: h, rx: 4, 'class': 'sy-src' + (crit ? '' : ' warn') }, attackLayer);
    var t1 = txt(sx + 10, sy + 14, att.sourceName.toUpperCase(), 'sy-src-t' + (crit ? '' : ' warn'), attackLayer);
    t1.setAttribute('font-size', '8');
    txt(sx + 10, sy + 28, att.label, 'sy-src-t' + (crit ? '' : ' warn'), attackLayer);

    commSpan = { from: sx, to: tx };

    var mid = (sx + w + tx) / 2;
    el('path', {
      d: 'M' + (sx + w) + ' ' + (sy + h / 2) + ' C' + mid + ' ' + (sy + h / 2) + ',' + mid + ' ' + ty + ',' + tx + ' ' + ty,
      fill: 'none', 'class': 'sy-attack' + (crit ? '' : ' warn')
    }, attackLayer);
    el('circle', { cx: tx, cy: ty, r: 4, 'class': 'sy-attack-end' + (crit ? '' : ' warn') }, attackLayer);
  }

  /* --- trains ------------------------------------------------ */
  function syncTrains(state) {
    var order = state.trainOrder || [];

    /* création / suppression selon ce que l'API renvoie */
    Object.keys(trains).forEach(function (id) {
      if (order.indexOf(id) === -1) {
        if (trains[id].g.parentNode) trains[id].g.parentNode.removeChild(trains[id].g);
        delete trains[id];
      }
    });

    order.forEach(function (id) {
      var d = state.trains[id];
      if (!trains[id]) trains[id] = createTrain(id, d);
      var o = trains[id];
      var x = kmToX(d.km);
      if (x == null) x = xs[0];
      o.xTarget = x;
      if (o.xCur == null) o.xCur = x;

      var crit = d.tone === 'crit';
      var watch = d.tone === 'watch';
      cls(o.box, 'sy-train-box', crit ? 'crit' : (watch ? 'watch' : null));
      cls(o.tid, 'sy-train-id', crit ? 'crit' : null);
      cls(o.dot, 'sy-train-dot', crit ? 'crit' : (watch ? 'watch' : null));

      /* Encart étroit : l'identifiant suffit, le libellé complet
         reste dans la carte « Trains ». */
      o.tid.textContent = d.shortLabel || d.label;
      o.sp.textContent = d.speed == null ? '—' : d.speed;
      o.arrow.textContent = d.dir >= 0 ? '→' : '←';
      o.pk.textContent = d.km == null ? 'PK —' : 'PK ' + d.km.toFixed(1);
      o.sp.setAttribute('fill', d.running ? '#F9F9FA' : '#8A7A72');

      /* Un train à l'arrêt ou sans communication se voit */
      o.stateTxt.textContent = d.offline ? 'COMMUNICATION PERDUE'
        : (!d.running ? 'À L’ARRÊT' : (d.siv && !d.siv.coherent ? 'INFO VOYAGEURS INCOHÉRENTE' : ''));
      cls(o.stateTxt, 'sy-train-st', d.offline || (d.siv && !d.siv.coherent) ? 'crit' : 'watch');
    });
  }

  function createTrain(id, d) {
    var g = el('g', {}, gTrains);
    var o = { g: g, id: id, xCur: null, xTarget: null };
    o.box = el('rect', { x: -98, y: 224, width: 196, height: 42, rx: 4, 'class': 'sy-train-box' }, g);
    txt(-90, 248, '🚄', 'sy-train-emo', g);
    o.tid = txt(-70, 240, d.label, 'sy-train-id', g);
    o.pk = txt(-70, 256, 'PK —', 'sy-train-pk', g);
    o.sp = txt(30, 247, '0', 'sy-train-sp', g);
    o.unit = txt(62, 248, 'km/h', 'sy-train-u', g);
    o.arrow = txt(84, 248, '→', 'sy-train-u', g);
    o.stateTxt = txt(-90, 220, '', 'sy-train-st', g);
    el('line', { x1: 0, y1: 266, x2: 0, y2: Y_RAIL - 10, stroke: '#D76F50', 'stroke-width': 1, opacity: .5 }, g);
    o.dot = el('circle', { cx: 0, cy: Y_RAIL, r: 6, 'class': 'sy-train-dot' }, g);
    return o;
  }

  /* Convergence douce vers la position reçue. Purement visuel :
     aucune position n'est extrapolée au-delà de la dernière
     valeur transmise par l'automate. */
  var lastTs = 0;
  function loop(ts) {
    var dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.2) : 0;
    lastTs = ts;
    var k = 1 - Math.exp(-dt / 0.45);
    Object.keys(trains).forEach(function (id) {
      var o = trains[id];
      if (o.xTarget == null) return;
      if (o.xCur == null) o.xCur = o.xTarget;
      else o.xCur += (o.xTarget - o.xCur) * k;
      o.g.setAttribute('transform', 'translate(' + o.xCur.toFixed(2) + ',0)');
    });
    requestAnimationFrame(loop);
  }

  return {
    build: build,
    render: render,
    focusStation: focusStation,
    focusCommunication: focusCommunication,
    releaseFocus: releaseFocus
  };
})();
