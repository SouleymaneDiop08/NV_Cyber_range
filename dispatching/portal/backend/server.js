const express      = require('express');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const path         = require('path');
const fs           = require('fs');

const app          = express();
const PORT         = 3000;
const JWT_SECRET   = process.env.JWT_SECRET || 'talixman-portal-secret-2024-icshub';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const MIN_PASSWORD_LENGTH = 8;

if (!process.env.JWT_SECRET) {
  console.warn('[security] JWT_SECRET non défini — utilisation du secret par défaut (non sûr en production). Définissez JWT_SECRET.');
}

// Hiérarchie des rôles : qui peut assigner quel rôle à la création/édition d'un compte.
// Ni admin ni superadmin ne peuvent créer/attribuer 'superadmin' via l'API — cela évite
// toute prolifération de comptes superadmin par ce canal.
const ASSIGNABLE_ROLES = {
  admin:      ['user', 'admin'],
  superadmin: ['user', 'admin'],
};
function rolesAssignableBy(role) {
  return ASSIGNABLE_ROLES[role] || [];
}
function isValidPassword(pw) {
  return typeof pw === 'string' && pw.length >= MIN_PASSWORD_LENGTH;
}

// === DATA DIRECTORY ===
const DATA_DIR      = process.env.DATA_DIR || '/data';
const USERS_FILE    = path.join(DATA_DIR, 'users.json');
const SERVICES_FILE = path.join(DATA_DIR, 'services.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
console.log(`[startup] data directory: ${DATA_DIR}`);

// === DEFAULTS ===
const DEFAULT_USERS = [
  { id: '1', username: 'admin',      password: bcrypt.hashSync('admin',      10), role: 'admin',      displayName: 'Administrateur'       },
  { id: '2', username: 'superadmin', password: bcrypt.hashSync('superadmin', 10), role: 'superadmin', displayName: 'Super Administrateur' },
];

const DEFAULT_SERVICES = [
  { id: 'scada_central',   name: 'SCADA Central',   tag: 'Supervision Centrale', desc: 'Supervision centralisée de toutes les stations électriques (Station A et Station B)', icon: '📱', url: '', port: 1884, network: 'L3 — 192.168.30.10' },
  { id: 'scada_station_a', name: 'SCADA Station A', tag: 'Station A — L1',       desc: 'Interface de supervision et de contrôle de la Station A',                            icon: '📱', url: '', port: 1881, network: 'L1 — 192.168.10.20' },
  { id: 'scada_station_b', name: 'SCADA Station B', tag: 'Station B — L2',       desc: 'Interface de supervision et de contrôle de la Station B',                            icon: '📱', url: '', port: 1882, network: 'L2 — 192.168.20.20' },
  { id: 'plc_station_a',   name: 'PLC Station A',   tag: 'Automate — L1',        desc: "Interface web de l'automate OpenPLC de la station A.",                               icon: '🤖', url: '', port: 8080, network: 'L1 — 192.168.10.10' },
  { id: 'plc_station_b',   name: 'PLC Station B',   tag: 'Automate — L2',        desc: "Interface web de l'automate OpenPLC de la station B.",                               icon: '🤖', url: '', port: 8081, network: 'L2 — 192.168.20.10' },
  { id: 'ews',             name: 'Engineering WS',  tag: 'Workstation — L3',     desc: 'Station de travail ingénieur pour les Stations électriques',                         icon: '💻', url: '', port: 6080, network: 'L3 — 192.168.30.20' },
  { id: 'kali',            name: 'Kali Attacker',   tag: 'Pentest — L3',         desc: "Machine Kali Linux pour les tests d'intrusion.",                                     icon: '☠️', url: '', port: 6081, network: 'L3 — 192.168.30.30' },
  { id: 'router_r1',       name: 'Routeur R1–R3',   tag: 'Infrastructure',       desc: "Interface d'administration du routeur L1/L3.",                                       icon: '🔀', url: '', port: 1444, network: 'L1/L3'                },
  { id: 'router_r2',       name: 'Routeur R2–R3',   tag: 'Infrastructure',       desc: "Interface d'administration du routeur L2/L3.",                                       icon: '🔀', url: '', port: 1443, network: 'L2/L3'                },
];

// === USERS STORE ===
function loadUsers() {
  if (fs.existsSync(USERS_FILE)) {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  }
  fs.writeFileSync(USERS_FILE, JSON.stringify(DEFAULT_USERS, null, 2));
  console.log('[startup] users.json created with defaults');
  return JSON.parse(JSON.stringify(DEFAULT_USERS));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// === SERVICES STORE ===
function loadServices() {
  if (fs.existsSync(SERVICES_FILE)) {
    return JSON.parse(fs.readFileSync(SERVICES_FILE, 'utf8'));
  }
  fs.writeFileSync(SERVICES_FILE, JSON.stringify(DEFAULT_SERVICES, null, 2));
  console.log('[startup] services.json created with defaults');
  return JSON.parse(JSON.stringify(DEFAULT_SERVICES));
}

function saveServices(services) {
  fs.writeFileSync(SERVICES_FILE, JSON.stringify(services, null, 2));
  console.log(`[services] saved ${services.length} entries to ${SERVICES_FILE}`);
}

// Initialize both files immediately at startup
loadUsers();
loadServices();

// === MIDDLEWARE ===
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' }
});

function requireAuth(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expirée' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin')
    return res.status(403).json({ error: 'Accès refusé' });
  next();
}

// === AUTH ROUTES ===

app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();
  const user  = users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Identifiants invalides' });
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, displayName: user.displayName },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
  res.cookie('token', token, { httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, maxAge: 8 * 3600 * 1000 });
  res.json({ success: true, user: { id: user.id, username: user.username, role: user.role, displayName: user.displayName } });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username, role: req.user.role, displayName: req.user.displayName } });
});

// === USER MANAGEMENT ===

app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  let users = loadUsers();
  // Un admin (non-superadmin) ne doit même pas savoir qu'un compte superadmin existe.
  if (req.user.role !== 'superadmin') {
    users = users.filter(u => u.role !== 'superadmin');
  }
  res.json(users.map(u => ({ id: u.id, username: u.username, role: u.role, displayName: u.displayName })));
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role, displayName } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username et password requis' });
  if (!isValidPassword(password))
    return res.status(400).json({ error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères` });

  const requestedRole = role || 'user';
  if (!rolesAssignableBy(req.user.role).includes(requestedRole))
    return res.status(403).json({ error: 'Rôle non autorisé' });

  const users = loadUsers();
  if (users.find(u => u.username === username))
    return res.status(409).json({ error: 'Utilisateur déjà existant' });
  const newUser = {
    id: Date.now().toString(), username,
    password: bcrypt.hashSync(password, 10),
    role: requestedRole,
    displayName: displayName || username
  };
  users.push(newUser);
  saveUsers(users);
  res.json({ success: true, user: { id: newUser.id, username: newUser.username, role: newUser.role } });
});

app.put('/api/users/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const isSelf = req.user.id === id;
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin' && !isSelf)
    return res.status(403).json({ error: 'Accès refusé' });

  const users = loadUsers();
  const idx   = users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Utilisateur non trouvé' });
  const target = users[idx];

  // Un admin (non-superadmin) ne peut pas agir sur un compte superadmin, même le sien
  // s'il en existait un (cas normalement impossible, gardé par défense en profondeur).
  if (target.role === 'superadmin' && req.user.role !== 'superadmin' && !isSelf)
    return res.status(403).json({ error: 'Accès refusé' });

  const { username, password, role, displayName } = req.body;

  if (username && users.find(u => u.username === username && u.id !== id))
    return res.status(409).json({ error: "Nom d'utilisateur déjà utilisé" });

  if (password && !isValidPassword(password))
    return res.status(400).json({ error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères` });

  let nextRole = target.role;
  if (role && (req.user.role === 'admin' || req.user.role === 'superadmin')) {
    if (!rolesAssignableBy(req.user.role).includes(role))
      return res.status(403).json({ error: 'Rôle non autorisé' });
    nextRole = role;
  }

  if (username)    target.username    = username;
  if (password)    target.password    = bcrypt.hashSync(password, 10);
  if (displayName) target.displayName = displayName;
  target.role = nextRole;

  saveUsers(users);
  res.json({ success: true });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  if (req.user.id === id) return res.status(400).json({ error: 'Impossible de supprimer votre propre compte' });

  let users = loadUsers();
  const target = users.find(u => u.id === id);
  if (!target) return res.status(404).json({ error: 'Utilisateur non trouvé' });

  if (target.role === 'superadmin') {
    // Un admin (non-superadmin) ne peut pas supprimer un compte superadmin.
    if (req.user.role !== 'superadmin')
      return res.status(403).json({ error: 'Accès refusé' });
    const remainingSuperadmins = users.filter(u => u.role === 'superadmin' && u.id !== id).length;
    if (remainingSuperadmins === 0)
      return res.status(400).json({ error: 'Impossible de supprimer le dernier compte superadmin' });
  }

  users = users.filter(u => u.id !== id);
  saveUsers(users);
  res.json({ success: true });
});

// === SERVICES ROUTES ===

app.get('/api/services', requireAuth, (req, res) => {
  res.json(loadServices());
});

app.post('/api/services', requireAuth, (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });
  const { name, tag, desc, url, network, port, icon } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Nom et URL requis' });
  const services = loadServices();
  const newSvc = {
    id: 'svc_' + Date.now(), name,
    tag: tag || '', desc: desc || '', url,
    network: network || '', port: parseInt(port) || 0, icon: icon || '📱'
  };
  services.push(newSvc);
  saveServices(services);
  res.json({ success: true, service: newSvc });
});

app.put('/api/services/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });
  const services = loadServices();
  const idx = services.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Service non trouvé' });
  const { name, tag, desc, url, network, port, icon } = req.body;
  if (name !== undefined)    services[idx].name    = name;
  if (tag !== undefined)     services[idx].tag     = tag;
  if (desc !== undefined)    services[idx].desc    = desc;
  if (url !== undefined)     services[idx].url     = url;
  if (network !== undefined) services[idx].network = network;
  if (port !== undefined)    services[idx].port    = parseInt(port) || 0;
  if (icon !== undefined)    services[idx].icon    = icon;
  saveServices(services);
  res.json({ success: true });
});

app.delete('/api/services/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });
  let services = loadServices();
  const before = services.length;
  services = services.filter(s => s.id !== req.params.id);
  if (services.length === before) return res.status(404).json({ error: 'Service non trouvé' });
  saveServices(services);
  res.json({ success: true });
});

// === SPA FALLBACK ===
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.listen(PORT, () => console.log(`Talixman Portal running on port ${PORT}`));