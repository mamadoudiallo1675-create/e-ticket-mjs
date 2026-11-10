'use strict';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
/* E-Ticket Mali — UN SEUL fichier qui teste, dans un vrai navigateur et en local, toutes les pages interactives :
   accueil (affiches, filtres, réservation, paiement CinetPay en pop-up, paiement Orange Money, paiement refusé, billets QR,
   historique, support, récupération par SMS), administration, contrôle aux entrées, pages juridiques, menu (ordinateur et mobile).
   Tous les guichets (CinetPay, Orange Money) sont de FAUX serveurs locaux : aucun appel externe, aucun débit.

   Lancer :   node tests/test-pages-interactives.js          (nécessite Playwright : npm i -D playwright && npx playwright install chromium)
   Résultat : rapport dans tests/rapport-pages.txt, captures dans tests/captures/ ; code de sortie 0 si tout passe. */
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const ROOT = path.join(__dirname, '..'), CAP = path.join(__dirname, 'captures');
fs.mkdirSync(CAP, { recursive: true });
const PORT = 3366, FAKE = 3377, B = `http://localhost:${PORT}`, SECRET = 'cle-api-secrete-ne-doit-pas-fuiter';
Object.assign(process.env, {
  PORT: String(PORT), DB_PATH: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pages-')), 'd.sqlite'), ADMIN_KEY: 'cle-admin-demo', CONTROL_KEY: 'cle-borne-demo', NODE_ENV: 'development',
  PROVIDER_CINETPAY: 'live', CINETPAY_API_KEY: SECRET, CINETPAY_SITE_ID: '1', CINETPAY_BASE_URL: `http://127.0.0.1:${FAKE}/v2`,
  PROVIDER_ORANGE: 'live', OM_AUTH_HEADER: 'Basic ZmFrZQ==', OM_MERCHANT_KEY: 'mk-fake', OM_COUNTRY: 'dev', OM_CURRENCY: 'OUV', OM_BASE_URL: `http://127.0.0.1:${FAKE}`, OM_OAUTH_URL: `http://127.0.0.1:${FAKE}/oauth/v3/token`,
  PROVIDER_MOOV: 'off', SMS_PROVIDER: 'console', RATE_ORDERS_PER_10MIN: '1000'
});

// ---------- faux guichets ----------
const tx = {};
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', async () => {
    const u = new URL(req.url, 'http://x'), json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    const body = () => { try { return JSON.parse(b || '{}'); } catch (_) { return {}; } };
    // CinetPay (API v2)
    if (u.pathname === '/v2/payment') { const j = body(); tx[j.transaction_id] = { kind: 'cp', amount: j.amount, ret: j.return_url, notify: j.notify_url, status: 'WAITING_FOR_CUSTOMER' };
      return json({ code: '201', data: { payment_url: `http://127.0.0.1:${FAKE}/pay/${j.transaction_id}`, payment_token: 't' + j.transaction_id } }); }
    if (u.pathname === '/v2/payment/check') { const t = tx[body().transaction_id]; return json(t ? { code: '00', data: { status: t.status, amount: t.amount, currency: 'XOF' } } : { code: '627' }); }
    // Orange Money WebPay (bac à sable simulé)
    if (u.pathname === '/oauth/v3/token') return json({ access_token: 'tok', expires_in: 3600 });
    if (u.pathname === '/orange-money-webpay/dev/v1/webpayment') { const j = body(); tx[j.order_id] = { kind: 'om', amount: j.amount, ret: j.return_url, notify: j.notif_url, status: 'PENDING', nt: 'nt-' + j.order_id };
      return json({ pay_token: 'pt-' + j.order_id, payment_url: `http://127.0.0.1:${FAKE}/pay/${j.order_id}`, notif_token: 'nt-' + j.order_id }); }
    if (u.pathname === '/orange-money-webpay/dev/v1/transactionstatus') { const t = tx[body().order_id]; return json({ status: t ? t.status : 'FAILED' }); }
    // pages de paiement
    const m = u.pathname.match(/^\/pay\/(CMD-\w+)$/);
    if (m && tx[m[1]]) {
      const t = tx[m[1]];
      if (req.method === 'POST') {
        const refuse = /refuse=1/.test(b);
        t.status = t.kind === 'cp' ? (refuse ? 'REFUSED' : 'ACCEPTED') : (refuse ? 'FAILED' : 'SUCCESS');
        const hook = t.kind === 'cp' ? { h: { 'Content-Type': 'application/x-www-form-urlencoded' }, b: 'cpm_trans_id=' + m[1] } : { h: { 'Content-Type': 'application/json' }, b: JSON.stringify({ notif_token: t.nt, status: t.status }) };
        await fetch(t.notify, { method: 'POST', headers: hook.h, body: hook.b }).catch(() => {});
        res.statusCode = 302; res.setHeader('Location', t.ret); return res.end();
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(`<meta charset=utf-8><title>Faux guichet ${t.kind === 'cp' ? 'CinetPay' : 'Orange Money'}</title><body style="font-family:system-ui;padding:30px"><h2>Guichet ${t.kind === 'cp' ? 'CinetPay' : 'Orange Money'} (simulation)</h2><p>Montant : <b id=m>${t.amount}</b></p><form method=post><button id=ok style="padding:12px 20px">Payer</button></form><form method=post><input type=hidden name=refuse value=1><button id=ko style="padding:12px 20px;margin-top:10px">Refuser</button></form></body>`);
    }
    res.statusCode = 404; res.end('{}');
  });
});

// ---------- mini-cadre de test ----------
const out = []; let nb = 0, ko = 0;
const section = s => out.push('\n' + s);
const ok = (n, c, x) => { nb++; if (!c) ko++; out.push((c ? 'OK    ' : 'ÉCHEC ') + n + (x ? ' — ' + x : '')); };
const shot = (p, f, o) => p.screenshot({ path: path.join(CAP, f), ...(o || {}) }).catch(() => {});
async function step(name, fn) { try { await fn(); } catch (e) { ok(name, false, e.message.split('\n')[0]); } }
const money = s => Number(String(s).replace(/\D/g, ''));

(async () => {
  const { server } = require(path.join(ROOT, 'server.js')), sms = require(path.join(ROOT, 'sms')), { chromium } = require('playwright');
  await new Promise(r => fake.listen(FAKE, '127.0.0.1', r)); await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: WIN_UA, viewport: { width: 1280, height: 900 } });
  const errors = [], sent = [];
  const watch = (p, tag) => { p.on('pageerror', e => errors.push(tag + ' : ' + e.message)); p.on('request', r => { if (r.postData()) sent.push(r.postData()); }); };
  const page = await ctx.newPage(); watch(page, 'site');
  let ref1 = null;

  section('1. Menu de navigation (toutes les pages, ordinateur)');
  await step('menu', async () => {
    const pages = [['/', 'tab:accueil'], ['/conditions.html', '/conditions.html'], ['/confidentialite.html', '/confidentialite.html'], ['/controle.html', '/controle.html'], ['/admin.html', '/admin.html']];
    for (const [href, key] of pages) {
      const p = await ctx.newPage(); watch(p, href); await p.goto(B + href);
      await p.waitForSelector('.site-menu a');
      const hrefs = await p.$$eval('.site-menu a', a => a.map(x => x.getAttribute('href')));
      const active = await p.$$eval('.site-menu a.on', a => a.map(x => x.dataset.k));
      ok(`${href} : menu complet (8 liens) et page active surlignée`, hrefs.length === 8 && active.includes(key), active.join(','));
      await p.close();
    }
  });

  section('2. Accueil — affiches, filtres, réservation');
  await step('accueil', async () => {
    await page.goto(B + '/'); await page.waitForSelector('article.card');
    const n = await page.locator('article.card').count();
    ok('affiches affichées', n >= 3, n + ' cartes'); await shot(page, '01-accueil.png');
    await page.click('.chip[data-t="basketball"]'); const nb1 = await page.locator('article.card').count();
    ok('filtre Basketball réduit la liste', nb1 >= 1 && nb1 < n, nb1 + ' carte(s)');
    await page.click('.chip[data-t="Tous"]');
    ok('match sans tarif : « Billetterie bientôt ouverte » ou bouton désactivé', (await page.locator('button[data-id]:not([disabled])').count()) >= 1);
    await page.locator('button[data-id]:not([disabled])').first().click(); await page.waitForSelector('#dialog #pay');
    const op = await page.$$eval('#op option', o => o.map(x => x.value));
    ok('moyens de paiement proposés : Orange Money, Moov Money et CinetPay', op.includes('orange') && op.includes('moov') && op.includes('cinetpay'), op.join(', '));
    const t0 = money(await page.textContent('.total')); await page.click('[data-d="1"]');
    ok('quantité +1 : le total double', money(await page.textContent('.total')) === t0 * 2 && (await page.textContent('#q')) === '2');
    await page.fill('#tel', '123'); await page.click('#pay');
    await page.waitForFunction(() => /numéro de téléphone valide/.test(document.querySelector('#err').textContent));
    ok('numéro invalide refusé avec un message', true); await shot(page, '02-reservation.png');
    await page.click('#x'); ok('annulation ferme la fenêtre', !(await page.locator('#modal.open').count()));
  });

  section('3. Paiement Orange Money (montant du panier → serveur → guichet) et billets');
  await step('paiement-orange', async () => {
    await page.locator('button[data-id]:not([disabled])').first().click(); await page.waitForSelector('#dialog #pay');
    await page.selectOption('#op', 'orange'); await page.click('[data-d="1"]');
    const total = money(await page.textContent('.total')); await page.fill('#tel', '70112233');
    await page.click('#pay'); await page.waitForURL(/127\.0\.0\.1:3377\/pay\//, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#ok', { timeout: 10000 });
    ok('redirection vers le guichet Orange Money', /\/pay\/CMD-/.test(page.url()));
    ok('le guichet reçoit exactement le montant du panier', money(await page.textContent('#m')) === total, total + ' FCFA');
    await shot(page, '03-guichet-orange.png'); await page.click('#ok'); await page.waitForURL(/\?order=CMD-/, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Paiement confirmé', { timeout: 15000 });
    ok('retour : « Paiement confirmé » dans la page d\'origine', true); await shot(page, '04-confirmation.png');
    await page.click('#go'); await page.waitForSelector('.billet');
    ok('2 billets délivrés avec QR dessiné', (await page.locator('.billet').count()) === 2 && (await page.locator('.billet svg').count()) >= 2); await shot(page, '05-mes-billets.png', { fullPage: true });
    const ordr = await page.evaluate(() => Object.keys(localStorage).map(k => localStorage.getItem(k)).join('|').match(/CMD-[A-Z0-9]{8}/)); ref1 = ordr && ordr[0];
    await page.click('.site-menu a[data-k="tab:historique"]'); await page.waitForSelector('table');
    ok('historique : la transaction apparaît', (await page.locator('table tr').count()) >= 2); await shot(page, '06-historique.png');
  });

  section('4. Paiement refusé (Orange Money) — places libérées, aucun billet');
  await step('refus', async () => {
    await page.click('.site-menu a[data-k="tab:accueil"]'); await page.waitForSelector('article.card');
    const before = await page.evaluate(() => fetch('/api/events').then(r => r.json()));
    await page.locator('button[data-id]:not([disabled])').first().click(); await page.waitForSelector('#dialog #pay');
    await page.selectOption('#op', 'orange'); await page.fill('#tel', '70445566');
    await page.click('#pay'); await page.waitForURL(/127\.0\.0\.1:3377\/pay\//, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#ko'); await page.click('#ko'); await page.waitForURL(/\?order=CMD-/, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const d = document.querySelector('#dialog'); return d && /refus|échou|échec|annul|n'a pas/i.test(d.textContent) && !/Vérification du paiement/.test(d.textContent); }, null, { timeout: 15000 });
    ok('message d\'échec affiché à l\'acheteur', true); await shot(page, '07-paiement-refuse.png');
    const after = await page.evaluate(() => fetch('/api/events').then(r => r.json()));
    const sum = l => l.reduce((a, e) => a + e.tribunes.reduce((x, t) => x + t.stock, 0), 0);
    ok('les places réservées sont remises en vente', sum(after) === sum(before), sum(before) + ' → ' + sum(after));
    await page.click('#x').catch(() => {});
  });

  section('5. Paiement Orange Money (bac à sable simulé, redirection plein écran)');
  await step('orange', async () => {
    await page.goto(B + '/'); await page.waitForSelector('article.card');
    await page.locator('button[data-id]:not([disabled])').nth(1).click(); await page.waitForSelector('#dialog #pay');
    await page.selectOption('#op', 'orange'); await page.fill('#tel', '70778899');
    const total = money(await page.textContent('.total'));
    await page.click('#pay'); await page.waitForURL(/127\.0\.0\.1:3377\/pay\//, { waitUntil: 'domcontentloaded' });
    ok('redirection vers la page de paiement Orange Money', true);
    ok('Orange reçoit le montant du panier', money(await page.textContent('#m')) === total, total);
    await page.click('#ok'); await page.waitForURL(/\?order=CMD-/, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Paiement confirmé', { timeout: 15000 });
    ok('retour : « Paiement confirmé » (Orange Money)', true); await shot(page, '08-orange-confirme.png');
  });

  section('6. Support et récupération par SMS depuis un autre appareil');
  await step('support', async () => {
    if (await page.locator('#modal.open').count()) await page.click('#modal #x');
    await page.click('.site-menu a[data-k="tab:aide"]'); await page.waitForSelector('#s-send', { state: 'visible' });
    await page.fill('#s-tel', '70112233'); await page.fill('#s-msg', 'Test automatique : question sur mon billet.'); await page.click('#s-send');
    await page.waitForFunction(() => /Message envoyé/.test(document.querySelector('#s-ok').textContent));
    ok('formulaire de support envoyé', true); await shot(page, '09-support.png');
  });
  await step('sms', async () => {
    const c2 = await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); const p2 = await c2.newPage(); watch(p2, 'mobile');
    await p2.goto(B + '/'); await p2.waitForSelector('article.card'); await shot(p2, '10-mobile-accueil.png');
    ok('mobile : menu replié derrière « Menu »', !(await p2.locator('.site-menu a[data-k="tab:billets"]').isVisible()));
    await p2.click('.menu-toggle'); await shot(p2, '11-mobile-menu-ouvert.png'); await p2.click('.site-menu a[data-k="tab:billets"]');
    await p2.waitForSelector('#recup:not(.hidden)'); await p2.click('#recup summary'); await p2.fill('#rec-tel', '70112233'); await p2.click('#rec-send');
    await p2.waitForSelector('#rec-2:not(.hidden)'); const code = ((sms.outbox.at(-1) || {}).message || '').match(/\b(\d{6})\b/);
    ok('SMS avec code à 6 chiffres envoyé', !!code);
    await p2.fill('#rec-code', '000000'); await p2.click('#rec-verify');
    await p2.waitForFunction(() => document.querySelector('#rec-msg').textContent.trim().length > 0);
    ok('mauvais code refusé avec un message', (await p2.locator('.billet').count()) === 0);
    await p2.fill('#rec-code', code ? code[1] : '000000'); await p2.click('#rec-verify'); await p2.waitForSelector('.billet', { timeout: 8000 });
    ok('autre appareil : billets retrouvés', (await p2.locator('.billet').count()) >= 2); await shot(p2, '12-mobile-billets-sms.png', { fullPage: true });
    await c2.close();
  });

  section('7. Administration');
  const adm = await ctx.newPage(); watch(adm, 'admin');
  await step('admin', async () => {
    await adm.goto(B + '/admin.html'); await adm.fill('#key', 'mauvaise'); await adm.click('#b-login');
    await adm.waitForFunction(() => document.querySelector('#e-login').textContent.includes('incorrecte')); ok('mauvaise clé refusée', true);
    await adm.fill('#key', 'cle-admin-demo'); await adm.click('#b-login'); await adm.waitForSelector('[data-ev]');
    ok('liste des événements', (await adm.locator('[data-ev]').count()) >= 3); await shot(adm, '13-admin-evenements.png');
    await adm.click('#nav button[data-p="new"]'); await adm.selectOption('#f-sport', 'football'); await adm.fill('#f-titre', 'Mali – Match test'); await adm.fill('#f-adv', 'Essai automatique');
    await adm.fill('#f-lieu', 'Stade du 26 Mars, Bamako'); await adm.fill('#f-date', '2027-05-01T17:00');
    await adm.fill('#f-trs .x-nom', 'Pelouse'); await adm.fill('#f-trs .x-prix', '1500'); await adm.fill('#f-trs .x-stock', '40');
    await shot(adm, '14-admin-publier.png'); adm.once('dialog', d => d.accept()); await adm.click('#b-pub');
    await adm.waitForSelector('text=Mali – Match test', { timeout: 8000 }); ok('match publié avec une tribune à 1 500 FCFA / 40 places', true);
    const pub = await ctx.newPage(); await pub.goto(B + '/'); await pub.waitForSelector('article.card');
    ok('le match publié apparaît sur le site public avec son prix', /Mali – Match test/.test(await pub.textContent('body')) && /1\s?500/.test(await pub.textContent('body'))); await pub.close();
    await adm.click('#nav button[data-p="stats"]'); await adm.waitForSelector('#stats table'); ok('statistiques : commandes payées visibles', (await adm.textContent('#stats')).includes('Payées')); await shot(adm, '15-admin-stats.png');
    await adm.click('#nav button[data-p="refunds"]'); await adm.waitForTimeout(400); ok('onglet remboursements s\'affiche', (await adm.textContent('#refunds')).length > 0);
    await adm.click('#nav button[data-p="support"]'); await adm.waitForFunction(() => /Test automatique/.test(document.querySelector('#support').textContent));
    ok('message de support reçu côté admin', true);
    await adm.click('#nav button[data-p="audit"]'); await adm.waitForFunction(() => /event\.create/.test(document.querySelector('#audit').textContent));
    ok('journal : la publication est enregistrée', true); await shot(adm, '16-admin-journal.png');
  });

  section('8. Contrôle aux entrées');
  await step('controle', async () => {
    const pc = await ctx.newPage(); watch(pc, 'controle'); await pc.goto(B + '/controle.html'); await pc.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await pc.reload();
    await pc.fill('#key', 'mauvaise'); await pc.click('#b-login'); await pc.waitForFunction(() => document.querySelector('#e-login').textContent.trim().length > 0); ok('mauvaise clé refusée', true);
    await pc.fill('#key', 'cle-borne-demo'); await pc.click('#b-login'); await pc.waitForSelector('#s-setup:not(.hidden)'); await shot(pc, '17-controle-choix.png');
    await pc.click('#b-diag'); await pc.waitForFunction(() => !document.querySelector('#b-diag').disabled, null, { timeout: 30000 });
    ok('diagnostic du poste exécuté (réseau, caméra, lecteur)', (await pc.locator('#diag .dg').count()) >= 4); await shot(pc, '18-controle-diagnostic.png', { fullPage: true });
    await pc.click('#b-start'); await pc.waitForSelector('#s-scan:not(.hidden)');
    const tk = await (async () => { const db = new (require('node:sqlite').DatabaseSync)(process.env.DB_PATH, { readOnly: true }); const r = db.prepare("SELECT t.code, t.event_id e FROM tickets t LIMIT 1").get(); db.close(); return r; })();
    await pc.selectOption('#ev', String(tk.e)).catch(() => {});   // l'événement du billet testé
    await pc.click('#b-stop'); await pc.selectOption('#ev', String(tk.e)); await pc.click('#b-start'); await pc.waitForSelector('#s-scan:not(.hidden)');
    await pc.fill('#manual', tk.code); await pc.click('#b-manual'); await pc.waitForSelector('#res.show.ok'); ok('billet valide accepté', true); await shot(pc, '19-controle-valide.png');
    await pc.click('#res'); await pc.fill('#manual', tk.code); await pc.click('#b-manual'); await pc.waitForSelector('#res.show.ko');
    ok('2e passage refusé : « DÉJÀ UTILISÉ »', (await pc.textContent('#r-big')).includes('DÉJÀ UTILISÉ')); await shot(pc, '20-controle-refuse.png');
    await pc.click('#res'); await pc.fill('#manual', 'ML-AAAA-AAAA-AAAA'); await pc.click('#b-manual'); await pc.waitForSelector('#res.show.ko'); ok('billet inventé refusé', true);
  });

  section('8b. Connexion unique du personnel (menu) — valable sur toutes les pages et tous les onglets');
  await step('connexion unique', async () => {
    const c3 = await browser.newContext({ userAgent: WIN_UA, viewport: { width: 1280, height: 900 } }); const h = await c3.newPage(); watch(h, 'staff');
    await h.goto(B + '/'); await h.waitForSelector('#staff-btn');
    ok('bouton « Connexion personnel » dans le menu', /Connexion personnel/.test(await h.textContent('#staff-btn')));
    await h.click('#staff-btn'); await h.fill('#staff-key', 'mauvaise'); await h.click('#staff-ok');
    await h.waitForFunction(() => document.querySelector('#staff-err').textContent.length > 0); ok('mauvaise clé refusée avec un message', true);
    await h.fill('#staff-key', 'cle-admin-demo'); await h.click('#staff-ok');
    await h.waitForFunction(() => /administrateur/.test(document.querySelector('#staff-btn').textContent)); ok('connecté : « Déconnexion (administrateur) »', true); await shot(h, '22-connexion-personnel.png');
    await h.click('.site-menu a[data-k="/admin.html"]'); await h.waitForURL(/\/admin\.html$/); await h.waitForSelector('[data-ev]', { timeout: 8000 });
    ok('Accueil → Admin : déjà connecté, aucune saisie de clé', !(await h.locator('#login').isVisible()));
    await h.click('.site-menu a[data-k="/controle.html"]'); await h.waitForURL(/\/controle\.html$/); await h.waitForSelector('#s-setup:not(.hidden)', { timeout: 8000 });
    ok('Admin → Contrôle : déjà connecté (la clé admin ouvre aussi le contrôle)', true);
    const h2 = await c3.newPage(); await h2.goto(B + '/admin.html'); await h2.waitForSelector('[data-ev]', { timeout: 8000 });
    ok('nouvel onglet : connexion reprise automatiquement', !(await h2.locator('#login').isVisible()));
    await h2.click('#staff-btn'); await h2.waitForFunction(() => document.querySelector('#login') && !document.querySelector('#login').classList.contains('hidden'));
    const h3 = await c3.newPage(); await h3.goto(B + '/admin.html'); await h3.waitForSelector('#login', { state: 'visible', timeout: 8000 });
    ok('déconnexion depuis le menu : la connexion disparaît partout', true);
    // clé de contrôle seule : ouvre le contrôle, pas l'administration
    await h3.goto(B + '/'); await h3.click('#staff-btn'); await h3.fill('#staff-key', 'cle-borne-demo'); await h3.click('#staff-ok');
    await h3.waitForURL(/\/controle\.html$/, { timeout: 8000 }); await h3.waitForSelector('#s-setup:not(.hidden)', { timeout: 8000 }); ok('clé de contrôle : renvoi direct vers le contrôle, sans resaisie', true);
    await h3.goto(B + '/admin.html'); await h3.waitForURL(/\/controle\.html$/, { timeout: 8000 }); ok('clé de contrôle : l\'administration reste inaccessible (renvoi au contrôle)', true);
    ok('clé de contrôle : le menu ne montre que le contrôle', (await h3.$$eval('.site-menu a', l => l.filter(a => a.offsetParent !== null).length)) === 1);
    await c3.close();
  });

  section('9. Pages juridiques et sécurité');
  await step('juridique', async () => {
    const cj = await browser.newContext({ userAgent: WIN_UA, viewport: { width: 1280, height: 900 } });   // visiteur sans session du personnel
    for (const f of ['conditions', 'confidentialite']) {
      const p = await cj.newPage(); await p.goto(`${B}/${f}.html`); await p.waitForSelector('#bandeau', { state: 'visible' });
      ok(`${f}.html : bandeau « Projet non validé » et passages à compléter surlignés`, (await p.locator('mark.todo').count()) > 0); if (f === 'conditions') await shot(p, '21-conditions.png'); await p.close();
    }
    await cj.close();
    const all = sent.join('') + (await page.content());
    ok('la clé API CinetPay n\'apparaît jamais dans le navigateur', !all.includes(SECRET));
    ok('aucun prix envoyé par le navigateur lors des commandes', !sent.some(s => /"(prix|amount|total)"/.test(s) && /"qty"/.test(s)));
  });

  ok('aucune erreur JavaScript sur toutes les pages', errors.length === 0, errors.join(' | '));
  await browser.close(); server.closeAllConnections(); server.close(); fake.close();
  const head = `E-Ticket Mali — test des pages interactives (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)\n${nb - ko}/${nb} contrôles réussis\n`;
  const text = head + out.join('\n') + '\n';
  fs.writeFileSync(path.join(__dirname, 'rapport-pages.txt'), text); console.log(text);
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR :', e.stack); process.exit(2); });
