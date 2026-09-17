'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function main() {
  const terMap = await startMockServer({
    '/api/snapshot': {
      plc_online: true,
      data_quality: 'ok',
      last_poll: new Date().toISOString(),
      trains: [
        {
          train_id: 'DKR',
          vitesse_kmh: 0,
          tension_kv: 18.5,
          mode_degrade: true,
          alm_tension_basse: true,
          alm_critique: false,
          etat_train: 'arrete',
          siv: { ecart_position: 0 }
        }
      ],
      energy: { tx2_output_voltage_kv: 17.5 },
      ctc: { alm_aiguille: false, alm_collision: false },
      siv_crisis: { niveau: 0 }
    }
  });

  const viewer3d = await startMockServer({
    '/api/telemetry': {
      connected: true,
      source: 'mock',
      transformer2: {
        output_voltage: 17,
        alarm_high: false,
        alarm_critical: false
      },
      feeder2: {
        alarm_overload: true,
        alarm_imbalance: false,
        alarm_incoherence: false
      }
    }
  });

  const gare = await startMockServer({
    '/status': {
      service: 'Billettique Gare',
      kind: 'ticketing',
      ip: '192.168.40.11',
      status: 'available',
      availability: 'nominal',
      updated_at: new Date().toISOString(),
      metrics: { validations_last_hour: 42 },
      published: { gare: 'Dakar' },
      events: []
    }
  });

  const eveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-eve-'));
  const eventDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-events-'));
  fs.writeFileSync(path.join(eveDir, 'eve-test.json'), JSON.stringify({
    timestamp: new Date().toISOString(),
    event_type: 'alert',
    src_ip: '192.168.30.30',
    dest_ip: '192.168.20.10',
    dest_port: 502,
    app_proto: 'modbus',
    alert: {
      signature_id: 9300001,
      signature: 'TER-ENERGY-001 Commande Modbus non autorisée vers l automate énergie traction',
      severity: 1
    }
  }) + '\n');

  process.env.PORT = '0';
  process.env.TER_MAP_URL = terMap.url;
  process.env.VIEWER3D_URL = viewer3d.url;
  process.env.OCULOX_PROVIDER = 'local-eve';
  process.env.OCULOX_EVE_PATH = eveDir;
  process.env.EVENT_DB_PATH = path.join(eventDbDir, 'events.jsonl');
  process.env.POLL_MS = '200';
  process.env.ALERT_POLL_MS = '300';

  const gareConfigPath = path.join(__dirname, '..', 'config', 'gare-services.json');
  const originalGareConfig = fs.readFileSync(gareConfigPath, 'utf8');
  fs.writeFileSync(gareConfigPath, JSON.stringify([
    {
      id: 'billettique',
      name: 'Billettique Gare',
      url: gare.url,
      ip: '192.168.40.11',
      role: 'Vente et validation simulées'
    }
  ]));

  const { startServer } = require('../server');
  const api = startServer(0);
  const apiUrl = await listeningUrl(api);

  await sleep(900);

  const health = await getJson(`${apiUrl}/api/health`);
  assert.strictEqual(health.status, 'running');
  assert.strictEqual(health.process_connected, true);
  assert.strictEqual(health.energy_connected, true);
  assert.strictEqual(health.gare_services_connected, true);

  const state = await getJson(`${apiUrl}/api/twin/state`);
  assert.strictEqual(state.process.connected, true);
  assert.strictEqual(state.energy.connected, true);
  assert.strictEqual(state.gare_services.connected, true);
  assert.ok(state.alerts.length >= 1, 'expected at least one alert');
  assert.strictEqual(state.alerts[0].scenario, 'S5');
  assert.strictEqual(state.alerts[0].impact.observed, true);
  assert.strictEqual(state.summary.status, 'incident_confirmed');

  const alerts = await getJson(`${apiUrl}/api/twin/alerts`);
  assert.ok(alerts.items[0].operator_message.includes('automate'));
  assert.strictEqual(alerts.items[0].source.name, 'Source inconnue');
  assert.strictEqual(alerts.items[0].destination.name, 'Automate énergie traction');

  const events = await getJson(`${apiUrl}/api/twin/events?limit=10&q=automate`);
  assert.strictEqual(events.connected, true);
  assert.ok(events.total >= 1, 'expected persisted events');
  assert.strictEqual(events.items[0].source.name, 'Source inconnue');
  assert.ok(fs.existsSync(process.env.EVENT_DB_PATH), 'expected event db file');

  const eventById = await getJson(`${apiUrl}/api/twin/events/${encodeURIComponent(events.items[0].id)}`);
  assert.strictEqual(eventById.id, events.items[0].id);

  const timeline = await getJson(`${apiUrl}/api/twin/timeline`);
  assert.ok(timeline.count >= 2, 'expected cyber and impact timeline entries');

  const gareServices = await getJson(`${apiUrl}/api/twin/gare/services`);
  assert.strictEqual(gareServices.connected, true);
  assert.strictEqual(gareServices.items[0].name, 'Billettique Gare');
  assert.strictEqual(gareServices.items[0].metrics.validations_last_hour, 42);

  await postJson(`${apiUrl}/api/twin/events`, {
    rule_id: '9300040',
    message: 'Information voyageurs incoherente',
    source_ip: '192.168.40.12',
    destination_ip: '192.168.40.13',
    destination_port: 8080
  });
  await sleep(700);
  const afterManualRefresh = await getJson(`${apiUrl}/api/twin/alerts`);
  assert.ok(
    afterManualRefresh.items.some(item => item.scenario === 'S2'),
    'expected manual event to survive alert refresh'
  );

  api.close();
  terMap.server.close();
  viewer3d.server.close();
  gare.server.close();
  fs.writeFileSync(gareConfigPath, originalGareConfig);

  console.log('Digital Twin API tests passed');
}

function startMockServer(routes) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const payload = routes[req.url] || { error: 'not found' };
      res.writeHead(routes[req.url] ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

function listeningUrl(server) {
  return new Promise(resolve => {
    if (server.address()) return resolve(`http://127.0.0.1:${server.address().port}`);
    server.on('listening', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text);
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
