'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DocStore } = require('./docstore');

/* ======================================================================================
   ORGANISATION DES DONNÉES — une base par domaine, du type adapté à l'usage (détails : BASES-DE-DONNEES.md)

   Domaine        Type de base                 Contenu
   UTILISATEURS   Relationnelle (SQLite)       commandes, paiements, billets achetés, codes SMS, sessions, support
   ADMIN          Relationnelle (SQLite)       événements, tribunes, tarifs, stocks, journal des modifications
                  + Documents (journal)        journal d'activité de tous les utilisateurs (ajout seul)
   PERSONNEL      Relationnelle (SQLite)       comptes du personnel, rôles, clés (hachées), révocation, journal des connexions
   CONTRÔLE       Non relationnelle (documents / clé-valeur, ajout seul)   entrées validées (1 billet = 1 clé), journal des passages
   Les trois bases SQLite sont ouvertes dans UNE connexion (ATTACH) en mode journal « DELETE » : une transaction qui touche
   plusieurs bases (ex. commande = stock de l'admin + commande de l'utilisateur) est validée ou annulée en bloc.
   ====================================================================================== */
const legacyDefault = path.join(__dirname, 'data.sqlite');
const newDefault = path.join(__dirname, 'data', 'utilisateurs.sqlite');
const MAIN = process.env.DB_PATH || (fs.existsSync(legacyDefault) && !fs.existsSync(newDefault) ? legacyDefault : newDefault);
fs.mkdirSync(path.dirname(MAIN), { recursive: true });
const BASE = path.basename(MAIN).replace(/\.sqlite$/, '');
const sib = n => path.join(path.dirname(MAIN), BASE === 'utilisateurs' ? n : BASE + '.' + n);
const FILES = {
  utilisateurs: MAIN,
  admin: process.env.DB_ADMIN_PATH || sib('admin.sqlite'),
  personnel: process.env.DB_PERSONNEL_PATH || sib('personnel.sqlite'),
  controle: process.env.DB_CONTROLE_DIR || sib('controle'),
  journal: process.env.DB_JOURNAL_DIR || sib('journal')
};

const db = new DatabaseSync(MAIN);
const q = s => String(s).replace(/'/g, "''");
db.exec(`ATTACH DATABASE '${q(FILES.admin)}' AS admin; ATTACH DATABASE '${q(FILES.personnel)}' AS personnel;
PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
PRAGMA main.journal_mode=DELETE; PRAGMA admin.journal_mode=DELETE; PRAGMA personnel.journal_mode=DELETE; PRAGMA synchronous=FULL;`);

// Bases non relationnelles : contrôle (entrées + passages) et journal d'activité.
const ctlStore = new DocStore(FILES.controle);
const entrees = ctlStore.collection('entrees', { kind: 'kv', durable: true, immutable: true });   // clé = code du billet → { event, at, staff, poste }
const scans = ctlStore.collection('scans', { kind: 'log', durable: true, immutable: true });       // un document par passage (accepté ou refusé)
const jrnStore = new DocStore(FILES.journal);
const journal = jrnStore.collection('activite', { kind: 'log', durable: false, immutable: true, keep: 50000 });

const tableExists = (schema, name) => !!db.prepare(`SELECT 1 FROM ${schema}.sqlite_master WHERE type='table' AND name=?`).get(name);
const hasCol = (schema, table, col) => db.prepare(`PRAGMA ${schema}.table_info(${table})`).all().some(c => c.name === col);

// ---- Schéma ---------------------------------------------------------------------------------------
const LEGACY = tableExists('main', 'events');     // ancienne base unique : migrée automatiquement ci-dessous
db.exec(`
CREATE TABLE IF NOT EXISTS admin.events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL, sport TEXT NOT NULL DEFAULT '', titre TEXT NOT NULL, adv TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL, lieu TEXT NOT NULL, grad TEXT NOT NULL DEFAULT '',
  heure_confirmee INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS admin.tribunes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  nom TEXT NOT NULL, prix INTEGER NOT NULL CHECK(prix>0), stock INTEGER NOT NULL CHECK(stock>=0)
);
CREATE TABLE IF NOT EXISTS admin.admin_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT ''
);
CREATE TRIGGER IF NOT EXISTS admin.admin_log_no_update BEFORE UPDATE ON admin_log BEGIN SELECT RAISE(ABORT, 'journal en lecture seule'); END;
CREATE TRIGGER IF NOT EXISTS admin.admin_log_no_delete BEFORE DELETE ON admin_log BEGIN SELECT RAISE(ABORT, 'journal en lecture seule'); END;

CREATE TABLE IF NOT EXISTS personnel.staff_meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS personnel.staff(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','control')), poste TEXT NOT NULL DEFAULT '',
  key_hash TEXT NOT NULL UNIQUE,                       -- empreinte de la clé : la clé elle-même n'est JAMAIS stockée
  source TEXT NOT NULL DEFAULT 'admin',                -- 'env' (fichier .env / démarrage) ou 'admin' (créé depuis l'écran Personnel)
  actif INTEGER NOT NULL DEFAULT 1, cree_le INTEGER NOT NULL, revoque_le INTEGER,
  derniere_connexion INTEGER, nb_connexions INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS personnel.staff_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, staff_id INTEGER, nom TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT ''
);
CREATE TRIGGER IF NOT EXISTS personnel.staff_log_no_update BEFORE UPDATE ON staff_log BEGIN SELECT RAISE(ABORT, 'journal en lecture seule'); END;
CREATE TRIGGER IF NOT EXISTS personnel.staff_log_no_delete BEFORE DELETE ON staff_log BEGIN SELECT RAISE(ABORT, 'journal en lecture seule'); END;
`);

if (LEGACY) {
  // Migration de l'ancienne base unique : chaque donnée rejoint la base de son domaine. Une seule transaction (tout ou rien).
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
  try {
    const sp = hasCol('main', 'events', 'sport') ? 'sport' : "''";
    db.exec(`INSERT OR IGNORE INTO admin.events(id,type,sport,titre,adv,date,lieu,grad,heure_confirmee) SELECT id,type,${sp},titre,adv,date,lieu,grad,heure_confirmee FROM main.events;
      INSERT OR IGNORE INTO admin.tribunes(id,event_id,nom,prix,stock) SELECT id,event_id,nom,prix,stock FROM main.tribunes;
      INSERT OR IGNORE INTO admin.admin_log(id,at,actor,action,target,detail) SELECT id,at,actor,action,target,detail FROM main.admin_log;`);
    if (tableExists('main', 'activity_log')) for (const r of db.prepare('SELECT * FROM main.activity_log ORDER BY id').all()) journal.append({ at: r.at, actor: r.actor, role: r.role, action: r.action, target: r.target, detail: r.detail, session: r.session, device: r.device });
    if (hasCol('main', 'tickets', 'status')) for (const t of db.prepare("SELECT code,event_id,used_at FROM main.tickets WHERE status='USED'").all()) entrees.putIfAbsent(t.code, { event: t.event_id, at: t.used_at || Date.now(), staff: null, poste: 'migration' });
    db.exec(`CREATE TABLE main.orders_n(
      id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL,
      event_id INTEGER NOT NULL, tribune_id INTEGER NOT NULL, qty INTEGER NOT NULL, total INTEGER NOT NULL,
      operator TEXT NOT NULL, phone TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
      provider_ref TEXT, notif_token TEXT, provider_status TEXT, provider_txn TEXT, last_check INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO main.orders_n SELECT id,ref,token_hash,event_id,tribune_id,qty,total,operator,phone,status,provider_ref,notif_token,provider_status,provider_txn,last_check,created_at,updated_at FROM main.orders;
      CREATE TABLE main.tickets_n(code TEXT PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), event_id INTEGER NOT NULL);
      INSERT INTO main.tickets_n SELECT code,order_id,event_id FROM main.tickets;
      DROP TABLE main.tickets; DROP TABLE main.orders; DROP TABLE main.tribunes; DROP TABLE main.events; DROP TABLE main.admin_log;
      ${tableExists('main', 'activity_log') ? 'DROP TABLE main.activity_log;' : ''}
      ALTER TABLE main.orders_n RENAME TO orders; ALTER TABLE main.tickets_n RENAME TO tickets;`);
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw new Error('Migration de l\'ancienne base impossible (rien n\'a été modifié) : ' + e.message); }
  db.exec('PRAGMA foreign_keys=ON');
  console.log('[bases] ancienne base unique migrée : utilisateurs / admin / personnel (SQLite) + contrôle / journal (documents)');
}

db.exec(`
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  event_id INTEGER NOT NULL,          -- référence vers admin.events (autre base : intégrité vérifiée par le code, dans la même transaction)
  tribune_id INTEGER NOT NULL,        -- référence vers admin.tribunes
  qty INTEGER NOT NULL, total INTEGER NOT NULL,
  operator TEXT NOT NULL, phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',      -- PENDING PAID FAILED EXPIRED REFUND_DUE REFUNDED
  provider_ref TEXT, notif_token TEXT, provider_status TEXT,
  provider_txn TEXT, last_check INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_notif ON orders(notif_token);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
CREATE TABLE IF NOT EXISTS tickets(                -- le billet acheté ; son USAGE (entrée au stade) est un fait de la base « contrôle »
  code TEXT PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  event_id INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS otp(
  phone TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, phone TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS support(
  id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, message TEXT NOT NULL, created_at INTEGER NOT NULL
);
`);
try { db.exec('ALTER TABLE admin.events ADD COLUMN heure_confirmee INTEGER NOT NULL DEFAULT 1'); } catch (_) {}
try { db.exec("ALTER TABLE admin.events ADD COLUMN sport TEXT NOT NULL DEFAULT ''"); } catch (_) {}
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

const ticketsOf = orderId => db.prepare('SELECT code FROM tickets WHERE order_id=? ORDER BY rowid').all(orderId).map(t => { const u = entrees.get(t.code); return { code: t.code, status: u ? 'USED' : 'VALID', used_at: u ? u.at : null }; });

function eventAndTribune(o) {
  return db.prepare('SELECT e.id event_id,e.titre,e.adv,e.date,e.lieu,e.heure_confirmee,t.nom tribune FROM events e, tribunes t WHERE e.id=? AND t.id=?').get(o.event_id, o.tribune_id);
}

// Contrôle aux entrées : le billet (base utilisateurs, relationnelle) est vérifié, puis l'entrée est inscrite dans la base « contrôle »
// (documents, clé = code du billet). putIfAbsent est atomique : deux bornes ne peuvent jamais faire entrer deux fois le même billet.
function validateTicket(code, eventId, consume = true, staff = null) {
  const t = db.prepare('SELECT code,event_id FROM tickets WHERE code=?').get(code);
  const log = (result, extra) => scans.append({ at: now(), code, event: t ? t.event_id : null, result, mode: consume === false ? 'verif' : 'entree', staff: staff ? staff.id : null, poste: staff ? staff.nom : '', ...extra });
  if (!t) { log('invalid'); return { result: 'invalid' }; }
  if (eventId && t.event_id !== eventId) { log('wrong_event'); return { result: 'wrong_event' }; }
  const used = entrees.get(code);
  if (used) { log('already_used', { premiere_entree: used.at }); return { result: 'already_used', usedAt: used.at }; }
  if (!consume) { log('valid'); return { result: 'valid', consumed: false }; }
  const r = entrees.putIfAbsent(code, { event: t.event_id, at: now(), staff: staff ? staff.id : null, poste: staff ? staff.nom : '' });
  if (!r.created) { log('already_used', { premiere_entree: r.doc.at }); return { result: 'already_used', usedAt: r.doc.at }; }
  log('valid');
  return { result: 'valid', consumed: true };
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

// Sauvegarde cohérente de TOUTES les bases : `file` reçoit la base utilisateurs ; les autres sont écrites à côté
// (<nom>.admin.sqlite, <nom>.personnel.sqlite, <nom>.controle/, <nom>.journal/).
function backupTo(file) {
  const base = String(file).replace(/\.sqlite$/, '');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db.exec(`VACUUM main INTO '${q(file)}'; VACUUM admin INTO '${q(base + '.admin.sqlite')}'; VACUUM personnel INTO '${q(base + '.personnel.sqlite')}'`);
  ctlStore.backupTo(base + '.controle'); jrnStore.backupTo(base + '.journal');
  return [file, base + '.admin.sqlite', base + '.personnel.sqlite', base + '.controle', base + '.journal'];
}

// ---- Espace administrateur -------------------------------------------------
function adminEvents() {
  const evs = db.prepare('SELECT * FROM events ORDER BY date DESC').all();
  const trs = db.prepare(`SELECT t.id,t.event_id,t.nom,t.prix,t.stock,
    COALESCE((SELECT SUM(o.qty) FROM orders o WHERE o.tribune_id=t.id AND o.status='PAID'),0) vendus,
    COALESCE((SELECT SUM(o.total) FROM orders o WHERE o.tribune_id=t.id AND o.status='PAID'),0) recette,
    COALESCE((SELECT SUM(o.qty) FROM orders o WHERE o.tribune_id=t.id AND o.status='PENDING'),0) en_attente
    FROM tribunes t ORDER BY t.prix`).all();
  const used = {}; for (const u of entrees.values()) used[u.event] = (used[u.event] || 0) + 1;
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

// ---- Personnel (base relationnelle dédiée) : comptes, rôles, clés hachées, révocation, journal des connexions ----
const SALT = (() => { const r = db.prepare("SELECT v FROM staff_meta WHERE k='salt'").get(); if (r) return r.v; const v = crypto.randomBytes(24).toString('hex'); db.prepare("INSERT INTO staff_meta(k,v) VALUES('salt',?)").run(v); return v; })();
const keyHash = k => sha(SALT + ':' + String(k));
const staffLog = (staffId, nom, action, detail = '', ip = '') => db.prepare('INSERT INTO staff_log(at,staff_id,nom,action,detail,ip) VALUES(?,?,?,?,?,?)').run(now(), staffId || null, String(nom || '').slice(0, 60), action, String(detail).slice(0, 300), String(ip).slice(0, 45));
/** Compte actif correspondant à la clé présentée (ou null). */
function staffByKey(key) {
  if (!key || typeof key !== 'string') return null;
  key = key.trim();                      // espaces ou retour à la ligne ajoutés par un copier-coller
  if (!key || key.length > 200) return null;
  return db.prepare('SELECT id,nom,role,poste FROM staff WHERE key_hash=? AND actif=1').get(keyHash(key)) || null;
}
const staffCount = () => db.prepare('SELECT COUNT(*) c FROM staff WHERE actif=1').get().c;
/** Aligne les comptes « env » sur ADMIN_KEY / CONTROL_KEY (syntaxe : « clé » ou « Nom=clé », séparées par des virgules). */
function syncStaffFromEnv(adminEnv, controlEnv) {
  const parse = (v, role, dflt) => String(v || '').split(',').map(x => x.trim()).filter(Boolean).map((x, i, a) => {
    const eq = x.indexOf('='); return eq > 0 ? { nom: x.slice(0, eq).trim().slice(0, 60), key: x.slice(eq + 1).trim(), role } : { nom: a.length > 1 ? `${dflt} ${i + 1}` : dflt, key: x, role };
  });
  const want = [...parse(adminEnv, 'admin', 'Administration'), ...parse(controlEnv, 'control', 'Contrôle')];
  tx(() => {
    const keep = [];
    for (const w of want) {
      const h = keyHash(w.key), r = db.prepare('SELECT id,actif,nom,role FROM staff WHERE key_hash=?').get(h);
      if (!r) { const id = Number(db.prepare("INSERT INTO staff(nom,role,poste,key_hash,source,actif,cree_le) VALUES(?,?,?,?,'env',1,?)").run(w.nom, w.role, '', h, now()).lastInsertRowid); staffLog(id, w.nom, 'compte.cree', 'clé fournie au démarrage'); keep.push(id); }
      else { keep.push(r.id); if (!r.actif || r.nom !== w.nom || r.role !== w.role) { db.prepare("UPDATE staff SET actif=1, revoque_le=NULL, nom=?, role=?, source='env' WHERE id=?").run(w.nom, w.role, r.id); staffLog(r.id, w.nom, 'compte.maj', 'aligné sur le démarrage'); } }
    }
    for (const r of db.prepare("SELECT id,nom FROM staff WHERE source='env' AND actif=1").all()) if (!keep.includes(r.id)) { db.prepare('UPDATE staff SET actif=0, revoque_le=? WHERE id=?').run(now(), r.id); staffLog(r.id, r.nom, 'compte.revoque', 'clé retirée de la configuration'); }
  });
}
function staffLogin(staff, ip) { db.prepare('UPDATE staff SET derniere_connexion=?, nb_connexions=nb_connexions+1 WHERE id=?').run(now(), staff.id); staffLog(staff.id, staff.nom, 'connexion', staff.role, ip); }
const staffFailed = ip => staffLog(null, '', 'connexion.refusee', 'clé incorrecte', ip);
const listStaff = () => db.prepare('SELECT id,nom,role,poste,source,actif,cree_le,revoque_le,derniere_connexion,nb_connexions FROM staff ORDER BY actif DESC, role, id').all();
const staffLogList = (limit = 100) => db.prepare('SELECT id,at,staff_id,nom,action,detail,ip FROM staff_log ORDER BY id DESC LIMIT ?').all(Math.min(Math.max(+limit || 100, 1), 500));
function createStaff({ nom, role, poste = '', by = '' }) {
  const prefix = role === 'admin' ? 'MJS-ADM' : 'MJS-CTL', g = () => Array.from({ length: 5 }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join('');
  const key = `${prefix}-${g()}-${g()}-${g()}-${g()}`;
  const id = Number(db.prepare("INSERT INTO staff(nom,role,poste,key_hash,source,actif,cree_le) VALUES(?,?,?,?,'admin',1,?)").run(nom, role, poste, keyHash(key), now()).lastInsertRowid);
  staffLog(id, nom, 'compte.cree', `rôle ${role}${by ? ' · par ' + by : ''}`);
  return { id, key };      // la clé n'est montrée qu'à cet instant
}
function revokeStaff(id, byStaffId) {
  const r = db.prepare('SELECT id,nom,role,actif FROM staff WHERE id=?').get(id);
  if (!r) throw new HttpError(404, 'Compte introuvable.');
  if (!r.actif) throw new HttpError(409, 'Ce compte est déjà révoqué.');
  if (r.id === byStaffId) throw new HttpError(409, 'Vous ne pouvez pas révoquer votre propre compte.');
  if (r.role === 'admin' && db.prepare("SELECT COUNT(*) c FROM staff WHERE role='admin' AND actif=1").get().c <= 1) throw new HttpError(409, 'Il doit rester au moins un administrateur actif.');
  db.prepare('UPDATE staff SET actif=0, revoque_le=? WHERE id=?').run(now(), id);
  staffLog(id, r.nom, 'compte.revoque', 'révoqué depuis l\'administration');
}

// ---- Inventaire des bases (écran « Bases de données » de l'administration) ----
function databases() {
  const rel = (schema, tables) => tables.map(t => ({ nom: t, lignes: db.prepare(`SELECT COUNT(*) c FROM ${schema}.${t}`).get().c }));
  const size = f => { try { return fs.statSync(f).size; } catch (_) { return 0; } };
  const dsize = i => i.reduce((a, c) => a + c.octets, 0);
  return [
    { domaine: 'Utilisateurs', type: 'Relationnelle', moteur: 'SQLite', fichier: path.basename(FILES.utilisateurs), octets: size(FILES.utilisateurs), contenu: rel('main', ['orders', 'tickets', 'otp', 'sessions', 'support']),
      pourquoi: 'Argent, stock et billets : transactions ACID, contraintes d\'unicité, jointures commande ↔ billets ↔ téléphone.' },
    { domaine: 'Admin', type: 'Relationnelle', moteur: 'SQLite', fichier: path.basename(FILES.admin), octets: size(FILES.admin), contenu: rel('admin', ['events', 'tribunes', 'admin_log']),
      pourquoi: 'Référentiel structuré (événement → tribunes → tarifs/stocks) avec intégrité référentielle ; journal des modifications infalsifiable.' },
    { domaine: 'Admin (journal d\'activité)', type: 'Non relationnelle (documents, ajout seul)', moteur: 'Magasin de documents embarqué (NDJSON)', fichier: path.basename(FILES.journal) + '/', octets: dsize(jrnStore.info()), contenu: jrnStore.info().map(c => ({ nom: c.collection + ' (' + c.type + ')', lignes: c.documents })),
      pourquoi: 'Très gros volume d\'événements de formes variées, jamais modifiés : écriture rapide au fil de l\'eau, lecture des plus récents.' },
    { domaine: 'Personnel', type: 'Relationnelle', moteur: 'SQLite', fichier: path.basename(FILES.personnel), octets: size(FILES.personnel), contenu: rel('personnel', ['staff', 'staff_log']),
      pourquoi: 'Comptes, rôles et droits : peu de lignes mais unicité des clés, révocation traçable et journal des connexions infalsifiable.' },
    { domaine: 'Contrôle', type: 'Non relationnelle (documents / clé-valeur, ajout seul)', moteur: 'Magasin de documents embarqué (NDJSON, fsync)', fichier: path.basename(FILES.controle) + '/', octets: dsize(ctlStore.info()), contenu: ctlStore.info().map(c => ({ nom: c.collection + ' (' + c.type + ')', lignes: c.documents })),
      pourquoi: 'Lecture par clé unique (code du billet), écritures en rafale aux portes, documents de forme libre (borne, résultat, appareil), copie possible sur un poste hors-ligne.' }
  ];
}

// ---- Journal d'activité + synchronisation temps réel ------------------------------------------------
const { EventEmitter } = require('events');
const bus = new EventEmitter(); bus.setMaxListeners(0);
function logActivity({ actor = 'visiteur', role = 'public', action, target = '', detail = '', session = '', device = '' }) {
  const row = journal.append({ at: now(), actor: String(actor).slice(0, 40), role: String(role).slice(0, 12), action: String(action).slice(0, 40), target: String(target).slice(0, 80), detail: String(detail).slice(0, 500), session: String(session).slice(0, 24), device: String(device).slice(0, 10) });
  bus.emit('change', { scope: 'staff', type: 'activity', row });
  return row;
}
function activityList({ limit = 200, role = '', q = '' } = {}) {
  const needle = String(q || '').toLowerCase();
  return journal.recent(Math.min(Math.max(+limit || 200, 1), 1000), a => (!role || a.role === role) && (!needle || [a.action, a.target, a.detail, a.actor].some(x => String(x).toLowerCase().includes(needle))));
}
function activityStats() {
  const since = now() - 24 * 3600000, g = {};
  for (const a of journal.recent(1e9, a => a.at > since)) { const r = g[a.role] || (g[a.role] = { role: a.role, n: 0, ses: new Set() }); r.n++; if (a.session) r.ses.add(a.session); }
  return Object.values(g).map(r => ({ role: r.role, n: r.n, sessions: r.ses.size }));
}
// Signal de changement : `public` = les affiches/stocks ont changé (visiteurs) ; le personnel reçoit tout.
const emit = (what, pub) => { bus.emit('change', { scope: 'staff', type: 'sync', what }); if (pub) bus.emit('change', { scope: 'public', type: 'events' }); };
const around = (name, fn) => { const f = module.exports[name]; module.exports[name] = (...a) => { const r = f(...a); try { fn(r, a); } catch (e) { console.error('[sync]', e.message); } return r; }; };

module.exports = { db, FILES, HttpError, tx, listEvents, createOrder, getOrder, getOrderByNotif, checkToken, setProviderInfo, settle, expirePending, ticketsOf, eventAndTribune, validateTicket, createEvent, findEvent, updateEvent, addTribunes, updateTribune, stats, now, hasOrders, createOtp, verifyOtp, sessionPhone, ordersByPhone, purgeExpired, backupTo, adminEvents, refundsDue, markRefunded, supportList, audit, auditList };
Object.assign(module.exports, { bus, logActivity, activityList, activityStats, staffByKey, staffCount, syncStaffFromEnv, staffLogin, staffFailed, listStaff, staffLogList, createStaff, revokeStaff, databases, ctl: { entrees, scans }, journal });
// Chaque écriture métier prévient les écrans connectés (public : affiches/stocks ; personnel : tout) et laisse une trace en base.
around('createOrder', (r, [x]) => { emit('orders', true); logActivity({ actor: 'visiteur', role: 'public', action: 'order.create', target: r.order.ref, detail: `événement #${x.eventId} · tribune #${x.tribuneId} · ${x.qty} billet(s) · ${r.order.total} FCFA · ${x.operator} · +223 ${String(x.phone).slice(0, 2)}****${String(x.phone).slice(-2)}` }); });
{ const f = module.exports.settle; module.exports.settle = (ref, st, txn) => { const before = getOrder(ref), r = f(ref, st, txn); try { if (r && before && before.status !== r.status) { emit('orders', true); logActivity({ actor: 'système', role: 'public', action: 'order.' + r.status.toLowerCase(), target: r.ref, detail: `${r.qty} billet(s) · ${r.total} FCFA · ${r.operator}` }); } } catch (e) { console.error('[sync]', e.message); } return r; }; }
around('expirePending', n => { if (n) { emit('orders', true); logActivity({ actor: 'système', role: 'public', action: 'order.expired', detail: n + ' commande(s) expirée(s), places remises en vente' }); } });
around('validateTicket', (r, [code, ev, consume, staff]) => { emit('tickets'); logActivity({ actor: staff ? staff.nom : 'contrôle', role: 'control', action: consume === false ? 'ticket.check' : 'ticket.scan', target: String(code).slice(0, 20), detail: (r && r.result) || '' }); });
around('createEvent', () => emit('events', true));
around('updateEvent', () => emit('events', true));
around('addTribunes', () => emit('events', true));
around('updateTribune', () => emit('events', true));
around('markRefunded', () => emit('refunds'));
around('audit', () => emit('audit'));
