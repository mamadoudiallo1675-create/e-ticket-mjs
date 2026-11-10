// Test des fonctions Netlify (initier_paiement, webhook_cinetpay, billet, valider_billet, liberer_reservations).
// Bases : SQLite (même schéma, requêtes identiques) à la place de PostgreSQL, et un MongoDB SIMULÉ en mémoire. Guichet CinetPay : faux serveur local.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs'; import http from 'node:http'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SECRET = 'cle-api-secrete-test';
let R = [], fail = 0; const ok = (n, c, d = '') => { R.push((c ? 'OK  ' : 'KO  ') + n + (c ? '' : '  → ' + d)); if (!c) fail++; };

// ---- faux guichet CinetPay ----
const cp = { init: [], checks: [], next: 'ACCEPTED', amount: null, down: false };
const fake = http.createServer((q, s) => {
  let b = ''; q.on('data', d => b += d); q.on('end', () => {
    const j = JSON.parse(b || '{}'); s.setHeader('content-type', 'application/json');
    if (cp.down) { s.statusCode = 500; return s.end('{}'); }
    if (q.url.endsWith('/payment/check')) { cp.checks.push(j); const ref = j.transaction_id; return s.end(JSON.stringify({ code: cp.next === 'ACCEPTED' ? '00' : '662', data: { status: cp.next, amount: cp.amount ?? cp.paid?.[ref] ?? 0, currency: 'XOF' } })); }
    cp.init.push(j); cp.paid = cp.paid || {}; cp.paid[j.transaction_id] = j.amount;
    s.end(JSON.stringify({ code: '201', data: { payment_url: 'https://guichet.test/pay/' + j.transaction_id, payment_token: 'tok' } }));
  });
});
await new Promise(r => fake.listen(0, '127.0.0.1', r));
Object.assign(process.env, { CINETPAY_API_KEY: SECRET, CINETPAY_SITE_ID: '777', CINETPAY_BASE_URL: `http://127.0.0.1:${fake.address().port}/v2`, SITE_URL: 'https://billets.test', SMS_PROVIDER: 'console', CONTROL_KEY: 'cle-controle-test', RESERVATION_TTL_MIN: '15' });

// ---- SQL : SQLite derrière la même interface que l'adaptateur PostgreSQL ----
const sdb = new DatabaseSync(':memory:'); sdb.exec('PRAGMA foreign_keys=ON');
sdb.exec(fs.readFileSync('netlify/database/migrations/20261109000000_commandes_stock.sql', 'utf8'));
const conv = t => t.replace(/\$(\d+)/g, '?$1');
let chain = Promise.resolve();
const run = (text, p = []) => { const st = sdb.prepare(conv(text)); return /^\s*(SELECT|.*RETURNING)/is.test(text) ? st.all(...p) : (st.run(...p), []); };
const sqlSafe = {
  query: async (t, p) => run(t, p),
  // verrou : les transactions s'exécutent l'une après l'autre (comme un verrou de ligne PostgreSQL)
  tx: fn => { const p = chain.then(async () => { sdb.exec('BEGIN IMMEDIATE'); try { const o = await fn({ query: async (t, p2) => run(t, p2) }); sdb.exec('COMMIT'); return o; } catch (e) { sdb.exec('ROLLBACK'); throw e; } }); chain = p.catch(() => {}); return p; }
};

// ---- MongoDB simulé ----
const match = (d, f) => Object.entries(f).every(([k, v]) => {
  if (k === '$or') return v.some(x => match(d, x));
  const x = d[k];
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.entries(v).every(([o, a]) => o === '$ne' ? x !== a : o === '$exists' ? (x !== undefined) === a : o === '$lt' ? x !== undefined && x < a : false);
  return x === v;
});
const store = {};
const coll = n => { const a = store[n] = store[n] || [];
  return {
    async insertOne(d) { if (a.some(x => x._id === d._id)) throw new Error('E11000 duplicate key'); a.push({ ...d }); return { insertedId: d._id }; },
    async insertMany(ds) { for (const d of ds) await this.insertOne(d); return { insertedCount: ds.length }; },
    async findOne(f) { const d = a.find(x => match(x, f)); return d ? { ...d } : null; },
    find(f) { return { toArray: async () => a.filter(x => match(x, f)).map(x => ({ ...x })) }; },
    async updateOne(f, u, o = {}) { const d = a.find(x => match(x, f)); if (d) { Object.assign(d, u.$set || {}); return { matchedCount: 1, modifiedCount: 1 }; } if (o.upsert) { a.push({ ...(f._id ? { _id: f._id } : {}), ...(u.$set || {}) }); return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }; } return { matchedCount: 0, modifiedCount: 0 }; }
  }; };
const mongoDrv = { collection: coll };
const { useDrivers } = await import('./../netlify/lib/drivers.mjs'); useDrivers({ sql: sqlSafe, mongo: mongoDrv });
const initF = (await import('../netlify/functions/initier_paiement.mjs')).default;
const hookF = (await import('../netlify/functions/webhook_cinetpay.mjs')).default;
const billetF = (await import('../netlify/functions/billet.mjs')).default;
const validerF = (await import('../netlify/functions/valider_billet.mjs')).default;
const cronF = (await import('../netlify/functions/liberer_reservations.mjs')).default;
const sms = require('../sms/index.js');

sdb.exec(`INSERT INTO tribunes(id,event_id,event_titre,nom,prix,capacite) VALUES (1,10,'Test match','Tribune A',2000,50),(2,10,'Test match','Pelouse',1000,3),(3,10,'Test match','Mini',500,2)`);
const post = (f, url, body, h = {}) => f(new Request('https://billets.test' + url, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) }), { params: {} });
const form = o => hookF(new Request('https://billets.test/api/cinetpay/notification', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() }), { params: {} });
const tr = id => sdb.prepare('SELECT * FROM tribunes WHERE id=?').get(id), cmd = id => sdb.prepare('SELECT * FROM commandes WHERE transac_id=?').get(id);
const init = async (b) => { const r = await post(initF, '/api/cinetpay/initier', b); return { s: r.status, b: await r.json() }; };

// 1. Initiation
let r = await init({ tribuneId: 1, qty: 2, phone: '70112233', montant: 1 });
ok('initier : 201, adresse du guichet CinetPay, montant calculé par le serveur (2 × 2000)', r.s === 201 && r.b.payUrl.startsWith('https://guichet.test/pay/ET') && r.b.montant === 4000, JSON.stringify(r));
const A = r.b.transac_id;
ok('stock réservé « en cours » (pas encore vendu)', tr(1).en_cours === 2 && tr(1).vendu === 0);
ok('commande « attente_paiement » avec transac_id unique', cmd(A) && cmd(A).statut === 'attente_paiement' && /^ET[A-Z0-9]+$/.test(A) && cmd(A).montant === 4000);
ok('MongoDB : trace « attente de paiement » avec le téléphone', store.transactions[0].statut === 'attente de paiement' && store.transactions[0].phone === '70112233');
const sent = cp.init.at(-1);
ok('CinetPay reçoit transaction_id, montant serveur, notify_url de la fonction webhook et return_url', sent.transaction_id === A && sent.amount === 4000 && sent.notify_url === 'https://billets.test/api/cinetpay/notification' && sent.return_url === 'https://billets.test/commande/' + A, JSON.stringify(sent));
ok('numéro/quantité invalides refusés', (await init({ tribuneId: 1, qty: 9, phone: '70112233' })).s === 400 && (await init({ tribuneId: 1, qty: 1, phone: '12' })).s === 400 && (await post(initF, '/x', {}, {}).then(x => x.status)) === 400);
ok('méthode GET refusée', (await initF(new Request('https://billets.test/x'), {})).status === 405);

// 2. Stock : pas de sur-vente, même en parallèle
const par = await Promise.all(Array.from({ length: 6 }, () => init({ tribuneId: 2, qty: 1, phone: '66000111' })));
ok('6 achats simultanés pour 3 places : exactement 3 acceptés, 3 refusés (409)', par.filter(x => x.s === 201).length === 3 && par.filter(x => x.s === 409).length === 3, par.map(x => x.s).join());
ok('jamais plus de places réservées que la capacité', tr(2).en_cours === 3 && tr(2).vendu === 0);
ok('tribune inconnue : 404', (await init({ tribuneId: 99, qty: 1, phone: '70112233' })).s === 404);

// 3. CinetPay indisponible : places libérées
cp.down = true; const before = tr(1).en_cours;
r = await init({ tribuneId: 1, qty: 1, phone: '70112233' });
cp.down = false;
ok('guichet CinetPay en panne : 502 et places immédiatement libérées', r.s === 502 && tr(1).en_cours === before);

// 4. Webhook : GET, mauvais identifiant, autre site
ok('webhook GET (test de disponibilité) : 200', (await hookF(new Request('https://billets.test/api/cinetpay/notification'), {})).status === 200);
const nbChecks = cp.checks.length;
await form({ cpm_trans_id: 'n-importe-quoi', cpm_site_id: '777' }); await form({ cpm_trans_id: A, cpm_site_id: '999' });
ok('identifiant mal formé ou autre site : ignoré sans appel à CinetPay', cp.checks.length === nbChecks && cmd(A).statut === 'attente_paiement');

// 5. Notification truquée : CinetPay dit « en attente » → rien ne change
cp.next = 'WAITING_FOR_CUSTOMER'; await form({ cpm_trans_id: A, cpm_site_id: '777', cpm_error_message: 'SUCCES' });
ok('notification truquée (CinetPay : en attente) : aucune vente', cmd(A).statut === 'attente_paiement' && tr(1).vendu === 0 && !store.billets);
// montant inférieur
cp.next = 'ACCEPTED'; cp.amount = 100; const B = (await init({ tribuneId: 3, qty: 1, phone: '70555444' })).b.transac_id;
await form({ cpm_trans_id: B, cpm_site_id: '777' });
ok('paiement ACCEPTED mais montant insuffisant : refusé et place libérée', cmd(B).statut === 'echoue' && tr(3).en_cours === 0 && !(store.billets || []).some(x => x.transac_id === B));
cp.amount = null;

// 6. Paiement confirmé
sms.outbox.length = 0; const resp = await form({ cpm_trans_id: A, cpm_site_id: '777' });
ok('webhook valide : vérifie auprès de CinetPay (statut + montant) puis répond 200', resp.status === 200 && cp.checks.at(-1).transaction_id === A);
ok('SQL : « en cours » → « vendu » (stock définitif)', cmd(A).statut === 'vendu' && tr(1).en_cours === 0 && tr(1).vendu === 2);
const T = store.transactions.find(x => x._id === A);
ok('MongoDB : transaction « payé »', T.statut === 'payé' && T.billets_ok === true);
const bil = store.billets.filter(x => x.transac_id === A);
ok('un billet (jeton unique) par place, jeton assez court pour le QR (≤ 42 car.) et non devinable', bil.length === 2 && new Set(bil.map(x => x._id)).size === 2 && bil.every(x => /^[A-Za-z0-9_-]{32}$/.test(x._id) && x.statut === 'valide'), JSON.stringify(bil.map(x => x._id)));
ok('lien court unique enregistré', T.lien && /^[A-Za-z0-9_-]{9,12}$/.test(T.lien) && store.liens.some(x => x._id === T.lien && x.transac_id === A));
ok('SMS envoyé au numéro lu dans MongoDB, avec le lien du billet', sms.outbox.length === 1 && sms.outbox[0].to === '+22370112233' && /Félicitations, 2 places réservées avec succès/.test(sms.outbox[0].message) && sms.outbox[0].message.includes('https://billets.test/b/' + T.lien), JSON.stringify(sms.outbox));
await form({ cpm_trans_id: A, cpm_site_id: '777' }); await Promise.all([form({ cpm_trans_id: A, cpm_site_id: '777' }), form({ cpm_trans_id: A, cpm_site_id: '777' })]);
ok('notification répétée ou simultanée : aucun doublon (billets, ventes, SMS)', store.billets.filter(x => x.transac_id === A).length === 2 && tr(1).vendu === 2 && sms.outbox.length === 1);

// 7. SMS en échec : le paiement reste valide
process.env.SMS_PROVIDER = 'http'; delete process.env.SMS_URL;
const C = (await init({ tribuneId: 1, qty: 1, phone: '60123456' })).b.transac_id; cp.next = 'ACCEPTED';
const rc = await form({ cpm_trans_id: C, cpm_site_id: '777' });
ok('passerelle SMS indisponible : vente et billet confirmés quand même, erreur notée', rc.status === 200 && cmd(C).statut === 'vendu' && store.billets.some(x => x.transac_id === C) && !!store.transactions.find(x => x._id === C).sms_erreur);
process.env.SMS_PROVIDER = 'console';

// 8. Pages billet
const ctx = p => ({ params: p });
const pb = await billetF(new Request('https://billets.test/b/' + T.lien), ctx({ code: T.lien })); const hb = await pb.text();
ok('/b/<code> : page avec les 2 QR codes (jetons) et le script QR local', pb.status === 200 && bil.every(x => hb.includes(x._id)) && hb.includes('/vendor/qr.js') && pb.headers.get('cache-control') === 'no-store');
const pc = await billetF(new Request('https://billets.test/commande/' + A), ctx({ id: A }));
ok('/commande/<id> payée : redirige vers le billet', pc.status === 302 && pc.headers.get('location') === '/b/' + T.lien);
const D = (await init({ tribuneId: 1, qty: 1, phone: '70112233' })).b.transac_id;
const pd = await billetF(new Request('https://billets.test/commande/' + D), ctx({ id: D }));
ok('/commande/<id> en attente : page qui se rafraîchit seule', (await pd.text()).includes('http-equiv="refresh"'));
ok('lien inconnu : message clair, sans erreur', (await (await billetF(new Request('https://billets.test/b/zzzz'), ctx({ code: 'zzzz' }))).text()).includes('Billet introuvable'));

// 9. Contrôle à l'entrée
const tok = bil[0]._id, v = (b, k) => post(validerF, '/api/cinetpay/valider', b, k ? { 'x-control-key': k } : {}).then(async x => ({ s: x.status, b: await x.json() }));
ok('valider sans clé de contrôle : 401', (await v({ token: tok })).s === 401 && (await v({ token: tok }, 'mauvaise')).s === 401);
ok('1er passage accepté', (await v({ token: tok }, 'cle-controle-test')).b.result === 'accepte');
ok('2e passage (même QR) : déjà utilisé', (await v({ token: tok }, 'cle-controle-test')).b.result === 'deja_utilise');
ok('jeton inventé : invalide', (await v({ token: 'A'.repeat(32) }, 'cle-controle-test')).b.result === 'invalide');
const two = await Promise.all([v({ token: bil[1]._id }, 'cle-controle-test'), v({ token: bil[1]._id }, 'cle-controle-test')]);
ok('2 contrôles simultanés du même billet : un seul accepté', two.filter(x => x.b.result === 'accepte').length === 1);

// 10. Expiration et paiement tardif
sdb.prepare(`UPDATE commandes SET expire_le='2000-01-01T00:00:00.000Z' WHERE transac_id=?`).run(D);
const enc = tr(1).en_cours; await cronF();
ok('tâche planifiée : réservation expirée libérée', cmd(D).statut === 'expire' && tr(1).en_cours === enc - 1 && store.transactions.find(x => x._id === D).statut === 'expiré');
cp.next = 'ACCEPTED'; await form({ cpm_trans_id: D, cpm_site_id: '777' });
ok('paiement arrivé après expiration, place encore libre : vente confirmée', cmd(D).statut === 'vendu' && store.billets.some(x => x.transac_id === D));
const E = (await init({ tribuneId: 3, qty: 2, phone: '70112233' })).b.transac_id;
sdb.prepare(`UPDATE commandes SET expire_le='2000-01-01T00:00:00.000Z' WHERE transac_id=?`).run(E); await cronF();
await init({ tribuneId: 3, qty: 2, phone: '70999888' });                      // quelqu'un d'autre prend les 2 places
await form({ cpm_trans_id: E, cpm_site_id: '777' });
ok('paiement tardif sans place disponible : « remboursement_du », aucun billet', cmd(E).statut === 'remboursement_du' && !(store.billets || []).some(x => x.transac_id === E) && store.transactions.find(x => x._id === E).statut === 'à rembourser');

// 11. Secrets
const everything = JSON.stringify([R, store, r, hb, sent.apikey ? '' : '']);
ok('la clé API CinetPay n\'apparaît dans aucune réponse, page ni base', !everything.includes(SECRET));
ok('CinetPay : la clé n\'est envoyée qu\'au serveur CinetPay (jamais dans la réponse)', sent.apikey === SECRET && !JSON.stringify(r).includes(SECRET));

fake.close(); console.log(R.join('\n') + `\n\n${R.length - fail}/${R.length} OK`); process.exit(fail ? 1 : 0);
