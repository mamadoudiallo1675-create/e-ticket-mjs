'use strict';
/* E-Ticket Mali — lien « Autres affiches » ↔ « Affiches à l'honneur » : un événement annoncé sans tribune reste dans « Autres affiches » ;
   dès que l'administrateur ouvre la billetterie (ajout d'une tribune), il passe tout seul, en direct, dans « Affiches à l'honneur ». */
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..'), PORT = 3399, B = `http://localhost:${PORT}`, AK = 'cle-admin-demo';
Object.assign(process.env, { PORT: String(PORT), DB_PATH: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lien-')), 'd.sqlite'), ADMIN_KEY: AK, CONTROL_KEY: 'cle-borne-demo', NODE_ENV: 'development', PROVIDER_CINETPAY: 'off', PROVIDER_ORANGE: 'off', PROVIDER_MOOV: 'off', SMS_PROVIDER: 'console' });
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'OK   ' : 'ÉCHEC ') + n + (x ? ' — ' + x : '')); console.log(out[out.length - 1]); };
const J = async (m, u, b) => { const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json', 'x-api-key': AK }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
(async () => {
  const { server } = require(path.join(ROOT, 'server.js')); await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const { chromium } = require('playwright'), br = await chromium.launch(), errors = [];
  const p = await (await br.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', e => errors.push(e.message));
  const cfg = (await J('GET', '/api/config')).j, evs = (await J('GET', '/api/events')).j, used = new Set(evs.map(e => e.sport));
  const sp = cfg.sports.find(s => !used.has(s.id)); ok('un sport sans affiche existe pour le test', !!sp, sp && sp.id);
  const futur = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 16);
  const c = await J('POST', '/api/admin/events', { type: sp.nom, sport: sp.id, titre: 'Tournoi test', adv: 'Finale', date: futur, lieu: 'Lieu à renseigner', tribunes: [] });
  ok('événement annoncé créé SANS tribune', c.s === 201, JSON.stringify(c.j));
  await p.goto(B + '/'); await p.waitForSelector('.sport-card');
  const inAutres = () => p.$$eval(`.sport-card[data-sport="${sp.id}"]`, l => l.length), inHonneur = () => p.$$eval('article.card', (l, t) => l.filter(a => a.textContent.includes(t)).length, 'Tournoi test');
  ok('sans billetterie : l\'événement est dans « Autres affiches » (avec son titre)', (await inAutres()) === 1 && /Tournoi test/.test(await p.textContent(`.sport-card[data-sport="${sp.id}"]`)));
  ok('sans billetterie : il n\'est PAS dans « Affiches à l\'honneur »', (await inHonneur()) === 0);
  ok('sans billetterie : pas de puce de filtre pour ce sport', (await p.$$eval('#filtres .chip', (l, n) => l.filter(x => x.textContent.includes(n)).length, sp.nom)) === 0);
  // ouverture de la billetterie → déplacement automatique, sans recharger la page
  const t = await J('POST', `/api/admin/events/${c.j.id}/tribunes`, { tribunes: [{ nom: 'Tribune test', prix: 1000, stock: 50 }] });
  ok('l\'administrateur ouvre la billetterie (ajout d\'une tribune)', t.s === 200 || t.s === 201, t.s + '');
  await p.waitForFunction(t => [...document.querySelectorAll('article.card')].some(a => a.textContent.includes(t)), 'Tournoi test', { timeout: 8000 }).then(() => ok('billetterie ouverte : l\'affiche apparaît en direct dans « Affiches à l\'honneur »', true), () => ok('billetterie ouverte : l\'affiche apparaît en direct dans « Affiches à l\'honneur »', false));
  ok('billetterie ouverte : elle a quitté « Autres affiches »', (await inAutres()) === 0);
  ok('billetterie ouverte : bouton « Réserver » actif', await p.$$eval('article.card', l => l.some(a => a.textContent.includes('Tournoi test') && /Réserver/.test(a.querySelector('button.btn').textContent) && !a.querySelector('button.btn').disabled)));
  ok('billetterie ouverte : la puce de filtre du sport apparaît', (await p.$$eval('#filtres .chip', (l, n) => l.filter(x => x.textContent.includes(n)).length, sp.nom)) === 1);
  const tot = (await J('GET', '/api/events')).j, nOpen = tot.filter(e => e.tribunes.length).length;
  ok('chaque affiche ouverte est dans « à l\'honneur », chaque autre sport dans « Autres »', (await p.$$eval('article.card', l => l.length)) === nOpen && (await p.$$eval('.sport-card', l => l.length)) + new Set(tot.filter(e => e.tribunes.length).map(e => e.sport)).size === cfg.sports.length);
  ok('aucune erreur JavaScript', errors.length === 0, errors.join('|'));
  await br.close(); server.closeAllConnections(); server.close();
  fs.writeFileSync(path.join(__dirname, 'rapport-affiches-liens.txt'), out.join('\n') + `\n\n${pass} réussis, ${fail} échecs\n`);
  console.log(`\n${pass} réussis, ${fail} échecs`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
