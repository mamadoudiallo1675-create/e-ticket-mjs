'use strict';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
/* Teste la liaison page ↔ serveur « comme en situation réelle » : recherche automatique du serveur, vérification (/healthz),
   voyant « Serveur connecté », connexion du personnel, navigation entre onglets, serveur absent puis démarré, port inhabituel,
   pages servies par un AUTRE serveur local (ex. extension « Live Server »).   Lancer : node tests/test-connexion-reseau.js */
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const PUB = path.join(__dirname, '..', 'public'), CAP = path.join(__dirname, 'captures-reseau'); fs.mkdirSync(CAP, { recursive: true });
Object.assign(process.env, { PORT: '3000', DB_PATH: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'net-')), 'd.sqlite'), NODE_ENV: 'development', PROVIDER_ORANGE: 'mock', PROVIDER_MOOV: 'mock', PROVIDER_CINETPAY: 'mock', SMS_PROVIDER: 'console' });
delete process.env.ADMIN_KEY; delete process.env.CONTROL_KEY; process.env.KEYS_FILE = 'none';               // → clés par défaut de développement
const out = []; let ko = 0; const ok = (n, c, x) => { if (!c) ko++; out.push((c ? 'OK    ' : 'ÉCHEC ') + n + (x ? ' — ' + x : '')); };
const listen = (srv, port) => new Promise((r, j) => { srv.once('error', j); srv.listen(port, '127.0.0.1', r); });
const stop = srv => new Promise(r => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(r); });
(async () => {
  const { server } = require('../server.js'), { chromium } = require('playwright');
  const browser = await chromium.launch(), errors = [];
  const newPage = async ctx => { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); return p; };
  const state = p => p.evaluate(() => document.querySelector('#srv') && document.querySelector('#srv').dataset.s);
  const login = async (p, key) => { await p.click('#staff-btn'); await p.fill('#staff-key', key); await p.click('#staff-ok'); };

  // A. servi par le serveur lui-même
  await listen(server, 3000);
  let ctx = await browser.newContext({ userAgent: WIN_UA, viewport: { width: 1280, height: 800 } }), p = await newPage(ctx);
  await p.goto('http://localhost:3000/'); await p.waitForFunction(() => document.querySelector('#srv') && document.querySelector('#srv').dataset.s === 'ok');
  ok('A. page servie par le serveur : voyant « Serveur connecté »', /connecté/.test(await p.textContent('#srv')), (await p.textContent('#srv')).trim());
  await login(p, 'admin-eticket-2026'); await p.waitForFunction(() => /administrateur/.test(document.querySelector('#staff-btn').textContent));
  ok('A. connexion avec la clé administrateur par défaut', true);
  await p.screenshot({ path: path.join(CAP, '1-connecte.png') });
  await p.click('.site-menu a[data-k="/admin.html"]'); await p.waitForSelector('[data-ev]'); ok('A. Accueil → Admin sans nouvelle saisie', true);
  await p.click('.site-menu a[data-k="/controle.html"]'); await p.waitForSelector('#s-setup:not(.hidden)'); ok('A. Admin → Contrôle sans nouvelle saisie', true);
  await p.click('.site-menu a[data-k="tab:accueil"]'); await p.waitForSelector('article.card'); ok('A. Contrôle → Accueil : les affiches s\'affichent', true);
  await ctx.close();

  // B. page ouverte par double-clic (file://), serveur sur le port habituel
  ctx = await browser.newContext({ userAgent: WIN_UA, viewport: { width: 1280, height: 800 } }); p = await newPage(ctx);
  await p.goto('file://' + path.join(PUB, 'index.html')); await p.waitForFunction(() => document.querySelector('#srv') && document.querySelector('#srv').dataset.s === 'ok');
  ok('B. file:// : serveur trouvé automatiquement (localhost:3000)', true); await p.waitForSelector('article.card'); ok('B. file:// : affiches chargées', true);
  await login(p, 'controle-eticket-2026'); await p.waitForFunction(() => /contrôle/.test(document.querySelector('#staff-btn').textContent)); ok('B. file:// : connexion avec la clé de contrôle par défaut', true);
  await p.click('.site-menu a[data-k="/controle.html"]'); await p.waitForSelector('#s-setup:not(.hidden)'); ok('B. file:// → Contrôle : reste sur les fichiers et sans nouvelle saisie', p.url().startsWith('file://'));
  await ctx.close();

  // C. mauvaise clé : message clair
  ctx = await browser.newContext({ userAgent: WIN_UA }); p = await newPage(ctx); await p.goto('http://localhost:3000/'); await p.waitForSelector('#staff-btn');
  await login(p, 'mauvaise'); await p.waitForFunction(() => /incorrecte/.test(document.querySelector('#staff-err').textContent)); ok('C. mauvaise clé : « Clé incorrecte. » (et non « pas de connexion »)', true); await ctx.close();

  // D. serveur ABSENT puis démarré : le site le cherche, l'établit, puis la connexion marche
  await stop(server);
  ctx = await browser.newContext({ userAgent: WIN_UA, viewport: { width: 1280, height: 800 } }); p = await newPage(ctx);
  await p.goto('file://' + path.join(PUB, 'index.html')); await p.waitForFunction(() => document.querySelector('#srv') && document.querySelector('#srv').dataset.s === 'ko', null, { timeout: 15000 });
  ok('D. serveur éteint : voyant « Serveur introuvable »', /introuvable/.test(await p.textContent('#srv'))); await p.screenshot({ path: path.join(CAP, '2-serveur-introuvable.png') });
  await login(p, 'admin-eticket-2026'); await p.waitForFunction(() => /Aucun serveur/.test(document.querySelector('#staff-err').textContent));
  ok('D. connexion refusée avec un message qui explique quoi faire (npm start)', /npm start/.test(await p.textContent('#staff-err')));
  await p.click('#staff-x'); await listen(server, 3000);
  await p.click('#srv'); await p.click('#srv-go'); await p.waitForFunction(() => document.querySelector('#srv').dataset.s === 'ok', null, { timeout: 10000 });
  ok('D. serveur démarré : « Chercher et tester » établit la liaison', true); await p.click('#srv-x');
  await p.waitForSelector('article.card', { timeout: 10000 }); ok('D. les affiches se chargent sans recharger la page', true);
  await login(p, 'admin-eticket-2026'); await p.waitForFunction(() => /administrateur/.test(document.querySelector('#staff-btn').textContent)); ok('D. connexion réussie après le démarrage du serveur', true);
  await ctx.close(); await stop(server);

  // E. serveur sur un port inhabituel (3002) : trouvé par la recherche
  await listen(server, 3002);
  ctx = await browser.newContext({ userAgent: WIN_UA }); p = await newPage(ctx); await p.goto('file://' + path.join(PUB, 'index.html'));
  await p.waitForFunction(() => document.querySelector('#srv') && document.querySelector('#srv').dataset.s === 'ok', null, { timeout: 15000 });
  ok('E. serveur sur le port 3002 : trouvé automatiquement', /3002|connecté/.test(await p.textContent('#srv'))); await login(p, 'admin-eticket-2026'); await p.waitForFunction(() => /administrateur/.test(document.querySelector('#staff-btn').textContent)); ok('E. connexion réussie sur le port 3002', true); await ctx.close();

  // F. pages servies par un AUTRE serveur local (Live Server, port 5500) : l'API est trouvée sur 3002
  const stat = http.createServer((q, r) => { const f = path.join(PUB, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end('nf'); } r.setHeader('Content-Type', f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8'); r.end(d); }); });
  await listen(stat, 5500); ctx = await browser.newContext({ userAgent: WIN_UA }); p = await newPage(ctx); await p.goto('http://localhost:5500/');
  await p.waitForFunction(() => document.querySelector('#srv') && document.querySelector('#srv').dataset.s === 'ok', null, { timeout: 15000 });
  ok('F. pages servies par un autre serveur local : API trouvée', true); await p.waitForSelector('article.card', { timeout: 10000 }); ok('F. affiches chargées via l\'autre serveur', true);
  await login(p, 'admin-eticket-2026'); await p.waitForFunction(() => /administrateur/.test(document.querySelector('#staff-btn').textContent)); ok('F. connexion réussie', true); await ctx.close(); await stop(stat);

  // G. AUCUN serveur : l'erreur de l'utilisateur. Le dialogue aide ; le mode démonstration hors serveur rend le site utilisable
  await stop(server);
  ctx = await browser.newContext({ userAgent: WIN_UA, viewport: { width: 1280, height: 900 } }); p = await newPage(ctx);
  await p.goto('file://' + path.join(PUB, 'index.html')); await p.waitForFunction(() => document.querySelector('#srv') && document.querySelector('#srv').dataset.s === 'ko', null, { timeout: 15000 });
  await p.click('#srv'); await p.waitForSelector('#srv-modal');
  const tried = await p.textContent('#srv-st');
  ok('G. dialogue d\'erreur : adresses testées sans « file:// » parasite', !/file:\/\//.test(tried) && /localhost:3000/.test(tried) && /3010/.test(tried), tried.slice(0, 120));
  ok('G. dialogue d\'erreur : liste des causes à vérifier (Node, demarrer.bat, healthz, localhost)', /demarrer\.bat/.test(await p.textContent('#srv-help')) && /node -v/.test(await p.textContent('#srv-help')) && /healthz/.test(await p.textContent('#srv-help')));
  await p.screenshot({ path: path.join(CAP, '3-dialogue-aide.png') });
  await p.click('#srv-demo'); await p.waitForFunction(() => document.querySelector('#srv').dataset.s === 'demo'); await p.click('#srv-x');
  ok('G. mode démonstration hors serveur activé : voyant « Mode démo hors serveur »', /démo/.test(await p.textContent('#srv')));
  await p.waitForSelector('article.card', { timeout: 10000 }); ok('G. démo : affiches affichées sans serveur', (await p.locator('article.card').count()) >= 3);
  await p.locator('button[data-id]:not([disabled])').first().click(); await p.waitForSelector('#dialog #pay');
  await p.selectOption('#op', 'orange'); await p.fill('#tel', '70112233'); await p.click('#pay');
  await p.waitForSelector('text=Paiement confirmé', { timeout: 15000 }); await p.click('#go'); await p.waitForSelector('.billet svg');
  ok('G. démo : réservation, paiement simulé, billet avec QR', (await p.locator('.billet').count()) >= 1); await p.screenshot({ path: path.join(CAP, '4-demo-hors-serveur.png'), fullPage: true });
  await login(p, 'admin-eticket-2026'); await p.waitForFunction(() => /administrateur/.test(document.querySelector('#staff-btn').textContent)); ok('G. démo : connexion personnel avec la clé par défaut', true);
  await p.click('.site-menu a[data-k="/admin.html"]'); await p.waitForSelector('[data-ev]', { timeout: 8000 }); ok('G. démo : Accueil → Admin sans nouvelle saisie, événements listés', true);
  ok('G. démo : l\'administration voit la vente faite', /1 ?000|billets vendus/.test(await p.textContent('body')));
  await p.screenshot({ path: path.join(CAP, '5-demo-admin.png') });
  const code = await p.evaluate(() => JSON.parse(localStorage.getItem('eticket-demo-db')).tickets[0].code);
  await p.click('.site-menu a[data-k="/controle.html"]'); await p.waitForSelector('#s-setup:not(.hidden)'); await p.click('#b-start'); await p.waitForSelector('#s-scan:not(.hidden)');
  await p.fill('#manual', code); await p.click('#b-manual'); await p.waitForSelector('#res.show.ok'); ok('G. démo : contrôle d\'un billet valide', true);
  await p.click('#res'); await p.fill('#manual', code); await p.click('#b-manual'); await p.waitForSelector('#res.show.ko'); ok('G. démo : 2e passage refusé', /DÉJÀ UTILISÉ/.test(await p.textContent('#r-big')));
  await ctx.close();

  ok('aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
  await browser.close(); await stop(server);
  const txt = `Liaison page ↔ serveur — ${new Date().toISOString().slice(0, 16)} UTC\n${out.filter(l => l.startsWith('OK')).length}/${out.length} contrôles réussis\n` + out.join('\n') + '\n';
  fs.writeFileSync(path.join(__dirname, 'rapport-reseau.txt'), txt); console.log(txt); process.exit(ko ? 1 : 0);
})().catch(e => { console.log(out.join('\n')); console.error(e.stack); process.exit(2); });
