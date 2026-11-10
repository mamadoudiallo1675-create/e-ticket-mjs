'use strict';
// Tests de bout en bout : serveur réel + faux serveur Orange Money local (aucun appel externe).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eticket-'));
process.env.DB_PATH = path.join(tmp, 't.sqlite');
process.env.ADMIN_KEY = 'cle-test';
process.env.CONTROL_KEY = 'cle-borne';
process.env.PROVIDER_ORANGE = 'mock';
process.env.PROVIDER_MOOV = 'mock';
process.env.RATE_ORDERS_PER_10MIN = '1000';

const { server } = require('./server');
const store = require('./db');
const sms = require('./sms');
const { execFileSync } = require('child_process');

let base;
test.before(async () => { await new Promise(r => server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + server.address().port; });
test.after(() => { server.closeAllConnections(); server.close(); });

const j = (p, o = {}) => fetch(base + p, { ...o, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(o.headers || {}) }, body: o.body && JSON.stringify(o.body) }).then(async r => ({ s: r.status, b: await r.json().catch(() => null), r }));
const admin = { 'x-api-key': 'cle-test' };

async function order(qty = 2, tribuneIdx = 0, eventIdx = 0, phone = '70112233') {
  const ev = (await j('/api/events')).b[eventIdx];
  return { ev, res: await j('/api/orders', { method: 'POST', body: { eventId: ev.id, tribuneId: ev.tribunes[tribuneIdx].id, qty, operator: 'orange', phone } }) };
}
const stock = async (e, t) => (await j('/api/events')).b[e].tribunes[t].stock;

test('événements et config', async () => {
  const ev = await j('/api/events'); assert.equal(ev.s, 200); assert.equal(ev.b.length, 5);
  const c = await j('/api/config'); assert.equal(c.b.demo, true);
});

test('parcours complet : commande -> paiement simulé -> billets -> contrôle', async () => {
  const before = await stock(0, 0);
  const { res } = await order(2);
  assert.equal(res.s, 201); assert.match(res.b.ref, /^CMD-/); assert.match(res.b.payUrl, /\/sandbox\/pay\//);
  assert.equal(await stock(0, 0), before - 2, 'places réservées');

  let o = await j(`/api/orders/${res.b.ref}?token=${res.b.token}`);
  assert.equal(o.b.status, 'PENDING'); assert.equal(o.b.total, 2000); assert.equal(o.b.tickets.length, 0);
  assert.equal((await j(`/api/orders/${res.b.ref}?token=mauvais`)).s, 404, 'mauvais jeton refusé');

  const pay = await fetch(base + `/sandbox/pay/${res.b.ref}/ok`, { method: 'POST', redirect: 'manual' });
  assert.equal(pay.status, 302);
  o = await j(`/api/orders/${res.b.ref}?token=${res.b.token}`);
  assert.equal(o.b.status, 'PAID'); assert.equal(o.b.tickets.length, 2);

  // idempotence : rejouer le succès ne crée pas de billets en plus
  store.settle(res.b.ref, 'SUCCESS', 'X');
  assert.equal((await j(`/api/orders/${res.b.ref}?token=${res.b.token}`)).b.tickets.length, 2);

  const code = o.b.tickets[0].code;
  assert.equal((await j('/api/admin/validate', { method: 'POST', body: { code } })).s, 401, 'clé requise');
  assert.equal((await j('/api/admin/validate', { method: 'POST', headers: admin, body: { code } })).b.result, 'valid');
  assert.equal((await j('/api/admin/validate', { method: 'POST', headers: admin, body: { code } })).b.result, 'already_used', 'double passage refusé');
  assert.equal((await j('/api/admin/validate', { method: 'POST', headers: admin, body: { code: 'ML-AAAA-BBBB-CCCC' } })).b.result, 'invalid');
  assert.equal((await j('/api/admin/validate', { method: 'POST', headers: admin, body: { code: o.b.tickets[1].code, eventId: 999 } })).b.result, 'wrong_event');
});

test('échec de paiement libère les places', async () => {
  const before = await stock(1, 0);
  const { res } = await order(3, 0, 1, '70223344');
  assert.equal(await stock(1, 0), before - 3);
  await fetch(base + `/sandbox/pay/${res.b.ref}/fail`, { method: 'POST', redirect: 'manual' });
  assert.equal((await j(`/api/orders/${res.b.ref}?token=${res.b.token}`)).b.status, 'FAILED');
  assert.equal(await stock(1, 0), before);
});

test('pas de survente ; tribune complète refusée', async () => {
  const { res } = await order(1, 2, 2, '70334455');   // Finale (3e événement par date), tribune d'honneur : stock 0
  assert.equal(res.s, 409);
  const ev = (await j('/api/events')).b[2];
  const big = await j('/api/orders', { method: 'POST', body: { eventId: ev.id, tribuneId: ev.tribunes[1].id, qty: 7, operator: 'orange', phone: '70445566' } });
  assert.equal(big.s, 400);
});

test('validation des entrées', async () => {
  const ev = (await j('/api/events')).b[0];
  const bad = b => j('/api/orders', { method: 'POST', body: { eventId: ev.id, tribuneId: ev.tribunes[0].id, qty: 1, operator: 'orange', phone: '70112233', ...b } });
  assert.equal((await bad({ phone: '123' })).s, 400);
  assert.equal((await bad({ operator: 'paypal' })).s, 400);
  assert.equal((await bad({ qty: 0 })).s, 400);
  assert.equal((await bad({ qty: '1; DROP TABLE' })).s, 400);
  assert.equal((await bad({ tribuneId: ev.tribunes[0].id + 999 })).s, 404);
  assert.equal((await bad({ phone: '+223 70 11 22 33', qty: 1 })).s, 201, 'indicatif +223 accepté');
});

test('expiration des commandes en attente', async () => {
  const before = await stock(3, 0);
  const { res } = await order(2, 0, 3, '70556677');
  assert.equal(await stock(3, 0), before - 2);
  store.db.prepare('UPDATE orders SET created_at=? WHERE ref=?').run(Date.now() - 3600000, res.b.ref);
  assert.ok(store.expirePending(15 * 60000) >= 1);
  assert.equal(await stock(3, 0), before);
  assert.equal(store.getOrder(res.b.ref).status, 'EXPIRED');
  // paiement tardif sur commande expirée : places re-réservées, billets émis
  store.settle(res.b.ref, 'SUCCESS', 'LATE');
  assert.equal(store.getOrder(res.b.ref).status, 'PAID');
  assert.equal(await stock(3, 0), before - 2);
});

test('administration : création d\'événement et statistiques', async () => {
  assert.equal((await j('/api/admin/stats')).s, 401);
  const c = await j('/api/admin/events', { method: 'POST', headers: admin, body: { type: 'Football', titre: 'Test', date: '2027-03-01T16:00', lieu: 'Kayes', tribunes: [{ nom: 'Pelouse', prix: 1000, stock: 50 }] } });
  assert.equal(c.s, 201);
  assert.equal((await j('/api/events')).b.length, 6);
  assert.ok((await j('/api/admin/stats', { headers: admin })).b.length > 0);
});

test('support et fichiers statiques', async () => {
  assert.equal((await j('/api/support', { method: 'POST', body: { message: 'Bonjour' } })).s, 201);
  assert.equal((await j('/api/support', { method: 'POST', body: { message: '  ' } })).s, 400);
  const home = await fetch(base + '/'); assert.equal(home.status, 200); assert.match(await home.text(), /E-Ticket/);
  assert.equal((await fetch(base + '/..%2fserver.js')).status === 200, false, 'pas de traversée de répertoire');
  assert.equal((await fetch(base + '/%2e%2e/server.js')).status === 200, false);
});

// ---- Adaptateur Orange Money face à un faux serveur respectant le flux documenté ----
test('adaptateur Orange Money (faux serveur local)', async (t) => {
  const seen = { webpayment: null, statusCalls: 0 };
  let txStatus = 'INITIATED';
  const fake = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      const out = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/oauth/v3/token') return out(200, { token_type: 'Bearer', access_token: 'tok123', expires_in: '3600' });
      if (req.headers.authorization !== 'Bearer tok123') return out(401, {});
      const body = JSON.parse(raw || '{}');
      if (req.url.endsWith('/webpayment')) { seen.webpayment = body; return out(201, { status: 201, message: 'OK', pay_token: 'PT-' + body.order_id, payment_url: 'https://pay.example/' + body.order_id, notif_token: 'NT-' + body.order_id }); }
      if (req.url.endsWith('/transactionstatus')) { seen.statusCalls++; return out(200, { status: txStatus, order_id: body.order_id, txnid: 'MP.1' }); }
      out(404, {});
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  t.after(() => { fake.closeAllConnections(); fake.close(); });
  const fp = fake.address().port;
  Object.assign(process.env, { PROVIDER_ORANGE: 'live', OM_BASE_URL: `http://127.0.0.1:${fp}`, OM_OAUTH_URL: `http://127.0.0.1:${fp}/oauth/v3/token`, OM_AUTH_HEADER: 'Basic abc', OM_MERCHANT_KEY: 'mk', OM_COUNTRY: 'dev', OM_CURRENCY: 'OUV' });

  const { res } = await order(1, 0, 0, '70778899');
  assert.equal(res.s, 201); assert.equal(res.b.payUrl.startsWith('https://pay.example/CMD-'), true);
  assert.equal(seen.webpayment.amount, 1000); assert.equal(seen.webpayment.currency, 'OUV'); assert.match(seen.webpayment.notif_url, /\/api\/webhooks\/orange$/);

  // webhook avec faux jeton : ignoré
  await j('/api/webhooks/orange', { method: 'POST', body: { status: 'SUCCESS', notif_token: 'NT-faux' } });
  assert.equal(store.getOrder(res.b.ref).status, 'PENDING');
  // webhook "SUCCESS" mais l'opérateur répond encore INITIATED : on ne fait pas confiance au webhook
  await j('/api/webhooks/orange', { method: 'POST', body: { status: 'SUCCESS', notif_token: 'NT-' + res.b.ref } });
  assert.equal(store.getOrder(res.b.ref).status, 'PENDING', 'webhook seul ne valide pas');
  // l'opérateur confirme
  txStatus = 'SUCCESS';
  await j('/api/webhooks/orange', { method: 'POST', body: { status: 'SUCCESS', notif_token: 'NT-' + res.b.ref } });
  assert.equal(store.getOrder(res.b.ref).status, 'PAID');
  assert.equal(store.ticketsOf(store.getOrder(res.b.ref).id).length, 1);

  // Moov en mode live : non configuré -> refusé proprement
  process.env.PROVIDER_MOOV = 'live';
  const ev = (await j('/api/events')).b[0];
  const m = await j('/api/orders', { method: 'POST', body: { eventId: ev.id, tribuneId: ev.tribunes[0].id, qty: 1, operator: 'moov', phone: '70999999' } });
  assert.equal(m.s, 400);

  // opérateur en panne : places libérées
  const before = await stock(0, 0);
  fake.closeAllConnections(); fake.close();
  const down = await order(1, 0, 0, '70121212');
  assert.equal(down.res.s, 502);
  assert.equal(await stock(0, 0), before);
});

// ======== Phase 2 : SMS, bornes, gestion des événements, import ========
test('récupération des billets par SMS', async () => {
  process.env.PROVIDER_ORANGE = 'mock'; process.env.PROVIDER_MOOV = 'mock';   // le test précédent avait basculé Orange en mode réel
  sms.outbox.length = 0;
  const unknown = await j('/api/recover/request', { method: 'POST', body: { phone: '70000000' } });
  const known = await j('/api/recover/request', { method: 'POST', body: { phone: '70112233' } });
  assert.equal(unknown.s, 200); assert.equal(known.s, 200);
  assert.deepEqual(unknown.b, known.b, 'réponse identique : aucune fuite sur l\'existence de commandes');
  assert.equal(sms.outbox.length, 1, 'SMS envoyé seulement au numéro qui a des commandes');
  assert.equal(sms.outbox[0].to, '+22370112233');
  const code = sms.outbox[0].message.match(/\b(\d{6})\b/)[1];
  // anti-abus : 1 SMS / minute / numéro, pour tout numéro
  assert.equal((await j('/api/recover/request', { method: 'POST', body: { phone: '70112233' } })).s, 429);
  assert.equal((await j('/api/recover/request', { method: 'POST', body: { phone: '70000000' } })).s, 429);

  const wrong = code === '000000' ? '111111' : '000000';
  assert.equal((await j('/api/recover/verify', { method: 'POST', body: { phone: '70112233', code: wrong } })).s, 400);
  const ok = await j('/api/recover/verify', { method: 'POST', body: { phone: '70112233', code } });
  assert.equal(ok.s, 200); assert.ok(ok.b.session.length >= 32);
  assert.equal((await j('/api/recover/verify', { method: 'POST', body: { phone: '70112233', code } })).s, 400, 'code à usage unique');

  const mine = await j('/api/my/orders', { headers: { Authorization: 'Bearer ' + ok.b.session } });
  assert.equal(mine.s, 200);
  const paid = mine.b.find(o => o.status === 'PAID');
  assert.ok(paid && paid.tickets.length === 2, 'billets récupérés');
  assert.equal(paid.phone, '70****33');
  assert.equal((await j('/api/my/orders', { headers: { Authorization: 'Bearer ' + 'a'.repeat(64) } })).s, 401);
  assert.equal((await j('/api/my/orders')).s, 401);
});

test('code SMS : 5 essais maximum', async () => {
  const phone = '70555555';
  const { res } = await order(1, 0, 0, phone);
  store.settle(res.b.ref, 'SUCCESS', 'T');
  const code = store.createOtp(phone);
  for (let i = 0; i < 5; i++) assert.equal((await j('/api/recover/verify', { method: 'POST', body: { phone, code: '999999' === code ? '888888' : '999999' } })).s, 400);
  assert.equal((await j('/api/recover/verify', { method: 'POST', body: { phone, code } })).s, 400, 'bon code refusé après 5 échecs');
});

test('bornes : clé de contrôle limitée, vérification sans consommer', async () => {
  const { res } = await order(1, 0, 0, '70666666');
  store.settle(res.b.ref, 'SUCCESS', 'T');
  const o = (await j(`/api/orders/${res.b.ref}?token=${res.b.token}`)).b;
  const code = o.tickets[0].code, ctl = { 'x-api-key': 'cle-borne' };
  const v = (body, h = ctl) => j('/api/admin/validate', { method: 'POST', headers: h, body });
  assert.equal((await v({ code, eventId: o.event.id, consume: false })).b.result, 'valid');
  assert.equal((await v({ code, eventId: o.event.id, consume: false })).b.result, 'valid', 'toujours utilisable après simple vérification');
  assert.equal((await v({ code, eventId: o.event.id })).b.consumed, true);
  assert.equal((await v({ code, eventId: o.event.id })).b.result, 'already_used');
  assert.equal((await v({ code }, { 'x-api-key': 'faux' })).s, 401);
  assert.equal((await j('/api/admin/stats', { headers: ctl })).s, 401, 'la clé des bornes ne donne pas accès à l\'administration');
  assert.equal((await j('/api/admin/events', { method: 'POST', headers: ctl, body: {} })).s, 401);
});

test('événement sans tarif puis ouverture de la billetterie', async () => {
  const c = await j('/api/admin/events', { method: 'POST', headers: admin, body: { type: 'Football', titre: 'Mali – Test', adv: 'x', date: '2027-05-01T17:00', lieu: 'Stade', heureConfirmee: false } });
  assert.equal(c.s, 201);
  let ev = (await j('/api/events')).b.find(e => e.id === c.b.id);
  assert.deepEqual(ev.tribunes, []); assert.equal(ev.heure_confirmee, 0);
  assert.equal((await j('/api/orders', { method: 'POST', body: { eventId: ev.id, tribuneId: 1, qty: 1, operator: 'orange', phone: '70777777' } })).s, 404);
  assert.equal((await j('/api/admin/events/' + ev.id + '/tribunes', { method: 'POST', headers: admin, body: { tribunes: [{ nom: 'Pelouse', prix: 1500, stock: 100 }] } })).s, 201);
  assert.equal((await j('/api/admin/events/' + ev.id, { method: 'POST', headers: admin, body: { heureConfirmee: true, date: '2027-05-01T19:00' } })).s, 200);
  ev = (await j('/api/events')).b.find(e => e.id === c.b.id);
  assert.equal(ev.heure_confirmee, 1); assert.equal(ev.date, '2027-05-01T19:00'); assert.equal(ev.tribunes[0].prix, 1500);
  assert.equal((await j('/api/admin/tribunes/' + ev.tribunes[0].id, { method: 'POST', headers: admin, body: { stock: 80, prix: 2000 } })).s, 200);
  assert.equal((await j('/api/events')).b.find(e => e.id === c.b.id).tribunes[0].stock, 80);
  assert.equal((await j('/api/admin/tribunes/99999', { method: 'POST', headers: admin, body: { stock: 1 } })).s, 404);
  assert.equal((await j('/api/admin/tribunes/' + ev.tribunes[0].id, { method: 'POST', headers: admin, body: { prix: 5 } })).s, 400, 'prix minimum');
});

test('import des événements réels + aucune donnée de démo en production', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'));
  const env = { ...process.env, DB_PATH: path.join(dir, 'p.sqlite'), NODE_ENV: 'production' };
  const run = a => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', ...a], { cwd: __dirname, env }).toString();
  assert.match(run(['deploy/import-events.js']), /2 ajouté\(s\), 0 déjà/);
  assert.match(run(['deploy/import-events.js']), /0 ajouté\(s\), 2 déjà/);
  assert.equal(run(['-e', "console.log(require('./db').db.prepare('SELECT COUNT(*) c FROM events').get().c)"]).trim(), '2');
  assert.match(run(['-e', "console.log(JSON.stringify(require('./db').db.prepare('SELECT titre,lieu FROM events ORDER BY date').all()))"]), /Mali – Rwanda.*Stade du 26 Mars/);
});

test('santé et sauvegarde', async () => {
  assert.equal((await j('/healthz')).b.ok, true);
  const f = path.join(tmp, 'backup.sqlite');
  store.backupTo(f);
  assert.ok(fs.statSync(f).size > 1000);
});

test('espace administrateur : liste, remboursements, support', async () => {
  assert.equal((await j('/api/admin/events')).s, 401);
  assert.equal((await j('/api/admin/events', { headers: { 'x-api-key': 'cle-borne' } })).s, 401, 'clé des bornes refusée');
  const list = (await j('/api/admin/events', { headers: admin })).b;
  assert.ok(list.length >= 5);
  const e0 = list.find(e => e.vendus > 0);
  assert.ok(e0 && e0.recette > 0 && e0.tribunes[0].vendus >= 0, 'ventes et recettes par événement');
  assert.ok(list.some(e => e.entres > 0), 'entrées contrôlées comptées');
  // remboursement dû : paiement tardif sans places
  const { res } = await order(1, 0, 0, '70818181');
  store.settle(res.b.ref, 'EXPIRED');
  store.db.prepare('UPDATE tribunes SET stock=0 WHERE id=(SELECT tribune_id FROM orders WHERE ref=?)').run(res.b.ref);
  store.settle(res.b.ref, 'SUCCESS', 'TX-LATE');
  assert.equal(store.getOrder(res.b.ref).status, 'REFUND_DUE');
  const due = (await j('/api/admin/refunds', { headers: admin })).b;
  assert.ok(due.some(r => r.ref === res.b.ref && r.provider_txn === 'TX-LATE'));
  assert.equal((await j(`/api/admin/orders/${res.b.ref}/refunded`, { method: 'POST', headers: admin })).s, 200);
  assert.equal((await j(`/api/admin/orders/${res.b.ref}/refunded`, { method: 'POST', headers: admin })).s, 404, 'pas de double marquage');
  assert.ok(!(await j('/api/admin/refunds', { headers: admin })).b.some(r => r.ref === res.b.ref));
  assert.ok((await j('/api/admin/support', { headers: admin })).b.length >= 1);
  assert.equal((await j('/admin.html')).s, 200);
});

test("journal des actions d'administration", async () => {
  const before = store.auditList().length;
  const ev = (await j('/api/admin/events', { method: 'POST', headers: admin, body: { type: 'Football', titre: 'Audit', date: '2027-06-01T17:00', lieu: 'Stade', tribunes: [{ nom: 'P', prix: 1000, stock: 10 }] } })).b.id;
  const list = (await j('/api/admin/events', { headers: admin })).b.find(e => e.id === ev);
  await j('/api/admin/tribunes/' + list.tribunes[0].id, { method: 'POST', headers: admin, body: { prix: 1500, stock: 7 } });
  await j('/api/admin/events/' + ev, { method: 'POST', headers: admin, body: { lieu: 'Autre stade' } });
  await j('/api/admin/events/' + ev + '/tribunes', { method: 'POST', headers: admin, body: { tribunes: [{ nom: 'Q', prix: 2000, stock: 5 }] } });
  const log = (await j('/api/admin/audit', { headers: admin })).b;
  assert.equal(log.length - before, 4, 'création, prix/stock, lieu, ajout de tribune');
  assert.deepEqual(log.slice(0, 4).map(a => a.action).reverse(), ['event.create', 'tribune.update', 'event.update', 'tribune.add']);
  assert.match(log.find(a => a.action === 'tribune.update').detail, /prix 1000 → 1500 · places 10 → 7/);
  assert.ok(log.every(a => /clé [0-9a-f]{8}$/.test(a.actor) && !a.actor.includes('cle-test')), 'la clé elle-même n\'est jamais écrite');
  assert.equal((await j('/api/admin/audit')).s, 401);
  assert.equal((await j('/api/admin/audit', { headers: { 'x-api-key': 'cle-borne' } })).s, 401);
  assert.throws(() => store.db.prepare('DELETE FROM admin_log').run(), /lecture seule/);
  assert.throws(() => store.db.prepare("UPDATE admin_log SET detail='x'").run(), /lecture seule/);
});

test('QR local : page servie sans dépendance externe', async () => {
  const home = await (await fetch(base + '/')).text();
  assert.ok(!/cdnjs|jsdelivr|unpkg/.test(home), 'aucune ressource externe');
  const qr = await fetch(base + '/vendor/qr.js'); assert.equal(qr.status, 200);
  const QR = require('./public/vendor/qr.js');
  assert.match(QR.svg('ML-ABCD-EFGH-JKLM'), /^<svg[\s\S]*<path d="M/);
  assert.equal(QR.matrix('ML-ABCD-EFGH-JKLM').length, 25, 'version 2');
  assert.throws(() => QR.matrix('x'.repeat(43)), /trop long/);
  const csp = (await fetch(base + '/')).headers.get('content-security-policy');
  assert.ok(!csp.includes('cdnjs'));
});

test('production : refuse de démarrer sans textes juridiques validés', () => {
  const { spawnSync } = require('child_process');
  const env = { ...process.env, NODE_ENV: 'production', BASE_URL: 'https://billets.exemple.ml', ADMIN_KEY: 'a'.repeat(30), CONTROL_KEY: 'b'.repeat(20), PROVIDER_ORANGE: 'live', ORANGE_MERCHANT_KEY: 'x', ORANGE_AUTH_HEADER: 'Basic x', PORT: '0', DB_PATH: require('os').tmpdir() + '/pf-' + Date.now() + '.sqlite' };
  delete env.LEGAL_VALIDATED;
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', require('path').join(__dirname, 'server.js')], { env, encoding: 'utf8', timeout: 8000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /textes|LEGAL_VALIDATED|compléter/);
});
test('pages juridiques servies et /api/config expose legalValidated', async () => {
  for (const f of ['/conditions.html', '/confidentialite.html']) { const r = await fetch(base + f); assert.equal(r.status, 200); assert.match(await r.text(), /Projet non validé/); }
  const c = await j('/api/config'); assert.equal(c.b.legalValidated, false);
});

// ---- CinetPay : faux serveur local, aucun appel externe ----
test('CinetPay est proposé aux utilisateurs avec Orange Money et Moov Money ; ENABLE_CINETPAY=0 le masque', async () => {
  const c = await j('/api/config'); const ids = c.b.operators.map(o => o.id);
  assert.ok(ids.includes('cinetpay') && ids.includes('orange') && ids.includes('moov'), ids.join(','));
  process.env.ENABLE_CINETPAY = '0';
  try {
    const c2 = await j('/api/config'); assert.ok(!c2.b.operators.some(o => o.id === 'cinetpay'));
    const r = await j('/api/orders', { method: 'POST', body: { eventId: 1, tribuneId: 1, qty: 1, operator: 'cinetpay', phone: '70112233' } });
    assert.ok(r.s >= 400, 'commande CinetPay refusée quand masqué : ' + r.s);
  } finally { delete process.env.ENABLE_CINETPAY; }
});

test('Adaptateur CinetPay : devis du panier côté serveur, paiement ACCEPTED, montant vérifié, notification non crue', async () => {
  const calls = [];
  let status = 'WAITING_FOR_CUSTOMER', amount = null;
  const fake = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      const j = JSON.parse(b || '{}'); calls.push({ url: req.url, j }); res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v2/payment') return res.end(JSON.stringify({ code: '201', message: 'CREATED', data: { payment_url: 'https://checkout.example/pay/' + j.transaction_id, payment_token: 'tok-' + j.transaction_id } }));
      if (req.url === '/v2/payment/check') return res.end(JSON.stringify({ code: '00', message: 'SUCCES', data: { status, amount: amount ?? 0, currency: 'XOF' } }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  Object.assign(process.env, { PROVIDER_CINETPAY: 'live', CINETPAY_API_KEY: 'k-secret', CINETPAY_SITE_ID: '123', CINETPAY_BASE_URL: `http://127.0.0.1:${fake.address().port}/v2` });
  try {
    const evs = (await j('/api/events')).b;
    const ev = evs.find(e => e.tribunes.some(t => t.stock >= 5)), tr = ev.tribunes.find(t => t.stock >= 5);
    // devis : le client n'envoie aucun prix, le serveur calcule
    const q = await j('/api/cart/quote', { method: 'POST', body: { eventId: ev.id, tribuneId: tr.id, qty: 2, prix: 5 } });
    assert.equal(q.s, 200); assert.equal(q.b.amount, tr.prix * 2); assert.equal(q.b.currency, 'XOF');
    const cfg = await j('/api/config'); assert.ok(cfg.b.operators.find(o => o.id === 'cinetpay' && o.enabled));
    const o = await j('/api/orders', { method: 'POST', body: { eventId: ev.id, tribuneId: tr.id, qty: 2, operator: 'cinetpay', phone: '70999888' } });
    assert.equal(o.s, 201); assert.match(o.b.payUrl, /^https:\/\/checkout\.example\/pay\/CMD-/);
    const init = calls.find(c => c.url === '/v2/payment').j;
    assert.equal(init.amount, tr.prix * 2); assert.equal(init.currency, 'XOF'); assert.equal(init.apikey, 'k-secret');
    assert.equal(init.transaction_id, o.b.ref); assert.match(init.notify_url, /\/api\/webhooks\/cinetpay$/);
    assert.ok(!JSON.stringify(o.b).includes('k-secret'), 'la clé API ne doit jamais atteindre le navigateur');
    // notification truquée alors que CinetPay dit « en attente » -> rien ne change
    const wh = (ref) => fetch(base + '/api/webhooks/cinetpay', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'cpm_trans_id=' + ref + '&cpm_error_message=SUCCES' });
    assert.equal((await wh(o.b.ref)).status, 200);
    assert.equal((await j(`/api/orders/${o.b.ref}?token=${o.b.token}`)).b.status, 'PENDING');
    // CinetPay accepte mais pour un montant inférieur -> refusé
    status = 'ACCEPTED'; amount = tr.prix;
    await wh(o.b.ref);
    assert.equal((await j(`/api/orders/${o.b.ref}?token=${o.b.token}`)).b.status, 'FAILED');
    // paiement correct
    const o2 = await j('/api/orders', { method: 'POST', body: { eventId: ev.id, tribuneId: tr.id, qty: 1, operator: 'cinetpay', phone: '70999777' } });
    amount = tr.prix; await wh(o2.b.ref);
    const f = (await j(`/api/orders/${o2.b.ref}?token=${o2.b.token}`)).b;
    assert.equal(f.status, 'PAID'); assert.equal(f.tickets.length, 1);
    assert.equal((await fetch(base + '/api/webhooks/cinetpay')).status, 200);   // test de disponibilité en GET
  } finally {
    Object.assign(process.env, { PROVIDER_CINETPAY: 'mock' }); delete process.env.CINETPAY_BASE_URL; fake.close();
  }
});

test('connexion du personnel : clés par défaut en développement, rôle renvoyé, mauvaise clé refusée', async () => {
  const r1 = await j('/api/staff/login', { method: 'POST', body: { key: 'cle-test' } });
  assert.equal(r1.s, 200); assert.equal(r1.b.role, 'admin');
  const r2 = await j('/api/staff/login', { method: 'POST', body: { key: 'cle-borne' } });
  assert.equal(r2.b.role, 'control');
  const r3 = await j('/api/staff/login', { method: 'POST', body: { key: 'nimporte' } });
  assert.equal(r3.s, 401);
});
test('production : refuse les clés par défaut de développement', () => {
  const { spawnSync } = require('child_process');
  const env = { ...process.env, NODE_ENV: 'production', BASE_URL: 'https://billets.exemple.ml', ADMIN_KEY: 'admin-eticket-2026-xxxxxxxxxxxx', CONTROL_KEY: 'controle-eticket-2026', PROVIDER_ORANGE: 'live', OM_MERCHANT_KEY: 'x', OM_AUTH_HEADER: 'Basic x', LEGAL_VALIDATED: '1', PORT: '0', DB_PATH: require('os').tmpdir() + '/pf2-' + Date.now() + '.sqlite' };
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', require('path').join(__dirname, 'server.js')], { env, encoding: 'utf8', timeout: 8000 });
  assert.notEqual(r.status, 0); assert.match(r.stderr + r.stdout, /clé par défaut/);
});
