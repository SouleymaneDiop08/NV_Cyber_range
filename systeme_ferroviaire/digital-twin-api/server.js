'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 4010);
const TER_MAP_URL = stripSlash(process.env.TER_MAP_URL || 'http://ter-map-backend:4000');
const VIEWER3D_URL = stripSlash(process.env.VIEWER3D_URL || 'http://viewer3d_station_b:8090');
const OCULOX_PROVIDER = process.env.OCULOX_PROVIDER || 'disabled';
const OCULOX_URL = stripSlash(process.env.OCULOX_URL || '');
const OCULOX_INDEX = process.env.OCULOX_INDEX || 'malcolm_beats_suricata_*';
const OCULOX_EVE_PATH = process.env.OCULOX_EVE_PATH || '';
const POLL_MS = Number(process.env.POLL_MS || 1000);
const ALERT_POLL_MS = Number(process.env.ALERT_POLL_MS || 5000);
const ALERT_WINDOW_MS = Number(process.env.ALERT_WINDOW_MS || 15 * 60 * 1000);
const ALERT_RULE_PREFIX = process.env.ALERT_RULE_PREFIX || '930';
const ALERT_DEDUP_MS = Number(process.env.ALERT_DEDUP_MS || 60000);
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 4000);
const EVENT_DB_PATH = process.env.EVENT_DB_PATH || path.join(__dirname, 'data', 'events.jsonl');
const EVENT_DB_MAX_ITEMS = Number(process.env.EVENT_DB_MAX_ITEMS || 5000);

const assets = readJson('config/assets.json');
const ruleMapping = readJson('config/rule-mapping.json');
const gareServices = readJson('config/gare-services.json');

const LEGITIMATE_ALERT_SOURCES = new Set([
  '192.168.10.20', // SCADA Station A
  '192.168.20.20', // SCADA Station B
  '192.168.20.70', // Digital Twin API OT
  '192.168.20.90', // Vue 3D energie
  '192.168.30.10', // SCADA central
  '192.168.30.20', // Poste ingenierie
  '192.168.30.50', // Capteur OT
  '192.168.40.11', // Billettique Gare
  '192.168.40.12', // SIV Gare
  '192.168.40.13', // SONO Gare
  '192.168.40.14', // PIPC
  '192.168.40.15', // CCTV / VMS Gare
  '192.168.40.70', // Digital Twin API Gare
]);

const LEGITIMATE_SOURCE_FILTERED_RULES = new Set([
  '9300010',
  '9300020',
  '9300021',
  '9300050',
  '9300060',
]);

const NON_BUSINESS_DESTINATIONS = new Set([
  '192.168.10.1',
  '192.168.20.1',
  '192.168.30.1',
  '192.168.40.1',
]);

let processCache = unavailable('process', TER_MAP_URL);
let energyCache = unavailable('energy', VIEWER3D_URL);
let alertCache = emptyAlerts('Initialisation');
let gareCache = emptyGareServices();
const manualEvents = [];
const sseClients = new Set();
const eventDb = loadEventDb();
let twinState = buildTwinState();

function stripSlash(value) {
  return String(value || '').replace(/\/$/, '');
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, relativePath), 'utf8'));
}

function loadEventDb() {
  const map = new Map();
  try {
    if (!fs.existsSync(EVENT_DB_PATH)) return map;
    const lines = fs.readFileSync(EVENT_DB_PATH, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event?.id) map.set(event.id, event);
      } catch {
        // Ignore malformed persisted records.
      }
    }
  } catch (err) {
    console.error('[DigitalTwinAPI] event db load failed:', err.message);
  }
  return map;
}

function appendEventDb(event) {
  try {
    fs.mkdirSync(path.dirname(EVENT_DB_PATH), { recursive: true });
    fs.appendFileSync(EVENT_DB_PATH, `${JSON.stringify(event)}\n`);
  } catch (err) {
    console.error('[DigitalTwinAPI] event db append failed:', err.message);
  }
}

function pruneEventDbIfNeeded() {
  if (eventDb.size <= EVENT_DB_MAX_ITEMS) return;
  const sorted = Array.from(eventDb.values()).sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0));
  const keep = sorted.slice(0, EVENT_DB_MAX_ITEMS);
  eventDb.clear();
  for (const item of keep) eventDb.set(item.id, item);
  try {
    fs.mkdirSync(path.dirname(EVENT_DB_PATH), { recursive: true });
    fs.writeFileSync(EVENT_DB_PATH, keep.map(item => JSON.stringify(item)).join('\n') + '\n');
  } catch (err) {
    console.error('[DigitalTwinAPI] event db compact failed:', err.message);
  }
}

function persistEvents(alerts) {
  let added = 0;
  for (const alert of alerts || []) {
    if (!alert?.id || eventDb.has(alert.id)) continue;
    const record = {
      ...alert,
      persisted_at: new Date().toISOString(),
    };
    eventDb.set(record.id, record);
    appendEventDb(record);
    added += 1;
  }
  if (added) pruneEventDbIfNeeded();
}

function queryEvents(url) {
  const params = url.searchParams;
  const limit = Math.min(Math.max(Number(params.get('limit') || 100), 1), 500);
  const offset = Math.max(Number(params.get('offset') || 0), 0);
  const from = params.get('from') ? Date.parse(params.get('from')) : null;
  const to = params.get('to') ? Date.parse(params.get('to')) : null;
  const source = String(params.get('source') || '').toLowerCase();
  const destination = String(params.get('destination') || '').toLowerCase();
  const type = String(params.get('type') || '').toLowerCase();
  const severity = String(params.get('severity') || '').toLowerCase();
  const q = String(params.get('q') || '').toLowerCase();

  const all = Array.from(eventDb.values())
    .sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0))
    .filter(event => {
      const ts = Date.parse(event.timestamp || 0);
      if (from && (!ts || ts < from)) return false;
      if (to && (!ts || ts > to)) return false;
      if (source && !`${event.source?.name || ''} ${event.source?.ip || ''}`.toLowerCase().includes(source)) return false;
      if (destination && !`${event.destination?.name || ''} ${event.destination?.ip || ''}`.toLowerCase().includes(destination)) return false;
      if (type && !`${event.family || ''} ${event.title || ''} ${event.rule_id || ''}`.toLowerCase().includes(type)) return false;
      if (severity && String(event.severity || '').toLowerCase() !== severity) return false;
      if (q) {
        const haystack = [
          event.rule_id,
          event.rule_name,
          event.family,
          event.title,
          event.operator_message,
          event.potential_impact,
          event.source?.name,
          event.source?.ip,
          event.destination?.name,
          event.destination?.ip,
          event.protocol,
          event.severity,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

  return {
    connected: true,
    source: 'event-db',
    total: all.length,
    limit,
    offset,
    items: all.slice(offset, offset + limit),
  };
}

function unavailable(kind, source) {
  return {
    connected: false,
    source,
    updated_at: null,
    error: `${kind} unavailable`,
    data: null,
  };
}

function emptyAlerts(error) {
  return {
    connected: false,
    source: OCULOX_PROVIDER,
    updated_at: null,
    error,
    count: 0,
    items: [],
  };
}

function emptyGareServices() {
  return {
    connected: false,
    source: 'services_gare',
    updated_at: null,
    error: 'services gare unavailable',
    count: 0,
    items: gareServices.map(service => ({
      ...service,
      connected: false,
      status: null,
      error: 'not polled yet',
    })),
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function notFound(res) {
  sendJson(res, 404, { error: 'Not found' });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk.toString();
      if (data.length > 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}

async function refreshProcess() {
  try {
    const data = await fetchJson(`${TER_MAP_URL}/api/snapshot`);
    processCache = {
      connected: Boolean(data.plc_online),
      source: `${TER_MAP_URL}/api/snapshot`,
      updated_at: new Date().toISOString(),
      error: null,
      data,
    };
  } catch (err) {
    processCache = {
      ...processCache,
      connected: false,
      updated_at: new Date().toISOString(),
      error: err.message,
    };
  }
}

async function refreshEnergy() {
  try {
    const data = await fetchJson(`${VIEWER3D_URL}/api/telemetry`);
    energyCache = {
      connected: Boolean(data.connected),
      source: `${VIEWER3D_URL}/api/telemetry`,
      updated_at: new Date().toISOString(),
      error: null,
      data,
    };
  } catch (err) {
    energyCache = {
      ...energyCache,
      connected: false,
      updated_at: new Date().toISOString(),
      error: err.message,
    };
  }
}

async function refreshGareServices() {
  const items = await Promise.all(gareServices.map(async service => {
    try {
      const data = await fetchJson(`${stripSlash(service.url)}/status`, { timeoutMs: 1500 });
      return {
        ...service,
        connected: true,
        status: data.status || 'unknown',
        availability: data.availability || 'unknown',
        updated_at: data.updated_at || new Date().toISOString(),
        data,
        error: null,
      };
    } catch (err) {
      return {
        ...service,
        connected: false,
        status: 'unreachable',
        availability: 'unknown',
        updated_at: new Date().toISOString(),
        data: null,
        error: err.message,
      };
    }
  }));
  gareCache = {
    connected: items.some(item => item.connected),
    source: 'services_gare',
    updated_at: new Date().toISOString(),
    error: items.every(item => item.connected) ? null : 'one or more gare services unavailable',
    count: items.length,
    items,
  };
}

function buildOculoxQuery() {
  return JSON.stringify({
    size: 50,
    sort: [{ '@timestamp': { order: 'desc' } }],
    query: {
      bool: {
        filter: [
          { range: { '@timestamp': { gte: `now-${Math.ceil(ALERT_WINDOW_MS / 60000)}m`, lte: 'now' } } }
        ],
        should: [
          { prefix: { 'rule.id': '930' } },
          { prefix: { 'alert.signature_id': '930' } },
          { match_phrase: { 'event.module': 'suricata' } }
        ],
        minimum_should_match: 1
      }
    },
    _source: [
      '@timestamp',
      'timestamp',
      'rule.id',
      'rule.name',
      'alert.signature_id',
      'alert.signature',
      'alert.severity',
      'event.severity',
      'source.ip',
      'destination.ip',
      'destination.port',
      'src_ip',
      'dest_ip',
      'dest_port',
      'proto',
      'app_proto',
      'network.protocol'
    ]
  });
}

async function refreshAlerts() {
  try {
    if (OCULOX_PROVIDER === 'disabled') {
      alertCache = emptyAlerts('OCULOX_PROVIDER=disabled');
      alertCache.items = [...manualEvents];
      alertCache.count = alertCache.items.length;
      alertCache.updated_at = new Date().toISOString();
      return;
    }

    let rawItems = [];
    if (OCULOX_PROVIDER === 'http') {
      rawItems = await queryOculoxHttp();
    } else if (OCULOX_PROVIDER === 'local-eve' || OCULOX_PROVIDER === 'oculox-eve') {
      rawItems = await queryLocalEve();
    } else {
      alertCache = emptyAlerts(`Provider unsupported: ${OCULOX_PROVIDER}`);
      return;
    }

    const normalized = [...manualEvents, ...rawItems.map(normalizeAlert).filter(Boolean)];
    normalized.sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0));
    // Dédup : une même règle depuis une même source vers une même cible produit
    // souvent une rafale de trames (ex. écritures Modbus en boucle de feeder.py).
    // On la réduit à une alerte par fenêtre ALERT_DEDUP_MS — la plus récente.
    const items = [];
    const lastKeptTs = new Map();
    for (const a of normalized) {
      const key = `${a.rule_id}|${a.source?.ip || ''}|${a.destination?.ip || ''}`;
      const ts = Date.parse(a.timestamp || 0) || 0;
      const prevTs = lastKeptTs.get(key);
      if (prevTs !== undefined && (prevTs - ts) <= ALERT_DEDUP_MS) continue;
      items.push(a);
      lastKeptTs.set(key, ts);
    }
    alertCache = {
      connected: true,
      source: OCULOX_PROVIDER === 'http' ? OCULOX_URL : OCULOX_EVE_PATH,
      updated_at: new Date().toISOString(),
      error: null,
      count: items.length,
      items,
    };
  } catch (err) {
    alertCache = emptyAlerts(err.message);
  }
}

async function queryOculoxHttp() {
  if (!OCULOX_URL) throw new Error('OCULOX_URL non configuré');
  const body = buildOculoxQuery();
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.OCULOX_USER || process.env.OCULOX_PASS) {
    const token = Buffer.from(`${process.env.OCULOX_USER || ''}:${process.env.OCULOX_PASS || ''}`).toString('base64');
    headers.Authorization = `Basic ${token}`;
  }
  const json = await fetchJson(`${OCULOX_URL}/${OCULOX_INDEX}/_search`, {
    method: 'POST',
    headers,
    body,
    timeoutMs: HTTP_TIMEOUT_MS,
  });
  return ((json.hits || {}).hits || []).map(hit => ({ ...hit._source, _id: hit._id, _index: hit._index }));
}

async function queryLocalEve() {
  if (!OCULOX_EVE_PATH) throw new Error('OCULOX_EVE_PATH non configuré');
  const stat = fs.statSync(OCULOX_EVE_PATH);
  const files = stat.isDirectory()
    ? fs.readdirSync(OCULOX_EVE_PATH).filter(f => f.startsWith('eve') && f.endsWith('.json')).sort().map(f => path.join(OCULOX_EVE_PATH, f))
    : [OCULOX_EVE_PATH];
  const minTs = Date.now() - ALERT_WINDOW_MS;
  const items = [];
  for (const file of files.slice(-8)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').slice(-5000);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.event_type !== 'alert') continue;
        const evTs = Date.parse(ev.timestamp || '');
        if (!Number.isNaN(evTs) && evTs < minTs) continue;
        items.push(ev);
      } catch {
        // Ignore malformed EVE lines.
      }
    }
  }
  return items.slice(-50);
}

function normalizeAlert(raw) {
  const timestamp = raw['@timestamp'] || raw.timestamp || new Date().toISOString();
  const alert = raw.alert || {};
  const rule = raw.rule || {};
  const ruleId = String(rule.id || alert.signature_id || raw.ruleId || '');
  const ruleName = rule.name || alert.signature || raw.ruleName || 'Alerte cyber';
  if (ALERT_RULE_PREFIX && ruleId && !ruleId.startsWith(ALERT_RULE_PREFIX)) return null;
  const sourceIp = nested(raw, 'source.ip') || raw.src_ip || raw.source;
  const destIp = nested(raw, 'destination.ip') || raw.dest_ip || raw.destination;
  const destPort = nested(raw, 'destination.port') || raw.dest_port || raw.destination_port || null;
  if (shouldSuppressKnownLegitimateAlert(ruleId, sourceIp, destIp)) return null;
  const mapping = ruleMapping[ruleId] || classifyByName(ruleName, sourceIp, destIp);
  if (!ruleId && !mapping) return null;
  const source = enrichAsset(sourceIp);
  const destination = enrichAsset(destIp);
  const severity = mapping.severity || severityFromNumber(alert.severity || nested(raw, 'event.severity'));

  return {
    id: raw._id || `${ruleId}-${timestamp}-${sourceIp || 'unknown'}-${destIp || 'unknown'}`,
    timestamp,
    rule_id: ruleId || mapping.family,
    rule_name: ruleName,
    family: mapping.family,
    scenario: mapping.scenario,
    zone: mapping.zone,
    severity,
    title: mapping.title,
    operator_message: mapping.operator_message,
    potential_impact: mapping.potential_impact,
    source,
    destination,
    destination_port: destPort,
    protocol: raw.app_proto || raw.proto || nested(raw, 'network.protocol') || null,
    views: mapping.views || ['global'],
  };
}

function shouldSuppressKnownLegitimateAlert(ruleId, sourceIp, destIp) {
  if (NON_BUSINESS_DESTINATIONS.has(String(destIp || ''))) return true;
  if (!LEGITIMATE_SOURCE_FILTERED_RULES.has(String(ruleId || ''))) return false;
  if (!LEGITIMATE_ALERT_SOURCES.has(String(sourceIp || ''))) return false;
  if (String(destIp || '').startsWith('192.168.20.') || String(destIp || '').startsWith('192.168.40.')) return true;
  return false;
}

function nested(obj, dotted) {
  return dotted.split('.').reduce((cur, key) => cur && cur[key], obj);
}

function enrichAsset(ip) {
  if (!ip) {
    return {
      ip: null,
      name: 'Source inconnue',
      zone: 'unknown',
      business_role: 'Non identifié',
      type: 'unknown',
    };
  }
  return {
    ip,
    ...(assets[ip] || {
      name: `Équipement ${ip}`,
      zone: inferZone(ip),
      business_role: 'Équipement non répertorié',
      type: 'unknown',
    }),
  };
}

function cleanDisplayText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/simulées/gi, '')
    .replace(/simulée/gi, '')
    .replace(/simulé/gi, '')
    .replace(/simulees/gi, '')
    .replace(/simulee/gi, '')
    .replace(/simule/gi, '')
    .replace(/__+/g, '_')
    .replace(/--+/g, '-')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .replace(/_$/g, '')
    .trim();
}

function cleanDisplayPayload(value) {
  if (Array.isArray(value)) return value.map(cleanDisplayPayload);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanDisplayPayload(item)]));
  }
  return cleanDisplayText(value);
}

function inferZone(ip) {
  if (ip.startsWith('192.168.10.')) return 'station_a';
  if (ip.startsWith('192.168.20.')) return 'station_b';
  if (ip.startsWith('192.168.30.')) return 'central';
  if (ip.startsWith('192.168.40.')) return 'services_gare';
  return 'unknown';
}

function severityFromNumber(value) {
  const n = Number(value);
  if (n <= 1) return 'critical';
  if (n === 2) return 'high';
  if (n === 3) return 'medium';
  return 'low';
}

function classifyByName(ruleName, sourceIp, destIp) {
  const name = String(ruleName || '').toLowerCase();
  if (name.includes('siv') || name.includes('voyageur')) return ruleMapping['9300040'];
  if (name.includes('ctc') || name.includes('signal') || name.includes('aiguille')) return ruleMapping['9300030'];
  if (name.includes('energie') || name.includes('énergie') || name.includes('catenaire') || name.includes('traction')) return ruleMapping['9300001'];
  if (name.includes('scan') || name.includes('reconnaissance') || name.includes('interroge')) return ruleMapping['9300020'];
  if (sourceIp && sourceIp.startsWith('192.168.40.') && destIp && destIp.startsWith('192.168.20.')) return ruleMapping['9300010'];
  return {
    family: 'TER-GENERAL',
    scenario: 'UNKNOWN',
    zone: 'general',
    severity: 'medium',
    title: 'Événement cyber à qualifier',
    operator_message: 'Un événement cyber a été observé et doit être qualifié par l’équipe de supervision.',
    potential_impact: 'Impact non déterminé.',
    views: ['global'],
  };
}

function buildTwinState() {
  const process = normalizeProcess(processCache.data);
  const energy = normalizeEnergy(energyCache.data);
  const gareServicesState = normalizeGareServices(gareCache);
  const enrichedAlerts = alertCache.items.map(alert => correlateAlert(alert, process, energy));
  persistEvents(enrichedAlerts);
  const incidents = enrichedAlerts.filter(alert => ['high', 'critical'].includes(alert.severity) || alert.impact.status !== 'Aucun impact confirmé');
  const timeline = buildTimeline(process, energy, enrichedAlerts);

  return {
    timestamp: new Date().toISOString(),
    health: {
      status: processCache.connected || energyCache.connected ? 'degraded_or_ok' : 'degraded',
      process_connected: processCache.connected,
      energy_connected: energyCache.connected,
      alerts_connected: alertCache.connected,
      gare_services_connected: gareCache.connected,
      process_error: processCache.error,
      energy_error: energyCache.error,
      alerts_error: alertCache.error,
      gare_services_error: gareCache.error,
    },
    sources: {
      process: processCache.source,
      energy: energyCache.source,
      alerts: alertCache.source,
      gare_services: gareCache.source,
    },
    process,
    energy,
    gare_services: gareServicesState,
    alerts: enrichedAlerts,
    incidents,
    timeline,
    summary: summarize(process, energy, enrichedAlerts),
  };
}

function normalizeGareServices(cache) {
  return {
    connected: cache.connected,
    updated_at: cache.updated_at,
    count: cache.count,
    items: cache.items.map(item => ({
      id: item.id,
      name: item.name,
      ip: item.ip,
      role: item.role,
      connected: item.connected,
      status: item.status,
      availability: item.availability,
      updated_at: item.updated_at,
      metrics: item.data?.metrics || {},
      published: cleanDisplayPayload(item.data?.published || {}),
      events_count: Array.isArray(item.data?.events) ? item.data.events.length : 0,
      error: item.error,
    })),
  };
}

function normalizeProcess(data) {
  if (!data) {
    return {
      connected: false,
      trains: [],
      ctc: {},
      siv: {},
      alarms: [],
    };
  }
  return {
    connected: Boolean(data.plc_online),
    last_poll: data.last_poll || null,
    data_quality: data.data_quality || 'unknown',
    trains: data.trains || [],
    energy: data.energy || {},
    ctc: data.ctc || {},
    siv_crisis: data.siv_crisis || {},
    alarms: collectProcessAlarms(data),
  };
}

function normalizeEnergy(data) {
  if (!data) {
    return {
      connected: false,
      transformers: {},
      feeders: {},
      alarms: [],
    };
  }
  return {
    connected: Boolean(data.connected),
    source: data.source || 'unknown',
    breakers: data.breakers || {},
    busbar: data.busbar || {},
    grid: data.grid || {},
    transformers: {
      tx1: data.transformer1 || {},
      tx2: data.transformer2 || {},
    },
    feeders: {
      feeder1: data.feeder1 || {},
      feeder2: data.feeder2 || {},
    },
    trains: data.trains || {},
    alarms: collectEnergyAlarms(data),
  };
}

function collectProcessAlarms(data) {
  const alarms = [];
  for (const train of data.trains || []) {
    for (const label of train.alarmes_actives || []) {
      alarms.push({
        scope: 'train',
        train: train.train_id,
        label,
      });
    }
  }
  if (data.ctc?.alm_collision) alarms.push({ scope: 'ctc', label: 'Risque collision actif' });
  if (data.ctc?.alm_aiguille) alarms.push({ scope: 'ctc', label: 'Alerte aiguille active' });
  if (data.siv_crisis?.alm_crise_totale) alarms.push({ scope: 'siv', label: 'Crise information voyageurs active' });
  return alarms;
}

function collectEnergyAlarms(data) {
  const alarms = [];
  const f2 = data.feeder2 || {};
  const tx2 = data.transformer2 || {};
  if (f2.alarm_overload) alarms.push({ scope: 'energy', label: 'Surcharge Feeder 2' });
  if (f2.alarm_imbalance) alarms.push({ scope: 'energy', label: 'Déséquilibre Feeder 2' });
  if (f2.alarm_incoherence) alarms.push({ scope: 'energy', label: 'Incohérence Feeder 2' });
  if (tx2.alarm_high) alarms.push({ scope: 'energy', label: 'Température élevée TX2' });
  if (tx2.alarm_critical) alarms.push({ scope: 'energy', label: 'Température critique TX2' });
  return alarms;
}

function correlateAlert(alert, process, energy) {
  let impact = {
    status: 'Aucun impact confirmé',
    observed: false,
    details: alert.potential_impact || 'Impact non déterminé.',
  };

  if (alert.scenario === 'S5') {
    const trainImpacted = process.trains.some(t =>
      t.mode_degrade || t.alm_tension_basse || t.alm_critique || t.etat_train === 'arrete' || t.tension_kv < 20
    );
    const energyImpacted = energy.alarms.length > 0 || Number(energy.transformers?.tx2?.output_voltage || 25) < 18;
    if (trainImpacted || energyImpacted) {
      impact = {
        status: 'Impact confirmé',
        observed: true,
        details: 'L’état procédé indique une dégradation énergie ou train après l’événement cyber.',
      };
    }
  }

  if (alert.scenario === 'S2') {
    const sivMismatch = process.trains.some(t => t.siv && Number(t.siv.ecart_position || 0) > 0);
    if (sivMismatch || process.siv_crisis?.niveau > 0) {
      impact = {
        status: 'Impact métier confirmé',
        observed: true,
        details: 'L’information voyageurs est incohérente avec la position réelle du train.',
      };
    }
  }

  if (alert.scenario === 'S4' && (process.ctc?.alm_aiguille || process.ctc?.alm_collision || process.ctc?.aiguille_deviee)) {
    impact = {
      status: 'Impact signalisation confirmé',
      observed: true,
      details: 'Le PLC indique une anomalie liée à la signalisation ou à l’aiguillage.',
    };
  }

  return {
    ...alert,
    impact,
  };
}

function buildTimeline(process, energy, alerts) {
  const items = [];
  for (const alert of alerts) {
    items.push({
      timestamp: alert.timestamp,
      type: 'cyber',
      severity: alert.severity,
      title: alert.title,
      message: alert.operator_message,
      source: alert.source.name,
      destination: alert.destination.name,
      scenario: alert.scenario,
    });
    if (alert.impact.observed) {
      items.push({
        timestamp: alert.timestamp,
        type: 'impact',
        severity: alert.severity,
        title: alert.impact.status,
        message: alert.impact.details,
        scenario: alert.scenario,
      });
    }
  }
  for (const alarm of [...(process.alarms || []), ...(energy.alarms || [])]) {
    items.push({
      timestamp: new Date().toISOString(),
      type: 'process',
      severity: 'high',
      title: 'Alarme procédé',
      message: alarm.label,
    });
  }
  return items.sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0)).slice(0, 100);
}

function summarize(process, energy, alerts) {
  const critical = alerts.filter(a => a.severity === 'critical');
  const impacts = alerts.filter(a => a.impact?.observed);
  if (impacts.length) {
    return {
      status: 'incident_confirmed',
      severity: impacts.some(i => i.severity === 'critical') ? 'critical' : 'high',
      message: `${impacts.length} impact(s) métier confirmé(s) par l’état procédé.`,
    };
  }
  if (critical.length) {
    return {
      status: 'cyber_critical',
      severity: 'critical',
      message: `${critical.length} alerte(s) critique(s) sans impact procédé confirmé pour l’instant.`,
    };
  }
  if (alerts.length) {
    return {
      status: 'cyber_activity',
      severity: 'medium',
      message: `${alerts.length} événement(s) cyber observé(s), aucun impact confirmé.`,
    };
  }
  if (!process.connected && !energy.connected) {
    return {
      status: 'degraded',
      severity: 'high',
      message: 'Les sources procédé principales ne sont pas disponibles.',
    };
  }
  return {
    status: 'nominal',
    severity: 'low',
    message: 'Aucun incident cyber ou impact métier confirmé.',
  };
}

async function refreshAll() {
  await Promise.all([refreshProcess(), refreshEnergy(), refreshGareServices()]);
  await refreshAlerts();
  twinState = buildTwinState();
  broadcastState();
}

function broadcastState() {
  const payload = `event: state\ndata: ${JSON.stringify(twinState)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

async function handleRequest(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, {
      status: 'running',
      process_connected: processCache.connected,
      energy_connected: energyCache.connected,
      alerts_connected: alertCache.connected,
      gare_services_connected: gareCache.connected,
      updated_at: twinState.timestamp,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/twin/state') {
    return sendJson(res, 200, twinState);
  }

  if (req.method === 'GET' && url.pathname === '/api/twin/alerts') {
    return sendJson(res, 200, {
      connected: alertCache.connected,
      count: twinState.alerts.length,
      items: twinState.alerts,
      error: alertCache.error,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/twin/timeline') {
    return sendJson(res, 200, {
      count: twinState.timeline.length,
      items: twinState.timeline,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/twin/incidents') {
    return sendJson(res, 200, {
      count: twinState.incidents.length,
      items: twinState.incidents,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/twin/events') {
    return sendJson(res, 200, queryEvents(url));
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/twin/events/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/twin/events/'.length));
    const item = eventDb.get(id);
    return item ? sendJson(res, 200, item) : notFound(res);
  }

  if (req.method === 'GET' && url.pathname === '/api/twin/gare/services') {
    return sendJson(res, 200, twinState.gare_services);
  }

  if (req.method === 'POST' && url.pathname === '/api/twin/events') {
    try {
      const event = await parseBody(req);
      const normalized = normalizeAlert({
        timestamp: event.timestamp || new Date().toISOString(),
        ruleId: event.rule_id || event.ruleId || 'manual-event',
        ruleName: event.rule_name || event.ruleName || event.message || 'Événement manuel',
        source: event.source_ip || event.source,
        destination: event.destination_ip || event.destination,
        destination_port: event.destination_port,
      });
      manualEvents.unshift(normalized);
      alertCache.items = [normalized, ...alertCache.items.filter(item => item.id !== normalized.id)];
      alertCache.connected = true;
      alertCache.error = null;
      alertCache.count = alertCache.items.length;
      alertCache.updated_at = new Date().toISOString();
      twinState = buildTwinState();
      broadcastState();
      return sendJson(res, 201, normalized);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/twin/reset') {
    manualEvents.length = 0;
    alertCache = emptyAlerts(OCULOX_PROVIDER === 'disabled' ? 'OCULOX_PROVIDER=disabled' : null);
    twinState = buildTwinState();
    broadcastState();
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/ws/twin') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`event: state\ndata: ${JSON.stringify(twinState)}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  return notFound(res);
}

function startServer(port = PORT) {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(err => sendJson(res, 500, { error: err.message }));
  });
  server.listen(port, () => {
    console.log(`[DigitalTwinAPI] listening on 0.0.0.0:${port}`);
    console.log(`[DigitalTwinAPI] process=${TER_MAP_URL} energy=${VIEWER3D_URL} alerts=${OCULOX_PROVIDER}`);
  });
  refreshAll().catch(err => console.error('[DigitalTwinAPI] initial refresh failed:', err.message));
  const processTimer = setInterval(() => {
    Promise.all([refreshProcess(), refreshEnergy(), refreshGareServices()])
      .then(() => {
        twinState = buildTwinState();
        broadcastState();
      })
      .catch(err => console.error('[DigitalTwinAPI] process refresh failed:', err.message));
  }, POLL_MS);
  const alertTimer = setInterval(() => {
    refreshAlerts()
      .then(() => {
        twinState = buildTwinState();
        broadcastState();
      })
      .catch(err => console.error('[DigitalTwinAPI] alert refresh failed:', err.message));
  }, ALERT_POLL_MS);
  server.on('close', () => {
    clearInterval(processTimer);
    clearInterval(alertTimer);
    for (const res of sseClients) {
      try { res.end(); } catch {}
    }
    sseClients.clear();
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer,
  normalizeAlert,
  correlateAlert,
  buildTwinState,
  enrichAsset,
};
