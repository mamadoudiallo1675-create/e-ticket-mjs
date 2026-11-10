'use strict';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
/* Teste la version de présentation : serveur Python HTTPS (live_server.py) + moteur, nom de domaine sécurisé, clés du personnel,
   parcours visiteur -> paiement simulé -> billet -> contrôle -> administration en direct, téléphone, redirection http->https.
   Lancer : node tests/test-presentation-https.js   (nécessite python et playwright) */
const path = require('path'), fs = require('fs'), http = require('http'), tls = require('tls'), { spawn, execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..'), CAP = path.join(__dirname, 'captures-presentation'); fs.mkdirSync(CAP, { recursive: true });
const keys = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'cles-acces.json'), 'utf8'));
const out = []; let ko = 0; const ok = (n, c, x) => { if (!c) ko++; out.push((c ? 'OK    ' : 'ÉCHEC ') + n + (x ? ' — ' + x : '')); console.log(out[out.length - 1]); };
const U = 'https://eticket-mjs.local:8443';
(async () => {
  fs.rmSync(path.join(ROOT, 'donnees'), { recursive: true, force: true });
  const py = spawn(process.platform === 'win32' ? 'python' : 'python3', ['live_server.py'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; py.stdout.on('data', d => log += d); py.stderr.on('data', d => log += d);
  for (let i = 0; i < 80 && !/Ctrl\+C/.test(log); i++) await new Promise(r => setTimeout(r, 250));
  ok('0. live_server.py démarre le moteur et le serveur HTTPS', /prêt/.test(log), (log.match(/Site public[^\n]*/) || [''])[0].trim());
  ok('0. les clés ne sont jamais réaffichées dans les messages', !/MJS-(ADM|CTL)-/.test(log));
  const K = keys(), AK = K.admin[0], CK = Object.values(K.controle)[0];
  ok('0. clés fortes (≥ 28 caractères)', [AK, ...Object.values(K.controle)].every(k => k.length >= 28));
  // certificat : chaîne vérifiée avec l'autorité locale, nom correct
  let chain = false; try { execFileSync('openssl', ['verify', '-CAfile', path.join(ROOT, 'certificats', 'ca-eticket-mjs.crt'), '-verify_hostname', 'eticket-mjs.local', path.join(ROOT, 'certificats', 'eticket-mjs.local.crt')], { stdio: 'pipe' }); chain = true; } catch (e) {}
  ok('1. certificat HTTPS valide pour eticket-mjs.local (chaîne de confiance vérifiée)', chain);
  const proto = await new Promise(r => { const s = tls.connect({ host: '127.0.0.1', port: 8443, servername: 'eticket-mjs.local', rejectUnauthorized: false }, () => { const p = s.getProtocol(); s.end(); r(p); }); s.on('error', () => r('erreur')); });
  ok('1. TLS moderne', /TLSv1\.[23]/.test(proto), proto);
  const redir = await new Promise(r => http.get({ host: '127.0.0.1', port: 8080, path: '/admin.html', headers: { Host: 'eticket-mjs.local:8080' } }, res => r(res.statusCode + ' ' + res.headers.location)).on('error', e => r('erreur')));
  ok('1. http://…:8080 redirige vers https', /^30[78] https:\/\/eticket-mjs\.local:8443\/admin\.html$/.test(redir), redir);

  const { chromium, devices } = require('playwright');
  const br = await chromium.launch({ args: ['--host-resolver-rules=MAP eticket-mjs.local 127.0.0.1', '--proxy-server=direct://', '--proxy-bypass-list=*'] }), errors = [];
  const mk = async o => { const c = await br.newContext({ ignoreHTTPSErrors: true, ...o }); const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message)); return { c, p }; };
  const D = { userAgent: WIN_UA, viewport: { width: 1280, height: 800 } };
  // 2. visiteur
  let { c: cV, p: v } = await mk(D);
  const resp = await v.goto(U + '/'); await v.waitForSelector('article.card');
  const h = resp.headers();
  ok('2. page servie en HTTPS avec HSTS et CSP', /max-age/.test(h['strict-transport-security'] || '') && /default-src/.test(h['content-security-policy'] || ''));
  ok('2. contexte sécurisé (caméra/QR autorisés)', await v.evaluate(() => window.isSecureContext));
  await v.waitForFunction(() => document.querySelector('#srv').dataset.live === 'on', null, { timeout: 8000 }).then(() => ok('2. temps réel (SSE) actif à travers le serveur Python', true), () => ok('2. temps réel (SSE) actif à travers le serveur Python', false));
  await v.screenshot({ path: path.join(CAP, '1-accueil-https.png') });
  await v.locator('button[data-id]:not([disabled])').first().click(); await v.waitForSelector('#dialog #pay');
  await v.selectOption('#op', 'orange'); await v.fill('#tel', '70112233'); await v.click('#pay');
  await v.waitForURL(/\/sandbox\/pay\/CMD-/, { waitUntil: 'domcontentloaded' });
  ok('3. redirection vers la passerelle de paiement simulée (même domaine HTTPS)', v.url().startsWith(U));
  await v.screenshot({ path: path.join(CAP, '2-paiement-simule.png') });
  await v.click('text=Simuler un paiement réussi'); await v.waitForSelector('text=Paiement confirmé', { timeout: 15000 });
  ok('3. retour au site : « Paiement confirmé »', true);
  await v.waitForSelector('canvas, svg, img.qr, .qr', { timeout: 8000 }).catch(() => {});
  const code = (await v.evaluate(() => document.body.innerText)).match(/ML-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
  ok('3. billet avec code reçu', !!code, code && code[0]);
  await v.screenshot({ path: path.join(CAP, '3-billet.png') });
  // 4. connexion du personnel avec les vraies clés
  let { c: cA, p: a } = await mk(D);
  await a.goto(U + '/'); await a.waitForSelector('#staff-btn');
  await a.click('#staff-btn'); await a.fill('#staff-key', 'admin-eticket-2026'); await a.click('#staff-ok');
  ok('4. clé de développement par défaut refusée', await a.waitForFunction(() => /incorrecte|invalide/i.test(document.body.innerText), null, { timeout: 5000 }).then(() => true, () => false));
  await a.fill('#staff-key', AK); await a.click('#staff-ok'); await a.waitForFunction(() => /administrateur/.test(document.querySelector('#staff-btn').textContent));
  ok('4. clé administrateur de présentation acceptée (rôle reconnu)', true);
  await a.click('.site-menu a[data-k="/admin.html"]'); await a.waitForSelector('[data-ev]');
  await a.click('#nav button[data-p="activity"]'); await a.waitForSelector('#activity');
  await a.waitForFunction(() => /Commande payée|Commande créée/.test(document.querySelector('#activity').textContent), null, { timeout: 8000 }).then(() => ok('4. administration : achat du visiteur visible dans l\'activité', true), () => ok('4. administration : achat du visiteur visible dans l\'activité', false));
  // 5. contrôle avec une clé de poste
  let { c: cC, p: c } = await mk(D);
  await c.goto(U + '/controle.html'); await c.fill('#key', 'MJS-CTL-AAAAA-AAAAA-AAAAA-AAAAA'); await c.click('#b-login');
  ok('5. fausse clé de contrôle refusée', await c.waitForFunction(() => /incorrecte|invalide/i.test((document.querySelector('#e-login') || {}).textContent || ''), null, { timeout: 5000 }).then(() => true, () => false));
  await c.fill('#key', CK); await c.click('#b-login'); await c.waitForSelector('#s-setup:not(.hidden)');
  ok('5. clé de contrôle (poste) acceptée', true);
  const evId = await c.evaluate(async code => { const evs = await (await fetch('/api/events')).json(); return evs.length; }, null);
  const db = require('node:sqlite'); const d = new db.DatabaseSync(path.join(ROOT, 'donnees', 'utilisateurs.sqlite'), { readOnly: true }); const tk = d.prepare('SELECT code, event_id e FROM tickets LIMIT 1').get(); d.close();
  await c.selectOption('#ev', String(tk.e)); await c.click('#b-start'); await c.waitForSelector('#s-scan:not(.hidden)');
  await c.fill('#manual', tk.code); await c.click('#b-manual'); await c.waitForSelector('#res.show.ok'); ok('5. billet valide accepté à l\'entrée', true);
  await c.screenshot({ path: path.join(CAP, '4-controle-valide.png') });
  await c.click('#res'); await c.fill('#manual', tk.code); await c.click('#b-manual'); await c.waitForSelector('#res.show.ko'); ok('5. 2e passage refusé', /DÉJÀ UTILISÉ/.test(await c.textContent('#r-big')));
  const ctl = await a.evaluate(async k => (await fetch('/api/admin/stats', { headers: { 'x-api-key': k } })).status, CK);
  ok('5. la clé de contrôle n\'ouvre pas l\'administration', ctl === 401, 'HTTP ' + ctl);
  await a.waitForFunction(() => /Billet scanné/.test(document.querySelector('#activity').textContent), null, { timeout: 8000 }).then(() => ok('5. le scan apparaît en direct dans l\'administration', true), () => ok('5. le scan apparaît en direct dans l\'administration', false));
  await a.screenshot({ path: path.join(CAP, '5-admin-direct.png') });
  const rows = await a.evaluate(async k => (await (await fetch('/api/admin/activity?limit=50', { headers: { 'x-api-key': k } })).json()).rows, AK);
  ok("5. journal d'activité alimenté à travers le serveur Python", rows.length > 5);
  // 6. téléphone
  let { c: cM, p: m } = await mk({ ...devices['iPhone 13'] });
  await m.goto(U + '/'); await m.waitForSelector('article.card'); await m.click('button:has-text("Menu")');
  ok('6. téléphone : options du personnel masquées', (await m.$$eval('#staff-btn, .site-menu a[data-k="/admin.html"], .site-menu a[data-k="/controle.html"]', l => l.filter(x => x.offsetParent !== null).length)) === 0);
  await m.screenshot({ path: path.join(CAP, '6-telephone.png') });
  // 7. 404 et fichiers sensibles non exposés
  const sens = await Promise.all(['/server.js', '/cles-acces.txt', '/cles-acces.json', '/donnees/utilisateurs.sqlite', '/donnees/admin.sqlite', '/donnees/personnel.sqlite', '/donnees/controle/entrees.ndjson', '/certificats/eticket-mjs.local.key', '/../server.js', '/db.js'].map(p => v.evaluate(async x => (await fetch(x)).status + ':' + (await (await fetch(x)).text()).slice(0, 12), p)));
  ok('7. fichiers sensibles (code, clés, base, clé privée) non accessibles', sens.every(s => !/^200:(\/\*|'use|\{|E-TICKET|SQLite|-----BEG|\s*\{)/.test(s) && !/^200:.*(MJS-ADM|PRIVATE)/.test(s)), sens.join(' | '));
  await br.close(); py.kill();
  try { execFileSync('pkill', ['-f', 'server.js'], { stdio: 'ignore' }); } catch (e) {}
  ok('aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
  fs.writeFileSync(path.join(__dirname, 'rapport-presentation.txt'), 'Présentation HTTPS Python — ' + new Date().toISOString() + '\n' + out.join('\n') + '\n');
  fs.rmSync(path.join(ROOT, 'donnees'), { recursive: true, force: true });
  console.log(ko ? ko + ' ÉCHEC(S)' : out.length + ' contrôles réussis'); process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e); try { execFileSync('pkill', ['-f', 'live_server.py']); execFileSync('pkill', ['-f', 'server.js']); } catch (_) {} process.exit(1); });
