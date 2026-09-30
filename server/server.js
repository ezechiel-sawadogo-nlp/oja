#!/usr/bin/env node
// =====================================================================================
// server/server.js — Serveur Ọjà (Node.js, aucune dépendance)
//
//   node server/server.js                      -> http://localhost:3000
//   OJA_PASSWORD=secret node server/server.js  -> protège l'espace vendeuse par mot de passe
//   (ou mettre OJA_PASSWORD=… dans un fichier .env à la racine — voir .env.example)
//   node server/server.js --port 8080 --data /chemin/oja-state.json
//
// Rôle :
//  1. Servir l'interface (index.html et les fichiers du projet) en injectant l'état complet
//     de la boutique dans window.OJA_STATE : le navigateur démarre sans rien charger.
//  2. Exposer l'état par une petite API JSON : GET /api/state, PUT /api/state (lot de clés),
//     GET /api/version, DELETE /api/state. Une seule boutique, un seul fichier JSON, écrit de
//     façon atomique (fichier temporaire puis renommage). Passer à SQLite ou Postgres plus
//     tard = remplacer les trois fonctions load/persist/reset ci-dessous.
//  3. Recevoir les webhooks WhatsApp (GET de vérification + POST) : pour l'instant, on vérifie
//     le jeton et on journalise les messages reçus dans data/whatsapp-inbox.jsonl. Le moteur
//     côté serveur (server/engine.js) est prêt à y être branché — voir docs/WHATSAPP.md.
// =====================================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Fichier .env facultatif à la racine (clé=valeur), pratique sous Windows. Les variables déjà
// définies dans l'environnement gardent la priorité. Aucune dépendance (pas de dotenv).
try {
  fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8').split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  });
} catch { /* pas de .env : rien à faire */ }

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const PORT = Number(arg('--port', process.env.PORT || 3000));
const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.resolve(arg('--data', process.env.OJA_DATA || path.join(__dirname, 'data', 'oja-state.json')));
const INBOX_FILE = path.join(path.dirname(DATA_FILE), 'whatsapp-inbox.jsonl');
const PASSWORD = process.env.OJA_PASSWORD || '';
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || '';
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET || '';
const STATE_KEYS = new Set(['oja-products', 'oja-orders', 'oja-profile', 'oja-escalations', 'oja-categories', 'oja-conversations', 'oja-settings']);
const MAX_BODY = 25 * 1024 * 1024; // photos en dataURL : 25 Mo par requête, large

// ---------- Persistance (un fichier JSON, écriture atomique) ----------
let state = { version: 0, data: {} };
function load() {
  try { state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { state = { version: 0, data: {} }; }
  if (!state.data) state.data = {};
  if (!Number.isFinite(state.version)) state.version = 0;
}
function persist() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, DATA_FILE);
}
function reset() { state = { version: state.version + 1, data: {} }; persist(); }
function applyBatch(batch) {
  Object.entries(batch).forEach(([key, value]) => {
    if (!STATE_KEYS.has(key)) return;
    if (value === null || value === undefined) delete state.data[key]; else state.data[key] = value;
  });
  state.version += 1;
  persist();
}

// ---------- Utilitaires HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.jsonl': 'application/x-ndjson', '.ico': 'image/x-icon' };
function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(payload);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { reject(new Error('Corps trop volumineux')); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Authentification HTTP Basic si OJA_PASSWORD est défini : le navigateur demande le mot de
// passe une fois et le renvoie ensuite. Suffisant pour une boutique ; à remplacer par des
// comptes dès qu'il y a plusieurs vendeuses.
function authorized(req) {
  if (!PASSWORD) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const [, password] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
  const a = Buffer.from(password || ''); const b = Buffer.from(PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Fichiers statiques (index.html reçoit l'état injecté) ----------
// Liste blanche : seuls les fichiers de l'interface sont servis. Jamais server/, les données,
// .env, les tests ni le corpus, quelle que soit l'écriture de l'URL (//, %2F, casse Windows…).
const PUBLIC_FILES = new Set(['index.html', 'styles.css', 'store.js', 'nlu.js', 'dialogue.js', 'conversations.js', 'assistant.js', 'app.js']);
function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html'; } catch { rel = ''; }
  if (!PUBLIC_FILES.has(rel)) return send(res, 404, 'Introuvable', 'text/plain; charset=utf-8');
  const file = path.join(ROOT, rel);
  fs.readFile(file, (error, content) => {
    if (error) return send(res, 404, 'Introuvable', 'text/plain; charset=utf-8');
    const ext = path.extname(file).toLowerCase();
    if (ext === '.html') {
      const injected = `<script>window.OJA_STATE=${JSON.stringify({ version: state.version, data: state.data }).replace(/</g, '\\u003c')};</script>\n    <script src="store.js">`;
      return send(res, 200, content.toString('utf8').replace('<script src="store.js">', injected), MIME[ext]);
    }
    send(res, 200, content, MIME[ext] || 'application/octet-stream', { 'Cache-Control': 'no-cache' });
  });
}

// ---------- Webhook WhatsApp (Cloud API) : vérification + journal des messages reçus ----------
function whatsappVerify(url, res) {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && WHATSAPP_VERIFY_TOKEN && token === WHATSAPP_VERIFY_TOKEN) return send(res, 200, challenge || '', 'text/plain; charset=utf-8');
  send(res, 403, 'Jeton de vérification invalide', 'text/plain; charset=utf-8');
}
// Si WHATSAPP_APP_SECRET est défini, chaque POST doit porter la signature Meta
// (X-Hub-Signature-256 = HMAC-SHA256 du corps avec le secret de l'application).
function validSignature(req, raw) {
  if (!WHATSAPP_APP_SECRET) return true;
  const header = String(req.headers['x-hub-signature-256'] || '');
  const expected = 'sha256=' + crypto.createHmac('sha256', WHATSAPP_APP_SECRET).update(raw, 'utf8').digest('hex');
  const a = Buffer.from(header); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function whatsappReceive(req, res) {
  const raw = await readBody(req);
  if (!validSignature(req, raw)) return send(res, 401, { error: 'Signature invalide' });
  let payload; try { payload = JSON.parse(raw); } catch { return send(res, 400, { error: 'JSON invalide' }); }
  // Format Cloud API : entry[].changes[].value.messages[] ; on garde l'essentiel.
  const messages = [];
  (payload.entry || []).forEach(entry => (entry.changes || []).forEach(change => ((change.value || {}).messages || []).forEach(message => messages.push({ from: message.from, id: message.id, type: message.type, text: message.text ? message.text.text || message.text.body : null, timestamp: message.timestamp, receivedAt: new Date().toISOString() }))));
  fs.mkdirSync(path.dirname(INBOX_FILE), { recursive: true });
  messages.forEach(message => fs.appendFileSync(INBOX_FILE, `${JSON.stringify(message)}\n`));
  console.log(`[whatsapp] ${messages.length} message(s) reçu(s)`);
  send(res, 200, { received: messages.length });
}

// ---------- Routage ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  try {
    if (pathname === '/api/health') return send(res, 200, { ok: true, version: state.version });
    if (pathname === '/api/whatsapp/webhook') return req.method === 'GET' ? whatsappVerify(url, res) : whatsappReceive(req, res);
    if (!authorized(req)) return send(res, 401, 'Mot de passe requis', 'text/plain; charset=utf-8', { 'WWW-Authenticate': 'Basic realm="Oja"' });
    if (pathname === '/api/version') return send(res, 200, { version: state.version });
    if (pathname === '/api/state') {
      if (req.method === 'GET') return send(res, 200, { version: state.version, data: state.data });
      if (req.method === 'PUT' || req.method === 'POST') {
        const raw = await readBody(req);
        let batch; try { batch = JSON.parse(raw); } catch { return send(res, 400, { error: 'JSON invalide' }); }
        if (!batch || typeof batch !== 'object' || Array.isArray(batch)) return send(res, 400, { error: 'Un objet { clé: valeur } est attendu' });
        applyBatch(batch);
        return send(res, 200, { version: state.version });
      }
      if (req.method === 'DELETE') { reset(); return send(res, 200, { version: state.version }); }
      return send(res, 405, { error: 'Méthode non autorisée' });
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Méthode non autorisée' });
    serveStatic(req, res, pathname);
  } catch (error) {
    console.error(error);
    send(res, 500, { error: error.message });
  }
});

load();
server.listen(PORT, () => {
  console.log(`Ọjà — serveur prêt sur http://localhost:${PORT}`);
  console.log(`  données : ${DATA_FILE}`);
  console.log(`  mot de passe : ${PASSWORD ? 'activé' : 'désactivé (définir OJA_PASSWORD)'}`);
  console.log(`  webhook WhatsApp : /api/whatsapp/webhook ${WHATSAPP_VERIFY_TOKEN ? '(jeton défini)' : '(définir WHATSAPP_VERIFY_TOKEN)'}`);
});
