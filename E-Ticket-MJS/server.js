'use strict';
// Contrôle de la version de Node.js AVANT de charger quoi que ce soit (node:sqlite exige 22.13 ou plus récent).
{
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 13)) {
    console.error(`\nERREUR : Node.js ${process.versions.node} est trop ancien. E-Ticket demande Node.js 22.13 ou plus récent.\n` +
      `Installez-le depuis https://nodejs.org (version LTS), puis relancez. Vérifiez avec : node -v\n`);
    process.exit(1);
  }
}
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Chargement minimal de .env (sans dépendance)
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (_) {}

const store = require('./db');
const providers = require('./providers');
const sms = require('./sms');
const sports = require('./sports');
const { HttpError } = store;

let PORT = +process.env.PORT || 3000;
const PORT_EXPLICIT = !!process.env.PORT;
const BASE_URL_EXPLICIT = !!process.env.BASE_URL;
let BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ORDER_TTL_MS = (+process.env.ORDER_TTL_MIN || 15) * 60000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const maskPhone = p => p.slice(0, 2) + '****' + p.slice(-2);

// ---- Utilitaires HTTP -------------------------------------------------------
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readRaw(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Requête trop volumineuse.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}
function readBody(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Requête trop volumineuse.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      const ct = req.headers['content-type'] || '';
      try {
        if (ct.includes('application/x-www-form-urlencoded')) return resolve(Object.fromEntries(new URLSearchParams(raw)));
        resolve(JSON.parse(raw));
      } catch (_) { reject(new HttpError(400, 'Corps de requête invalide.')); }
    });
    req.on('error', reject);
  });
}
const clientIp = req => (process.env.TRUST_PROXY === '1' && (req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';

// Clés PAR DÉFAUT, uniquement hors production et seulement si rien n'est défini (.env ou environnement).
// En production elles ne s'appliquent jamais et le serveur refuse de démarrer si elles sont utilisées.
// Fichier de clés partagé par TOUS les modes de lancement (demarrer.bat, npm start, live_server.py) : si cles-acces.json existe et qu'aucune clé n'est
// définie par ailleurs, ce sont ces clés (celles de cles-acces.txt) qui s'appliquent — les clés « par défaut » ci-dessous ne servent alors plus.
// KEYS_FILE=none désactive cette lecture ; KEYS_FILE=chemin en choisit un autre. Jamais lu en production (les clés y viennent de .env).
let KEYS_FROM_FILE = '';
if (process.env.NODE_ENV !== 'production' && !process.env.ADMIN_KEY && !process.env.CONTROL_KEY && process.env.KEYS_FILE !== 'none') {
  const kf = process.env.KEYS_FILE || path.join(__dirname, 'cles-acces.json');
  if (fs.existsSync(kf)) {
    try {
      const k = JSON.parse(fs.readFileSync(kf, 'utf8')), cl = n => String(n).replace(/[,=]/g, ' ');
      const adm = (Array.isArray(k.admin) ? k.admin : [k.admin]).filter(Boolean), ctl = Object.entries(k.controle || {});
      if (adm.length) process.env.ADMIN_KEY = adm.map((x, i) => (adm.length > 1 ? `Administration ${i + 1}=` : 'Administration=') + x).join(',');
      if (ctl.length) process.env.CONTROL_KEY = ctl.map(([n, v]) => `${cl(n)}=${v}`).join(',');
      KEYS_FROM_FILE = kf;
    } catch (e) { console.error('[clés] fichier illisible (' + kf + ') : ' + e.message + ' — clés par défaut utilisées.'); }
  }
}
const DEV_KEYS = { ADMIN_KEY: 'admin-eticket-2026', CONTROL_KEY: 'controle-eticket-2026' };
if (process.env.NODE_ENV !== 'production') for (const k of Object.keys(DEV_KEYS)) if (!process.env[k]) process.env[k] = DEV_KEYS[k];
// Base « personnel » : les clés fournies au démarrage (ADMIN_KEY / CONTROL_KEY, syntaxe « clé » ou « Nom=clé ») deviennent des comptes ; seules leurs empreintes sont stockées.
store.syncStaffFromEnv(process.env.ADMIN_KEY, process.env.CONTROL_KEY);

// Limiteur simple en mémoire
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const t = Date.now(), arr = (hits.get(key) || []).filter(x => t - x < windowMs);
  if (arr.length >= max) throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
  arr.push(t); hits.set(key, arr);
}
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (!v.some(x => t - x < 3600000)) hits.delete(k); }, 600000).unref();

// Authentification du personnel : la clé présentée est comparée (par empreinte) aux comptes actifs de la base « personnel ».
// Une clé révoquée cesse de fonctionner immédiatement. Le compte trouvé est mémorisé sur la requête (req.staff).
function requireRole(req, roles) {
  if (!store.staffCount()) throw new HttpError(503, 'Aucun compte du personnel configuré (ADMIN_KEY / CONTROL_KEY).');
  const st = store.staffByKey(String(req.headers['x-api-key'] || ''));
  if (!st || !roles.includes(st.role)) {
    const bad = rateLimitKey => { rateLimit(rateLimitKey, 20, 600000); };
    bad('badkey:' + clientIp(req));
    if (!st) { try { store.staffFailed(clientIp(req)); } catch (_) {} }
    throw new HttpError(401, 'Clé invalide.');
  }
  req.staff = st;
  return st;
}
const requireAdmin = req => requireRole(req, ['admin']);
const requireControl = req => requireRole(req, ['admin', 'control']);   // une clé « contrôle » ne donne jamais accès à l'administration
// L'acteur journalisé est le NOM du compte (une clé par personne ou par poste permet de savoir qui agit) + l'empreinte courte de la clé.
const actorOf = req => (req.staff ? req.staff.nom + ' · ' : '') + 'clé ' + crypto.createHash('sha256').update(String(req.headers['x-api-key'] || '')).digest('hex').slice(0, 8);

function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('00223')) d = d.slice(5); else if (d.startsWith('223') && d.length === 11) d = d.slice(3);
  if (!/^\d{8}$/.test(d)) throw new HttpError(400, 'Numéro de téléphone invalide (8 chiffres attendus).');
  return d;
}
const int = (v, min, max, label) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} invalide.`);
  return n;
};

// ---- Vue publique d'une commande -------------------------------------------
function orderView(o, withTickets) {
  const info = store.eventAndTribune(o);
  return {
    ref: o.ref, status: o.status, qty: o.qty, total: o.total, operator: o.operator, phone: maskPhone(o.phone),
    createdAt: o.created_at, expiresAt: o.created_at + ORDER_TTL_MS,
    event: { id: info.event_id, titre: info.titre, adv: info.adv, date: info.date, lieu: info.lieu, heureConfirmee: !!info.heure_confirmee }, tribune: info.tribune,
    tickets: withTickets && o.status === 'PAID' ? store.ticketsOf(o.id).map(t => ({ code: t.code, status: t.status })) : []
  };
}

// Interroge le fournisseur et applique le résultat (appelé par le webhook ET par le polling du navigateur).
async function refreshOrder(o, force) {
  if (o.status !== 'PENDING' && o.status !== 'EXPIRED' && o.status !== 'FAILED') return o;
  if (o.status !== 'PENDING' && !force) return o;
  const p = providers.get(o.operator);
  if (!p) return o;
  const t = Date.now();
  if (!force && t - o.last_check < 4000) return o;
  store.db.prepare('UPDATE orders SET last_check=? WHERE id=?').run(t, o.id);
  const s = await p.checkStatus(o);
  if (s === 'PENDING') return o;
  return store.settle(o.ref, s, s === 'SUCCESS' ? (o.provider_txn || o.provider_ref) : null);
}

// ---- Journal d'activité et temps réel ----------------------------------------------------------
const deviceOf = req => /Mobi|Android|iPhone|iPad/i.test(req.headers['user-agent'] || '') ? 'mobile' : 'ordinateur';
const sidOf = req => String(req.headers['x-session'] || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
function track(req, o) { try { store.logActivity({ actor: 'visiteur', role: 'public', session: sidOf(req), device: deviceOf(req), ...o }); } catch (e) { console.error('[activité]', e.message); } }
const TRACKABLE = new Set(['page.view', 'event.view', 'sport.filter', 'cart.add', 'checkout.open', 'checkout.cancel', 'tickets.view']);
const streams = new Set();
store.bus.on('change', msg => {
  for (const c of streams) {
    if (c.scope === 'public' && msg.scope !== 'public') continue;
    if (c.scope === 'public' && msg.type !== 'events') continue;
    c.res.write(`id: ${++seq}\ndata: ${JSON.stringify(msg)}\n\n`);
  }
});
let seq = 0;
setInterval(() => { for (const c of streams) c.res.write(': ping\n\n'); }, 20000).unref();
function openStream(req, res, scope) {
  if (streams.size >= 1000) throw new HttpError(503, 'Trop de connexions en temps réel.');
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\ndata: {"type":"hello"}\n\n');
  const c = { res, scope }; streams.add(c);
  req.on('close', () => streams.delete(c));
}

// ---- Routes ----------------------------------------------------------------
async function handle(req, res, url) {
  const m = req.method, p = url.pathname;
  let r;

  // En production, un seul nom de domaine : le retour de paiement et le navigateur (localStorage) doivent partager la même origine.
  if (process.env.NODE_ENV === 'production' && p !== '/healthz' && !p.startsWith('/api/webhooks/')) {
    const canon = new URL(BASE_URL).host;
    if (req.headers.host && req.headers.host !== canon) return send(res, 301, '', { Location: BASE_URL + req.url });
  }

  if (m === 'GET' && p === '/api/config') {
    return send(res, 200, { operators: providers.list(), ttlMin: ORDER_TTL_MS / 60000, demo: providers.list().some(o => o.mode === 'mock'), recovery: sms.available(), legalValidated: process.env.LEGAL_VALIDATED === '1', sports: sports.withImages() });
  }
  if (m === 'GET' && p === '/api/sports') return send(res, 200, sports.withImages());
  if (m === 'GET' && p === '/api/events') {
    return send(res, 200, store.listEvents());
  }
  if (m === 'POST' && p === '/api/orders') {
    const b = await readBody(req);
    const ip = clientIp(req);
    rateLimit('ord:' + ip, +process.env.RATE_ORDERS_PER_10MIN || 100, 600000);
    const operator = String(b.operator || '');
    const prov = providers.get(operator);
    if (!prov || !prov.enabled()) throw new HttpError(400, "Cet opérateur n'est pas disponible pour le moment.");
    const phone = normPhone(b.phone);
    rateLimit('tel:' + phone, 5, 600000);
    const { order, token } = store.createOrder({
      eventId: int(b.eventId, 1, 1e9, 'Événement'), tribuneId: int(b.tribuneId, 1, 1e9, 'Tribune'),
      qty: int(b.qty, 1, 6, 'Quantité'), operator, phone
    });
    try {
      const out = await prov.initiate(order, {
        base: BASE_URL, ret: `${BASE_URL}/?order=${order.ref}`, cancel: `${BASE_URL}/?order=${order.ref}&cancel=1`,
        notif: `${BASE_URL}/api/webhooks/${operator}`
      });
      store.setProviderInfo(order.ref, out);
      return send(res, 201, { ref: order.ref, token, payUrl: out.payUrl, expiresAt: order.created_at + ORDER_TTL_MS });
    } catch (e) {
      store.settle(order.ref, 'FAILED');          // libère les places réservées
      console.error('[paiement] initiate échoué', order.ref, e.message);
      throw new HttpError(502, "Le service de paiement ne répond pas. Réessayez dans un instant.");
    }
  }
  if (m === 'GET' && (r = p.match(/^\/api\/orders\/(CMD-[A-Z0-9]{8})$/))) {
    let o = store.getOrder(r[1]);
    if (!o || !store.checkToken(o, url.searchParams.get('token'))) throw new HttpError(404, 'Commande introuvable.');
    o = await refreshOrder(o, false).catch(e => { console.error('[paiement] statut', e.message); return o; });
    return send(res, 200, orderView(o, true));
  }
  if (p === '/api/webhooks/cinetpay') {
    if (m === 'GET') return send(res, 200, { ok: true });            // CinetPay teste la disponibilité de l'adresse en GET
    if (m === 'POST') {
      const b = await readBody(req);
      const ref = String(b.cpm_trans_id || '');
      const o = /^CMD-[A-Z0-9]{8}$/.test(ref) ? store.getOrder(ref) : null;
      // La notification n'est jamais crue : on interroge CinetPay (check) puis on applique le résultat (idempotent).
      if (o && o.operator === 'cinetpay') await refreshOrder(o, true).catch(e => console.error('[webhook cinetpay]', e.message));
      return send(res, 200, { ok: true });
    }
  }
  if (m === 'POST' && p === '/api/cart/quote') {
    // Le navigateur envoie son panier ; le SERVEUR calcule le montant (le prix envoyé par le client n'est jamais utilisé).
    const b = await readBody(req);
    rateLimit('quote:' + clientIp(req), 120, 600000);
    const row = store.db.prepare('SELECT t.id tid,t.nom,t.prix,t.stock,e.id eid,e.titre,e.date FROM tribunes t JOIN events e ON e.id=t.event_id WHERE t.id=? AND e.id=?')
      .get(int(b.tribuneId, 1, 1e9, 'Tribune'), int(b.eventId, 1, 1e9, 'Événement'));
    if (!row) throw new HttpError(404, 'Tribune ou événement introuvable.');
    const qty = int(b.qty, 1, 6, 'Quantité');
    return send(res, 200, { eventId: row.eid, tribuneId: row.tid, titre: row.titre, tribune: row.nom, qty, unit: row.prix, amount: row.prix * qty,
      currency: 'XOF', available: row.stock >= qty, ttlMin: ORDER_TTL_MS / 60000, payable: (row.prix * qty) % 5 === 0 });
  }
  if (m === 'POST' && (r = p.match(/^\/api\/webhooks\/(orange|moov)$/))) {
    // Moov impose de n'accepter le callback que de la passerelle Moov (IP enregistrées) ; Orange : jeton de notification.
    if (r[1] === 'moov') {
      const allowed = (process.env.MOOV_CALLBACK_IPS || '').split(',').map(x => x.trim()).filter(Boolean);
      const ip = clientIp(req).replace(/^::ffff:/, '');
      if (allowed.length && !allowed.includes(ip)) { console.error('[webhook moov] IP refusée', ip); throw new HttpError(403, 'Adresse non autorisée.'); }
    }
    const raw = await readRaw(req);
    let o = null;
    if (r[1] === 'moov') { const n = require('./providers/moov').parseNotification(raw); o = /^CMD-[A-Z0-9]{8}$/.test(n.referenceId || '') ? store.getOrder(n.referenceId) : null; }
    else { let b = {}; try { b = JSON.parse(raw || '{}'); } catch (_) { try { b = Object.fromEntries(new URLSearchParams(raw)); } catch (_2) {} } const nt = String(b.notif_token || ''); o = nt ? store.getOrderByNotif(nt) : null; }
    // On ne fait pas confiance au contenu du webhook : on revérifie auprès de l'opérateur (statut + montant).
    if (o && o.operator === r[1]) await refreshOrder(o, true).catch(e => console.error('[webhook]', e.message));
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('OK');
  }
  if (m === 'POST' && p === '/api/support') {
    const b = await readBody(req);
    const msg = String(b.message || '').trim().slice(0, 1000);
    if (!msg) throw new HttpError(400, 'Message vide.');
    rateLimit('sup:' + clientIp(req), 5, 3600000);
    store.db.prepare('INSERT INTO support(phone,message,created_at) VALUES(?,?,?)').run(String(b.phone || '').slice(0, 20), msg, Date.now());
    track(req, { action: 'support.send', detail: 'message de ' + (String(b.phone || '').replace(/\d(?=\d{2})/g, '*') || 'anonyme') });
    store.bus.emit('change', { scope: 'staff', type: 'sync', what: 'support' });
    return send(res, 201, { ok: true });
  }

  // Connexion unique du personnel (menu du site) : indique le rôle de la clé, sans rien modifier.
  if (m === 'POST' && p === '/api/staff/login') {
    const body = await readBody(req); const key = String((body && body.key) || '');
    rateLimit('staff:' + clientIp(req), 20, 600000);
    const st = key ? store.staffByKey(key) : null;
    if (st) { store.staffLogin(st, clientIp(req)); track(req, { actor: st.nom, role: st.role, action: 'staff.login', detail: 'connexion ' + (st.role === 'admin' ? 'administrateur' : 'contrôle') }); return send(res, 200, { role: st.role, nom: st.nom }); }
    store.staffFailed(clientIp(req));
    track(req, { actor: 'inconnu', role: 'public', action: 'staff.login_failed', detail: 'clé incorrecte' });
    throw new HttpError(401, 'Clé incorrecte.');
  }
  if (m === 'GET' && p === '/healthz') {
    store.db.prepare('SELECT 1').get();
    return send(res, 200, { ok: true, app: 'E-Ticket Mali' });
  }

  // Récupération des billets sur un autre appareil : code par SMS
  if (m === 'POST' && p === '/api/recover/request') {
    const b = await readBody(req);
    const phone = normPhone(b.phone);
    if (!sms.available()) throw new HttpError(503, "La récupération par SMS n'est pas disponible pour le moment.");
    rateLimit('otpip:' + clientIp(req), 5, 600000);
    rateLimit('otpc:' + phone, 1, 60000);       // 1 SMS / minute / numéro
    rateLimit('otph:' + phone, 5, 3600000);     // 5 SMS / heure / numéro
    // Réponse identique que le numéro ait des commandes ou non (pas de fuite d'information)
    track(req, { action: 'recover.request', target: maskPhone(phone) });
    if (store.hasOrders(phone)) {
      const code = store.createOtp(phone);
      sms.send(phone, `E-Ticket Mali : votre code est ${code}. Valable 10 minutes. Ne le communiquez à personne.`)
        .catch(e => console.error('[sms] échec envoi', e.message));
    }
    return send(res, 200, { ok: true, message: 'Si des billets existent pour ce numéro, un code vient de lui être envoyé par SMS.' });
  }
  if (m === 'POST' && p === '/api/recover/verify') {
    const b = await readBody(req);
    const phone = normPhone(b.phone);
    rateLimit('otpv:' + clientIp(req), 20, 600000);
    const out = store.verifyOtp(phone, String(b.code || '').replace(/\D/g, ''));
    track(req, { action: out ? 'recover.ok' : 'recover.failed', target: maskPhone(phone) });
    if (!out) throw new HttpError(400, 'Code invalide ou expiré.');
    return send(res, 200, out);
  }
  if (m === 'GET' && p === '/api/my/orders') {
    const auth = String(req.headers.authorization || '');
    const phone = store.sessionPhone(auth.startsWith('Bearer ') ? auth.slice(7) : '');
    if (!phone) throw new HttpError(401, 'Session expirée. Demandez un nouveau code.');
    return send(res, 200, store.ordersByPhone(phone).map(o => orderView(o, true)));
  }

  // Page de simulation (mock uniquement)
  if ((r = p.match(/^\/sandbox\/pay\/(CMD-[A-Z0-9]{8})(\/(ok|fail))?$/))) {
    const o = store.getOrder(r[1]);
    if (!o || providers.modeOf(o.operator) !== 'mock') throw new HttpError(404, 'Introuvable.');
    if (m === 'POST' && r[3]) {
      if (o.status === 'PENDING') {
        store.db.prepare('UPDATE orders SET provider_status=? WHERE id=?').run(r[3] === 'ok' ? 'SUCCESS' : 'FAILED', o.id);
        await refreshOrder(store.getOrder(o.ref), true);
      }
      return send(res, 302, '', { Location: `/?order=${o.ref}` });
    }
    if (m === 'GET') {
      return send(res, 200, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paiement simulé</title>
<body style="font-family:system-ui;max-width:420px;margin:40px auto;padding:0 16px"><div style="background:#fff7d6;border:1px solid #ecd978;padding:8px 12px;border-radius:8px;font-size:.85rem">Page de SIMULATION — aucun argent n'est débité.</div>
<h2>${esc(o.operator === 'orange' ? 'Orange Money' : 'Moov Money')}</h2><p>Commande <b>${esc(o.ref)}</b><br>Montant : <b>${o.total.toLocaleString('fr-FR')} FCFA</b><br>Numéro : ${esc(maskPhone(o.phone))}</p>
<form method="post" action="/sandbox/pay/${esc(o.ref)}/ok" style="margin-bottom:10px"><button style="width:100%;padding:12px;border:0;border-radius:10px;background:#0a8f3c;color:#fff;font-weight:700">Simuler un paiement réussi</button></form>
<form method="post" action="/sandbox/pay/${esc(o.ref)}/fail"><button style="width:100%;padding:12px;border-radius:10px;border:1px solid #ccc;background:#fff">Simuler un échec</button></form></body>`);
    }
  }

  // Administration / contrôle d'accès
  if (m === 'POST' && p === '/api/admin/validate') {
    requireControl(req);
    const b = await readBody(req);
    const code = String(b.code || '').trim().toUpperCase();
    if (!/^ML-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return send(res, 200, { result: 'invalid' });
    return send(res, 200, store.validateTicket(code, b.eventId ? int(b.eventId, 1, 1e9, 'Événement') : null, b.consume !== false, req.staff));
  }
  // Personnel (base relationnelle dédiée) et inventaire des bases
  if (m === 'GET' && p === '/api/admin/staff') { requireAdmin(req); return send(res, 200, { staff: store.listStaff(), log: store.staffLogList(60) }); }
  if (m === 'POST' && p === '/api/admin/staff') {
    requireAdmin(req);
    const b = await readBody(req);
    const nom = String(b.nom || '').trim().slice(0, 60), poste = String(b.poste || '').trim().slice(0, 60);
    if (nom.length < 2) throw new HttpError(400, 'Nom obligatoire (2 caractères minimum).');
    if (!['admin', 'control'].includes(b.role)) throw new HttpError(400, 'Rôle invalide (admin ou control).');
    const r = store.createStaff({ nom, role: b.role, poste, by: req.staff.nom });
    store.audit(actorOf(req), 'staff.create', nom, `rôle ${b.role}${poste ? ' · poste ' + poste : ''}`);
    return send(res, 201, r);     // la clé n'est renvoyée qu'ici, une seule fois
  }
  if (m === 'POST' && (r = p.match(/^\/api\/admin\/staff\/(\d+)\/revoke$/))) {
    requireAdmin(req);
    store.revokeStaff(+r[1], req.staff.id);
    store.audit(actorOf(req), 'staff.revoke', '#' + r[1], 'compte révoqué');
    return send(res, 200, { ok: true });
  }
  if (m === 'GET' && p === '/api/admin/databases') { requireAdmin(req); return send(res, 200, store.databases()); }
  if (m === 'GET' && p === '/api/admin/stats') {
    requireAdmin(req);
    return send(res, 200, store.stats());
  }
  const cleanTribunes = arr => arr.map(t => ({ nom: String(t.nom || '').trim().slice(0, 60) || (() => { throw new HttpError(400, 'Nom de tribune requis.'); })(), prix: int(t.prix, 100, 1e7, 'Prix'), stock: int(t.stock, 0, 1e6, 'Stock') }));
  if (m === 'POST' && p === '/api/admin/events') {
    requireAdmin(req);
    const b = await readBody(req, 50000);
    for (const k of ['type', 'titre', 'date', 'lieu']) if (!String(b[k] || '').trim()) throw new HttpError(400, `Champ « ${k} » requis.`);
    if (isNaN(new Date(b.date))) throw new HttpError(400, 'Date invalide.');
    const tribunes = Array.isArray(b.tribunes) ? cleanTribunes(b.tribunes) : [];
    if (b.sport && !sports.resolve(b.sport)) throw new HttpError(400, 'Sport inconnu.');
    const sport = sports.resolve(b.sport) || sports.resolve(b.type);
    const id = store.createEvent({ type: String(b.type).slice(0, 30), sport, titre: String(b.titre).slice(0, 100), adv: String(b.adv || '').slice(0, 100), date: String(b.date), lieu: String(b.lieu).slice(0, 100), tribunes, heureConfirmee: b.heureConfirmee !== false });
    store.audit(actorOf(req), 'event.create', '#' + id, `${b.titre} · ${b.date} · ${tribunes.length} tribune(s)`);
    return send(res, 201, { id });
  }
  if (m === 'POST' && (r = p.match(/^\/api\/admin\/events\/(\d+)$/))) {        // modifier un événement (date, lieu, heure confirmée…)
    requireAdmin(req);
    const b = await readBody(req);
    if (b.date !== undefined && isNaN(new Date(b.date))) throw new HttpError(400, 'Date invalide.');
    const f = {};
    for (const k of ['type', 'titre', 'adv', 'date', 'lieu']) if (b[k] !== undefined) f[k] = String(b[k]).slice(0, 100);
    if (b.sport !== undefined) { f.sport = sports.resolve(b.sport); if (b.sport && !f.sport) throw new HttpError(400, 'Sport inconnu.'); if (f.sport && b.type === undefined) f.type = sports.nom(f.sport); }
    if (b.heureConfirmee !== undefined) f.heureConfirmee = !!b.heureConfirmee;
    store.updateEvent(+r[1], f);
    store.audit(actorOf(req), 'event.update', '#' + r[1], JSON.stringify(f));
    return send(res, 200, { ok: true });
  }
  if (m === 'POST' && (r = p.match(/^\/api\/admin\/events\/(\d+)\/tribunes$/))) {   // ouvrir la billetterie : ajouter des tribunes
    requireAdmin(req);
    const b = await readBody(req);
    if (!Array.isArray(b.tribunes) || !b.tribunes.length) throw new HttpError(400, 'Au moins une tribune est requise.');
    const added = cleanTribunes(b.tribunes);
    store.addTribunes(+r[1], added);
    store.audit(actorOf(req), 'tribune.add', 'événement #' + r[1], added.map(t => `${t.nom} ${t.prix} FCFA × ${t.stock}`).join(' ; '));
    return send(res, 201, { ok: true });
  }
  if (m === 'POST' && (r = p.match(/^\/api\/admin\/tribunes\/(\d+)$/))) {          // changer prix / stock d'une tribune
    requireAdmin(req);
    const b = await readBody(req);
    const before = store.db.prepare('SELECT nom,prix,stock FROM tribunes WHERE id=?').get(+r[1]);
    store.updateTribune(+r[1], { prix: b.prix === undefined ? undefined : int(b.prix, 100, 1e7, 'Prix'), stock: b.stock === undefined ? undefined : int(b.stock, 0, 1e6, 'Stock') });
    const after = store.db.prepare('SELECT prix,stock FROM tribunes WHERE id=?').get(+r[1]);
    store.audit(actorOf(req), 'tribune.update', `${before.nom} (#${r[1]})`, `prix ${before.prix} → ${after.prix} · places ${before.stock} → ${after.stock}`);
    return send(res, 200, { ok: true });
  }

  if (m === 'POST' && p === '/api/track') {
    const b = await readBody(req, 2000);
    rateLimit('trk:' + clientIp(req), 300, 600000);
    const action = String(b.action || '');
    if (!TRACKABLE.has(action)) throw new HttpError(400, 'Action inconnue.');
    track(req, { action, target: String(b.target || '').slice(0, 80), detail: String(b.detail || '').slice(0, 200) });
    return send(res, 204, '');
  }
  if (m === 'GET' && p === '/api/stream') return openStream(req, res, 'public');
  if (m === 'GET' && p === '/api/admin/stream') { requireControl(req); return openStream(req, res, 'staff'); }
  if (m === 'GET' && p === '/api/admin/activity') {
    requireAdmin(req);
    return send(res, 200, { rows: store.activityList({ limit: url.searchParams.get('limit'), role: url.searchParams.get('role') || '', q: url.searchParams.get('q') || '' }), last24h: store.activityStats() });
  }
  if (m === 'GET' && p === '/api/admin/events') { requireAdmin(req); return send(res, 200, store.adminEvents()); }
  if (m === 'GET' && p === '/api/admin/refunds') { requireAdmin(req); return send(res, 200, store.refundsDue()); }
  if (m === 'POST' && (r = p.match(/^\/api\/admin\/orders\/(CMD-[A-Z0-9]{8})\/refunded$/))) { requireAdmin(req); store.markRefunded(r[1]); store.audit(actorOf(req), 'refund.mark', r[1], 'marquée remboursée'); return send(res, 200, { ok: true }); }
  if (m === 'GET' && p === '/api/admin/audit') { requireAdmin(req); return send(res, 200, store.auditList()); }
  if (m === 'GET' && p === '/api/admin/support') { requireAdmin(req); return send(res, 200, store.supportList()); }

  if (p.startsWith('/api/')) throw new HttpError(404, 'Route inconnue.');
  return serveStatic(req, res, p);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json' };
function serveStatic(req, res, p) {
  if (p === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }); return res.end(`User-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /controle.html\nDisallow: /api/\nSitemap: ${BASE_URL}/sitemap.xml\n`); }
  if (p === '/sitemap.xml') { res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }); return res.end('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + ['/', '/conditions.html', '/confidentialite.html'].map(u => `<url><loc>${BASE_URL}${u}</loc></url>`).join('') + '</urlset>'); }
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée.');
  let rel = decodeURIComponent(p);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Accès refusé.');
  fs.readFile(file, (err, data) => {
    if (err) {
      if (/\.(html?)?$/.test(rel) || !path.extname(rel)) return fs.readFile(path.join(PUBLIC_DIR, '404.html'), (e2, pg) => e2 ? send(res, 404, { error: 'Page introuvable.' }) : (res.writeHead(404, { 'Content-Type': MIME['.html'] }), res.end(pg)));
      return send(res, 404, { error: 'Page introuvable.' });
    }
    const ext = path.extname(file), immutable = /^\/(img|vendor)\//.test(p.toLowerCase()) && ext !== '.html';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=86400' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

const server = http.createServer(async (req, res) => {
  // Développement uniquement : autoriser les pages ouvertes directement depuis un fichier (origine « null ») à appeler l'API locale.
  if (process.env.NODE_ENV !== 'production' && /^(null|https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?)$/.test(req.headers.origin || '-')) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, x-session, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (/^https:/.test(BASE_URL)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (/^\/(admin|controle)\.html/.test(req.url)) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  try {
    await handle(req, res, new URL(req.url, 'http://x'));
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error('[erreur]', e);
    send(res, 500, { error: 'Erreur interne.' });
  }
});

// Garde-fous au démarrage en production : on refuse de démarrer plutôt que de tourner en mode dangereux.
function preflight() {
  if (process.env.NODE_ENV !== 'production') return [];
  const errs = [];
  if (!/^https:\/\//.test(process.env.BASE_URL || '')) errs.push('BASE_URL doit être une adresse https:// publique.');
  if ((process.env.ADMIN_KEY || '').length < 24) errs.push('ADMIN_KEY doit faire au moins 24 caractères.');
  if (process.env.CONTROL_KEY && process.env.CONTROL_KEY.length < 16) errs.push('CONTROL_KEY doit faire au moins 16 caractères.');
  for (const k of Object.keys(DEV_KEYS)) if (process.env[k] === DEV_KEYS[k]) errs.push(`${k} utilise la clé par défaut de développement : choisissez-en une secrète.`);
  if (process.env.CONTROL_KEY && process.env.CONTROL_KEY === process.env.ADMIN_KEY) errs.push('CONTROL_KEY doit différer de ADMIN_KEY.');
  for (const o of providers.list()) if (o.mode === 'disabled') errs.push(`${o.nom} : le mode « mock » est interdit en production (passez PROVIDER_${o.id.toUpperCase()}=live ou désactivez l'opérateur avec PROVIDER_${o.id.toUpperCase()}=off).`);
  if (!providers.list().some(o => o.enabled)) errs.push("Aucun opérateur de paiement actif : configurez Orange Money (PROVIDER_ORANGE=live, OM_AUTH_HEADER, OM_MERCHANT_KEY) et/ou Moov Money (PROVIDER_MOOV=live, une fois l'adaptateur complété avec la documentation Moov).");
  if (process.env.LEGAL_VALIDATED !== '1') errs.push("Les conditions de vente et la politique de confidentialité ne sont pas déclarées validées (LEGAL_VALIDATED=1 après validation par le service juridique).");
  for (const f of ['conditions.html', 'confidentialite.html']) {
    try { const n = (fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8').match(/class="todo"/g) || []).length; if (n) errs.push(`public/${f} contient encore ${n} passage(s) à compléter (voir deploy/build-legal.py).`); }
    catch (_) { errs.push(`public/${f} est introuvable.`); }
  }
  return errs;
}

if (require.main === module) {
  const problems = preflight();
  if (problems.length) { console.error('Démarrage refusé :\n - ' + problems.join('\n - ')); process.exit(1); }
  setInterval(() => { for (const o of store.db.prepare("SELECT * FROM orders WHERE status='PENDING' AND operator IN ('orange','moov') AND created_at < ?").all(Date.now() - 120000)) refreshOrder(o, true).catch(e => console.error('[relève]', o.ref, e.message)); }, 60000).unref();   // notification absente sous 120 s : on interroge l'opérateur
  setInterval(() => { try { const n = store.expirePending(ORDER_TTL_MS); if (n) console.log(`[expiration] ${n} commande(s) expirée(s)`); store.purgeExpired(); } catch (e) { console.error(e); } }, 60000).unref();
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { console.log('Arrêt…'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); });
  const announce = () => {
    console.log(`E-Ticket sur ${BASE_URL}`);
    for (const o of providers.list()) console.log(` - ${o.nom}: mode=${o.mode} ${o.enabled ? 'actif' : 'INACTIF'}`);
    if (KEYS_FROM_FILE) console.log(` - Clés d'accès du personnel : lues dans ${path.basename(KEYS_FROM_FILE)} (liste lisible : cles-acces.txt)`);
    if (process.env.ADMIN_KEY === DEV_KEYS.ADMIN_KEY || process.env.CONTROL_KEY === DEV_KEYS.CONTROL_KEY) console.log(` - Clés par défaut (développement) : administrateur « ${DEV_KEYS.ADMIN_KEY} », contrôle « ${DEV_KEYS.CONTROL_KEY} »`);
    if (!process.env.ADMIN_KEY) console.log(' - ADMIN_KEY non défini : administration désactivée');
    if (!process.env.CONTROL_KEY && !process.env.ADMIN_KEY) console.log(' - CONTROL_KEY non défini : contrôle des billets désactivé');
    console.log(` - SMS de récupération : ${sms.available() ? 'actif' : 'INACTIF'}`);
    console.log(`\n>>> Ouvrez ce site dans le navigateur : ${BASE_URL}`);
  };
  // Port déjà pris (cause fréquente de « serveur introuvable ») : en développement et sans PORT imposé, on essaie les ports suivants.
  let tries = 0;
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      if (!PORT_EXPLICIT && process.env.NODE_ENV !== 'production' && tries < 10) {
        tries++; console.log(`Le port ${PORT} est déjà utilisé (un autre E-Ticket tourne peut-être déjà : essayez http://localhost:${PORT}). Essai du port ${PORT + 1}…`);
        PORT++; if (!BASE_URL_EXPLICIT) BASE_URL = `http://localhost:${PORT}`;
        return server.listen(PORT, announce);
      }
      console.error(`ERREUR : le port ${PORT} est déjà utilisé. Fermez l'autre programme (ou l'autre fenêtre E-Ticket), ou choisissez un autre port : PORT=3100 npm start`);
    } else if (err.code === 'EACCES') console.error(`ERREUR : accès refusé au port ${PORT}. Choisissez un port supérieur à 1024 : PORT=3100 npm start`);
    else console.error('ERREUR au démarrage du serveur :', err.message);
    process.exit(1);
  });
  if (process.env.HOST) server.listen(PORT, process.env.HOST, announce); else server.listen(PORT, announce);   // HOST=127.0.0.1 : écoute locale seulement (derrière le serveur HTTPS Python)
}
module.exports = { server };
