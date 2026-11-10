'use strict';
// Test de charge : lance un vrai serveur (processus séparé, paiement simulé) et simule une ruée à l'ouverture de la vente.
//   node deploy/loadtest.js                 (défauts : 600 places, 1800 acheteurs, 150 connexions simultanées)
//   BUYERS=3000 STOCK=1000 CONC=200 node deploy/loadtest.js
// Il vérifie surtout l'exactitude (aucune survente, un billet par place payée, un seul passage par billet),
// puis mesure les temps de réponse. Les temps dépendent de la machine : refaire le test sur le serveur réel.
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const STOCK = +process.env.STOCK || 600, BUYERS = +process.env.BUYERS || 1800, CONC = +process.env.CONC || 150;
const KEY = 'cle-test-de-charge-0123456789';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'load-'));
const dbFile = path.join(tmp, 'load.sqlite');

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const pct = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
async function pool(n, conc, fn) {
  const lat = [], res = new Array(n); let i = 0;
  await Promise.all(Array.from({ length: Math.min(conc, n) }, async () => {
    while (i < n) { const k = i++; const t = performance.now(); try { res[k] = await fn(k); } catch (e) { res[k] = { err: e.message }; } lat.push(performance.now() - t); }
  }));
  lat.sort((a, b) => a - b);
  return { res, lat, p50: pct(lat, .5), p95: pct(lat, .95), p99: pct(lat, .99), max: lat[lat.length - 1] };
}
const fmt = r => `p50 ${r.p50.toFixed(0)} ms · p95 ${r.p95.toFixed(0)} ms · p99 ${r.p99.toFixed(0)} ms · max ${r.max.toFixed(0)} ms`;

(async () => {
  const port = await freePort(), B = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DB_PATH: dbFile, ADMIN_KEY: KEY, PROVIDER_ORANGE: 'mock', PROVIDER_MOOV: 'mock', NODE_ENV: 'development', RATE_ORDERS_PER_10MIN: '1000000', SEED: '0' },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise((ok, ko) => { child.stdout.on('data', d => /E-Ticket sur/.test(d) && ok()); child.on('exit', c => ko(new Error('serveur arrêté ' + c))); setTimeout(() => ko(new Error('démarrage trop long')), 15000); });
  const api = (p, o = {}) => fetch(B + p, { redirect: 'manual', ...o, headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, ...(o.headers || {}) } });
  const out = [];
  const say = s => { console.log(s); out.push(s); };
  try {
    const ev = await (await api('/api/admin/events', { method: 'POST', body: JSON.stringify({ type: 'Football', titre: 'Test de charge', date: '2099-01-01T17:00', lieu: 'Stade', tribunes: [{ nom: 'Pelouse', prix: 1000, stock: STOCK }] }) })).json();
    const evs = await (await api('/api/events')).json();
    const e = evs.find(x => x.id === ev.id), tribuneId = e.tribunes[0].id;
    say(`Machine : ${os.cpus().length} cœur(s) ${os.cpus()[0].model.trim()} · ${(os.totalmem() / 2 ** 30).toFixed(1)} Go · Node ${process.version}`);
    say(`Scénario : ${BUYERS} acheteurs, ${CONC} connexions simultanées, ${STOCK} places en vente.\n`);

    const nav = await pool(3000, CONC, () => api('/api/events').then(r => r.status));
    say(`1. Consultation des affiches (3 000 requêtes)      ${fmt(nav)}  — erreurs : ${nav.res.filter(s => s !== 200).length}`);

    const rnd = k => 1 + ((k * 7919) % 2);                           // 1 ou 2 places, déterministe
    const buy = await pool(BUYERS, CONC, async k => {
      const phone = '7' + String(1000000 + k).padStart(7, '0');
      const r = await api('/api/orders', { method: 'POST', body: JSON.stringify({ eventId: e.id, tribuneId, qty: rnd(k), operator: 'orange', phone }) });
      const j = await r.json(); return { status: r.status, ref: j.ref, token: j.token, qty: rnd(k) };
    });
    const created = buy.res.filter(x => x.status === 201), full = buy.res.filter(x => x.status === 409), other = buy.res.filter(x => ![201, 409].includes(x.status));
    const reserved = created.reduce((a, x) => a + x.qty, 0);
    say(`2. Ruée : commandes avec réservation de places       ${fmt(buy)}`);
    say(`   acceptées ${created.length} (${reserved} places) · refusées « complet » ${full.length} · autres erreurs ${other.length}`);

    const pay = await pool(created.length, CONC, async k => (await api(`/sandbox/pay/${created[k].ref}/ok`, { method: 'POST' })).status);
    say(`3. Confirmation du paiement (${created.length} commandes)            ${fmt(pay)}  — échecs : ${pay.res.filter(s => s !== 302).length}`);

    const poll = await pool(2000, CONC, async k => (await api(`/api/orders/${created[k % created.length].ref}?token=${created[k % created.length].token}`)).status);
    say(`4. Suivi de commande par le navigateur (2 000)       ${fmt(poll)}  — erreurs : ${poll.res.filter(s => s !== 200).length}`);

    const db = new DatabaseSync(dbFile, { readOnly: true }); db.exec(`ATTACH DATABASE '${path.join(tmp, 'load.admin.sqlite')}' AS admin`);
    const tickets = db.prepare('SELECT code FROM tickets WHERE event_id=?').all(e.id).map(r => r.code);
    const stock = db.prepare('SELECT stock FROM tribunes WHERE id=?').get(tribuneId).stock;
    const paidQty = db.prepare("SELECT COALESCE(SUM(qty),0) q FROM orders WHERE event_id=? AND status='PAID'").get(e.id).q;
    const pending = db.prepare("SELECT COUNT(*) c FROM orders WHERE event_id=? AND status='PENDING'").get(e.id).c;
    const sample = tickets.slice(0, 200), TRIES = 5;
    const scan = await pool(sample.length * TRIES, CONC, async k => (await (await api('/api/admin/validate', { method: 'POST', body: JSON.stringify({ code: sample[k % sample.length] }) })).json()).result);
    const valid = scan.res.filter(r => r === 'valid').length, dup = scan.res.filter(r => r === 'already_used').length;
    say(`5. Contrôle aux bornes : ${sample.length} billets scannés ${TRIES} fois en parallèle   ${fmt(scan)}`);
    say(`   acceptés ${valid} · refusés « déjà utilisé » ${dup}\n`);

    const checks = [
      ['Aucune survente : places vendues ≤ places en vente', reserved <= STOCK && paidQty <= STOCK],
      ['Stock final = places en vente − places payées', stock === STOCK - paidQty],
      ['Un billet par place payée', tickets.length === paidQty],
      ['Aucune commande restée en attente', pending === 0],
      ['Aucune erreur inattendue à la commande', other.length === 0],
      ['Aucun échec de confirmation', pay.res.every(s => s === 302)],
      ['Chaque billet accepté une seule fois (5 scans simultanés)', valid === sample.length && dup === sample.length * (TRIES - 1)]
    ];
    for (const [n, ok] of checks) say(`${ok ? 'OK  ' : 'ÉCHEC'} ${n}`);
    const mem = Math.round(process.memoryUsage().rss / 2 ** 20);
    say(`\n(mémoire du générateur de charge : ${mem} Mo)`);
    child.kill('SIGTERM');
    fs.writeFileSync(path.join(tmp, 'rapport.txt'), out.join('\n'));
    if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, out.join('\n') + '\n');
    process.exit(checks.every(c => c[1]) ? 0 : 1);
  } catch (err) { console.error('ERREUR :', err.message); child.kill('SIGTERM'); process.exit(2); }
})();
