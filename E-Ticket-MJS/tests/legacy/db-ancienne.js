'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'data.sqlite'));
db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL, titre TEXT NOT NULL, adv TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL, lieu TEXT NOT NULL, grad TEXT NOT NULL DEFAULT '',
  heure_confirmee INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS tribunes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  nom TEXT NOT NULL, prix INTEGER NOT NULL CHECK(prix>0), stock INTEGER NOT NULL CHECK(stock>=0)
);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  event_id INTEGER NOT NULL REFERENCES events(id),
  tribune_id INTEGER NOT NULL REFERENCES tribunes(id),
  qty INTEGER NOT NULL, total INTEGER NOT NULL,
  operator TEXT NOT NULL, phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',      -- PENDING PAID FAILED EXPIRED REFUND_DUE
  provider_ref TEXT, notif_token TEXT, provider_status TEXT,
  provider_txn TEXT, last_check INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_notif ON orders(notif_token);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
CREATE TABLE IF NOT EXISTS tickets(
  code TEXT PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  status TEXT NOT NULL DEFAULT 'VALID',        -- VALID USED
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS otp(
  phone TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, phone TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT ''
);
CREATE TRIGGER IF NOT EXISTS admin_log_no_update BEFORE UPDATE ON admin_log BEGIN SELECT RAISE(ABORT, 'journal en lecture seule'); END;
CREATE TRIGGER IF NOT EXISTS admin_log_no_delete BEFORE DELETE ON admin_log BEGIN SELECT RAISE(ABORT, 'journal en lecture seule'); END;
CREATE TABLE IF NOT EXISTS support(
  id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, message TEXT NOT NULL, created_at INTEGER NOT NULL
);
`);

try { db.exec('ALTER TABLE events ADD COLUMN heure_confirmee INTEGER NOT NULL DEFAULT 1'); } catch (_) {}
try { db.exec("ALTER TABLE events ADD COLUMN sport TEXT NOT NULL DEFAULT ''"); } catch (_) {}
// Journal d'activité de TOUS les utilisateurs (public, contrôle, administration) : lecture seule côté application, comme admin_log.
db.exec(`
CREATE TABLE IF NOT EXISTS activity_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, role TEXT NOT NULL,
  action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '', session TEXT NOT NULL DEFAULT '', device TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_activity_at ON activity_log(at);
CREATE TRIGGER IF NOT EXISTS activity_no_update BEFORE UPDATE ON activity_log BEGIN SELECT RAISE(ABORT, 'journal en lecture seule'); END;
CREATE TRIGGER IF NOT EXISTS activity_no_delete BEFORE DELETE ON activity_log BEGIN SELECT RAISE(ABORT, 'journal en lecture seule'); END;
`);
{ const { resolve } = require('./sports'); for (const e of db.prepare("SELECT id,type FROM events WHERE sport=''").all()) { const sp = resolve(e.type); if (sp) db.prepare('UPDATE events SET sport=? WHERE id=?').run(sp, e.id); } }

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
}

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const now = () => Date.now();
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function rand(n) {
  const b = crypto.randomBytes(n); let s = '';
  for (let i = 0; i < n; i++) s += ALPHA[b[i] % ALPHA.length];
  return s;
}
const newRef = () => 'CMD-' + rand(8);
const newTicketCode = () => 'ML-' + rand(4) + '-' + rand(4) + '-' + rand(4);

function seed() {
  if (process.env.NODE_ENV === 'production') return;   // jamais de données de démonstration en production
  if (db.prepare('SELECT COUNT(*) c FROM events').get().c) return;
  const ev = db.prepare('INSERT INTO events(type,titre,adv,date,lieu,grad,sport) VALUES(?,?,?,?,?,?,?)');
  const tr = db.prepare('INSERT INTO tribunes(event_id,nom,prix,stock) VALUES(?,?,?,?)');
  const data = [
    ['Football', 'Aigles du Mali', 'Match de qualification', '2026-12-12T17:00', 'Stade du 26 Mars, Bamako', 'linear-gradient(160deg,#0a8f3c,#064d20 70%,#fcd116 160%)',
      [['Pelouse populaire', 1000, 1800], ['Tribune latérale', 3000, 600], ["Tribune d'honneur", 10000, 120]]],
    ['Football', 'Finale Coupe du Mali', 'Édition nationale', '2026-12-20T16:00', 'Stade Modibo Keïta, Bamako', 'linear-gradient(160deg,#ce1126,#6b0a16 75%)',
      [['Pelouse populaire', 1000, 2400], ['Tribune latérale', 2500, 900], ["Tribune d'honneur", 8000, 0]]],
    ['Basketball', 'Championnat national', 'Journée de basketball', '2026-11-28T18:00', 'Palais des Sports, Bamako', 'linear-gradient(160deg,#e08600,#7a3b00 80%)',
      [['Gradins', 1000, 700], ['Tribune centrale', 3000, 150]]],
    ['Athlétisme', "Meeting national d'athlétisme", 'Jeunesse & Sports', '2027-01-09T09:00', 'Stade du 26 Mars, Bamako', 'linear-gradient(160deg,#1769aa,#0b2f52 80%)',
      [['Entrée générale', 500, 3000], ['Tribune couverte', 2000, 400]]],
    ['Culture', 'Nuit de la Jeunesse', 'Concerts & animations', '2027-01-23T20:00', 'Palais de la Culture, Bamako', 'linear-gradient(160deg,#7b2cbf,#3a0f66 80%)',
      [['Entrée simple', 2000, 1500], ['Carré VIP', 10000, 100]]]
  ];
  tx(() => { for (const d of data) { const id = ev.run(d[0], d[1], d[2], d[3], d[4], d[5], require('./sports').resolve(d[0])).lastInsertRowid; for (const t of d[6]) tr.run(id, t[0], t[1], t[2]); } });
}
if (process.env.SEED !== '0') seed();

// ---- Logique métier --------------------------------------------------------
function listEvents() {
  const evs = db.prepare('SELECT * FROM events ORDER BY date').all().filter(e => new Date(e.date).getTime() > now() - 3 * 3600000);
  const trs = db.prepare('SELECT id,event_id,nom,prix,stock FROM tribunes ORDER BY prix').all();
  return evs.map(e => ({ ...e, tribunes: trs.filter(t => t.event_id === e.id) }));
}

function createOrder({ eventId, tribuneId, qty, operator, phone }) {
  const token = crypto.randomBytes(24).toString('hex');
  const ref = newRef();
  const order = tx(() => {
    const t = db.prepare('SELECT t.id,t.prix,e.date FROM tribunes t JOIN events e ON e.id=t.event_id WHERE t.id=? AND t.event_id=?').get(tribuneId, eventId);
    if (!t) throw new HttpError(404, 'Tribune ou événement introuvable.');
    if (new Date(t.date).getTime() < now()) throw new HttpError(400, 'Cet événement est déjà passé.');
    const r = db.prepare('UPDATE tribunes SET stock=stock-? WHERE id=? AND stock>=?').run(qty, tribuneId, qty);
    if (r.changes === 0) throw new HttpError(409, "Il ne reste plus assez de places dans cette tribune.");
    const total = t.prix * qty, ts = now();
    db.prepare('INSERT INTO orders(ref,token_hash,event_id,tribune_id,qty,total,operator,phone,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(ref, sha(token), eventId, tribuneId, qty, total, operator, phone, ts, ts);
    return getOrder(ref);
  });
  return { order, token };
}

const getOrder = ref => db.prepare('SELECT * FROM orders WHERE ref=?').get(ref);
const getOrderByNotif = nt => db.prepare('SELECT * FROM orders WHERE notif_token=?').get(nt);

function checkToken(order, token) {
  if (!order || typeof token !== 'string') return false;
  const a = Buffer.from(sha(token)), b = Buffer.from(order.token_hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function setProviderInfo(ref, { providerRef, notifToken }) {
  db.prepare('UPDATE orders SET provider_ref=?, notif_token=?, updated_at=? WHERE ref=?').run(providerRef || null, notifToken || null, now(), ref);
}

// Applique un état final du fournisseur. Idempotent : un paiement n'est traité qu'une fois.
function settle(ref, providerStatus, txn) {
  return tx(() => {
    const o = getOrder(ref);
    if (!o) return null;
    const ts = now();
    if (providerStatus === 'SUCCESS') {
      if (o.status === 'PAID' || o.status === 'REFUND_DUE') return o;
      if (o.status !== 'PENDING') {
        // Paiement reçu après expiration/échec : on tente de re-réserver les places, sinon remboursement dû.
        const r = db.prepare('UPDATE tribunes SET stock=stock-? WHERE id=? AND stock>=?').run(o.qty, o.tribune_id, o.qty);
        if (r.changes === 0) {
          db.prepare("UPDATE orders SET status='REFUND_DUE', provider_txn=?, updated_at=? WHERE id=?").run(txn || null, ts, o.id);
          return getOrder(ref);
        }
      }
      const ins = db.prepare('INSERT INTO tickets(code,order_id,event_id) VALUES(?,?,?)');
      for (let i = 0; i < o.qty; i++) ins.run(newTicketCode(), o.id, o.event_id);
      db.prepare("UPDATE orders SET status='PAID', provider_txn=?, updated_at=? WHERE id=?").run(txn || null, ts, o.id);
    } else if (providerStatus === 'FAILED' || providerStatus === 'EXPIRED') {
      if (o.status !== 'PENDING') return o;
      db.prepare('UPDATE tribunes SET stock=stock+? WHERE id=?').run(o.qty, o.tribune_id);
      db.prepare('UPDATE orders SET status=?, updated_at=? WHERE id=?').run(providerStatus === 'FAILED' ? 'FAILED' : 'EXPIRED', ts, o.id);
    }
    return getOrder(ref);
  });
}

function expirePending(ttlMs) {
  const old = db.prepare("SELECT ref FROM orders WHERE status='PENDING' AND created_at<?").all(now() - ttlMs);
  for (const r of old) settle(r.ref, 'EXPIRED');
  return old.length;
}

const ticketsOf = orderId => db.prepare('SELECT code,status,used_at FROM tickets WHERE order_id=? ORDER BY rowid').all(orderId);

function eventAndTribune(o) {
  return db.prepare('SELECT e.id event_id,e.titre,e.adv,e.date,e.lieu,e.heure_confirmee,t.nom tribune FROM events e, tribunes t WHERE e.id=? AND t.id=?').get(o.event_id, o.tribune_id);
}

function validateTicket(code, eventId, consume = true) {
  return tx(() => {
    const t = db.prepare('SELECT * FROM tickets WHERE code=?').get(code);
    if (!t) return { result: 'invalid' };
    if (eventId && t.event_id !== eventId) return { result: 'wrong_event' };
    if (t.status === 'USED') return { result: 'already_used', usedAt: t.used_at };
    if (!consume) return { result: 'valid', consumed: false };
    db.prepare("UPDATE tickets SET status='USED', used_at=? WHERE code=? AND status='VALID'").run(now(), code);
    return { result: 'valid', consumed: true };
  });
}

function createEvent({ type, sport = '', titre, adv, date, lieu, grad, tribunes = [], heureConfirmee = true }) {
  return tx(() => {
    const id = db.prepare('INSERT INTO events(type,titre,adv,date,lieu,grad,heure_confirmee,sport) VALUES(?,?,?,?,?,?,?,?)').run(type, titre, adv || '', date, lieu, grad || '', heureConfirmee ? 1 : 0, sport).lastInsertRowid;
    const ins = db.prepare('INSERT INTO tribunes(event_id,nom,prix,stock) VALUES(?,?,?,?)');
    for (const t of tribunes) ins.run(id, t.nom, t.prix, t.stock);
    return Number(id);
  });
}
function findEvent(titre, date) { return db.prepare('SELECT id FROM events WHERE titre=? AND date=?').get(titre, date); }
function updateEvent(id, f) {
  const cols = { titre: 'titre', adv: 'adv', date: 'date', lieu: 'lieu', type: 'type', sport: 'sport', heureConfirmee: 'heure_confirmee' };
  const sets = [], vals = [];
  for (const [k, c] of Object.entries(cols)) if (f[k] !== undefined) { sets.push(c + '=?'); vals.push(k === 'heureConfirmee' ? (f[k] ? 1 : 0) : f[k]); }
  if (!sets.length) throw new HttpError(400, 'Aucun champ à modifier.');
  const r = db.prepare(`UPDATE events SET ${sets.join(',')} WHERE id=?`).run(...vals, id);
  if (!r.changes) throw new HttpError(404, 'Événement introuvable.');
}
function addTribunes(eventId, tribunes) {
  return tx(() => {
    if (!db.prepare('SELECT 1 FROM events WHERE id=?').get(eventId)) throw new HttpError(404, 'Événement introuvable.');
    const ins = db.prepare('INSERT INTO tribunes(event_id,nom,prix,stock) VALUES(?,?,?,?)');
    for (const t of tribunes) ins.run(eventId, t.nom, t.prix, t.stock);
  });
}
function updateTribune(id, { prix, stock }) {
  const r = db.prepare('UPDATE tribunes SET prix=COALESCE(?,prix), stock=COALESCE(?,stock) WHERE id=?').run(prix ?? null, stock ?? null, id);
  if (!r.changes) throw new HttpError(404, 'Tribune introuvable.');
}

function stats() {
  return db.prepare(`SELECT status, COUNT(*) commandes, COALESCE(SUM(qty),0) billets, COALESCE(SUM(total),0) montant FROM orders GROUP BY status`).all();
}

// ---- Récupération des billets par SMS (code à usage unique) ------------------
const OTP_TTL = 10 * 60000, OTP_MAX_ATTEMPTS = 5, SESSION_TTL = 24 * 3600000;
const hasOrders = phone => !!db.prepare("SELECT 1 FROM orders WHERE phone=? AND status IN ('PAID','PENDING','REFUND_DUE') LIMIT 1").get(phone);
function createOtp(phone) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  db.prepare('INSERT INTO otp(phone,code_hash,expires_at,attempts) VALUES(?,?,?,0) ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0')
    .run(phone, sha(phone + ':' + code), now() + OTP_TTL);
  return code;
}
function verifyOtp(phone, code) {
  return tx(() => {
    const r = db.prepare('SELECT * FROM otp WHERE phone=?').get(phone);
    if (!r || r.expires_at < now() || r.attempts >= OTP_MAX_ATTEMPTS) { if (r) db.prepare('DELETE FROM otp WHERE phone=?').run(phone); return null; }
    const a = Buffer.from(sha(phone + ':' + String(code))), b = Buffer.from(r.code_hash);
    if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) { db.prepare('UPDATE otp SET attempts=attempts+1 WHERE phone=?').run(phone); return null; }
    db.prepare('DELETE FROM otp WHERE phone=?').run(phone);
    const session = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions(token_hash,phone,expires_at) VALUES(?,?,?)').run(sha(session), phone, now() + SESSION_TTL);
    return { session, expiresAt: now() + SESSION_TTL };
  });
}
function sessionPhone(token) {
  if (typeof token !== 'string' || token.length < 32) return null;
  const r = db.prepare('SELECT phone,expires_at FROM sessions WHERE token_hash=?').get(sha(token));
  return r && r.expires_at > now() ? r.phone : null;
}
const ordersByPhone = phone => db.prepare("SELECT * FROM orders WHERE phone=? AND status<>'FAILED' ORDER BY created_at DESC LIMIT 50").all(phone);
function purgeExpired() { db.prepare('DELETE FROM otp WHERE expires_at<?').run(now()); db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now()); }

function backupTo(file) { db.exec(`VACUUM INTO '${String(file).replace(/'/g, "''")}'`); }

// ---- Espace administrateur -------------------------------------------------
function adminEvents() {
  const evs = db.prepare('SELECT * FROM events ORDER BY date DESC').all();
  const trs = db.prepare(`SELECT t.id,t.event_id,t.nom,t.prix,t.stock,
    COALESCE((SELECT SUM(o.qty) FROM orders o WHERE o.tribune_id=t.id AND o.status='PAID'),0) vendus,
    COALESCE((SELECT SUM(o.total) FROM orders o WHERE o.tribune_id=t.id AND o.status='PAID'),0) recette,
    COALESCE((SELECT SUM(o.qty) FROM orders o WHERE o.tribune_id=t.id AND o.status='PENDING'),0) en_attente
    FROM tribunes t ORDER BY t.prix`).all();
  const used = Object.fromEntries(db.prepare("SELECT event_id,COUNT(*) c FROM tickets WHERE status='USED' GROUP BY event_id").all().map(r => [r.event_id, r.c]));
  return evs.map(e => {
    const tribunes = trs.filter(t => t.event_id === e.id);
    return { ...e, tribunes, vendus: tribunes.reduce((a, t) => a + t.vendus, 0), recette: tribunes.reduce((a, t) => a + t.recette, 0), entres: used[e.id] || 0 };
  });
}
const refundsDue = () => db.prepare(`SELECT o.ref,o.phone,o.operator,o.total,o.qty,o.provider_txn,o.updated_at,e.titre FROM orders o JOIN events e ON e.id=o.event_id WHERE o.status='REFUND_DUE' ORDER BY o.updated_at`).all();
function markRefunded(ref) {
  const r = db.prepare("UPDATE orders SET status='REFUNDED', updated_at=? WHERE ref=? AND status='REFUND_DUE'").run(now(), ref);
  if (!r.changes) throw new HttpError(404, 'Aucune commande à rembourser avec cette référence.');
}
const supportList = () => db.prepare('SELECT id,phone,message,created_at FROM support ORDER BY id DESC LIMIT 100').all();

// ---- Journal des actions d'administration (lecture seule côté application) -----
function audit(actor, action, target, detail) {
  db.prepare('INSERT INTO admin_log(at,actor,action,target,detail) VALUES(?,?,?,?,?)').run(now(), String(actor).slice(0, 40), String(action).slice(0, 40), String(target || '').slice(0, 60), String(detail || '').slice(0, 500));
}
const auditList = (limit = 300) => db.prepare('SELECT id,at,actor,action,target,detail FROM admin_log ORDER BY id DESC LIMIT ?').all(limit);

// ---- Journal d'activité + synchronisation temps réel ------------------------------------------------
const { EventEmitter } = require('events');
const bus = new EventEmitter(); bus.setMaxListeners(0);
function logActivity({ actor = 'visiteur', role = 'public', action, target = '', detail = '', session = '', device = '' }) {
  const at = now();
  const id = Number(db.prepare('INSERT INTO activity_log(at,actor,role,action,target,detail,session,device) VALUES(?,?,?,?,?,?,?,?)')
    .run(at, String(actor).slice(0, 40), String(role).slice(0, 12), String(action).slice(0, 40), String(target).slice(0, 80), String(detail).slice(0, 500), String(session).slice(0, 24), String(device).slice(0, 10)).lastInsertRowid);
  const row = { id, at, actor, role, action, target, detail, session, device };
  bus.emit('change', { scope: 'staff', type: 'activity', row });
  return row;
}
function activityList({ limit = 200, role = '', q = '' } = {}) {
  const w = [], a = [];
  if (role) { w.push('role=?'); a.push(role); }
  if (q) { w.push("(action LIKE ? OR target LIKE ? OR detail LIKE ? OR actor LIKE ?)"); a.push(...Array(4).fill('%' + String(q).replace(/[%_]/g, '') + '%')); }
  return db.prepare(`SELECT id,at,actor,role,action,target,detail,session,device FROM activity_log ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...a, Math.min(Math.max(+limit || 200, 1), 1000));
}
const activityStats = () => db.prepare("SELECT role, COUNT(*) n, COUNT(DISTINCT NULLIF(session,'')) sessions FROM activity_log WHERE at > ? GROUP BY role").all(now() - 24 * 3600000);
// Signal de changement : `public` = les affiches/stocks ont changé (visiteurs) ; le personnel reçoit tout.
const emit = (what, pub) => { bus.emit('change', { scope: 'staff', type: 'sync', what }); if (pub) bus.emit('change', { scope: 'public', type: 'events' }); };
const around = (name, fn) => { const f = module.exports[name]; module.exports[name] = (...a) => { const r = f(...a); try { fn(r, a); } catch (e) { console.error('[sync]', e.message); } return r; }; };

module.exports = { db, HttpError, tx, listEvents, createOrder, getOrder, getOrderByNotif, checkToken, setProviderInfo, settle, expirePending, ticketsOf, eventAndTribune, validateTicket, createEvent, findEvent, updateEvent, addTribunes, updateTribune, stats, now, hasOrders, createOtp, verifyOtp, sessionPhone, ordersByPhone, purgeExpired, backupTo, adminEvents, refundsDue, markRefunded, supportList, audit, auditList };
Object.assign(module.exports, { bus, logActivity, activityList, activityStats });
// Chaque écriture métier prévient les écrans connectés (public : affiches/stocks ; personnel : tout) et laisse une trace en base.
around('createOrder', (r, [x]) => { emit('orders', true); logActivity({ actor: 'visiteur', role: 'public', action: 'order.create', target: r.order.ref, detail: `événement #${x.eventId} · tribune #${x.tribuneId} · ${x.qty} billet(s) · ${r.order.total} FCFA · ${x.operator} · +223 ${String(x.phone).slice(0, 2)}****${String(x.phone).slice(-2)}` }); });
{ const f = module.exports.settle; module.exports.settle = (ref, st, txn) => { const before = getOrder(ref), r = f(ref, st, txn); try { if (r && before && before.status !== r.status) { emit('orders', true); logActivity({ actor: 'système', role: 'public', action: 'order.' + r.status.toLowerCase(), target: r.ref, detail: `${r.qty} billet(s) · ${r.total} FCFA · ${r.operator}` }); } } catch (e) { console.error('[sync]', e.message); } return r; }; }
around('expirePending', n => { if (n) { emit('orders', true); logActivity({ actor: 'système', role: 'public', action: 'order.expired', detail: n + ' commande(s) expirée(s), places remises en vente' }); } });
around('validateTicket', (r, [code, ev, consume]) => { emit('tickets'); logActivity({ actor: 'contrôle', role: 'control', action: consume === false ? 'ticket.check' : 'ticket.scan', target: String(code).slice(0, 20), detail: (r && r.result) || '' }); });
around('createEvent', () => emit('events', true));
around('updateEvent', () => emit('events', true));
around('addTribunes', () => emit('events', true));
around('updateTribune', () => emit('events', true));
around('markRefunded', () => emit('refunds'));
around('audit', () => emit('audit'));
