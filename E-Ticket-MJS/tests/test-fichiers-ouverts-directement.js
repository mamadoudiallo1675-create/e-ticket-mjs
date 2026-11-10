'use strict';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
/* Vérifie que les pages s'affichent avec leur design et fonctionnent aussi quand on les ouvre DIRECTEMENT depuis le dossier
   (double-clic sur public/index.html, adresse file://…), le serveur tournant sur http://localhost:3000.
   Lancer :  node tests/test-fichiers-ouverts-directement.js   (Playwright requis) */
const path = require('path'), fs = require('fs'), os = require('os');
const PUB = path.join(__dirname, '..', 'public'), CAP = path.join(__dirname, 'captures-fichiers'); fs.mkdirSync(CAP, { recursive: true });
Object.assign(process.env, { PORT: '3000', DB_PATH: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'file-')), 'd.sqlite'), ADMIN_KEY: 'cle-admin-demo', CONTROL_KEY: 'cle-borne-demo', NODE_ENV: 'development', PROVIDER_ORANGE: 'mock', PROVIDER_MOOV: 'mock', PROVIDER_CINETPAY: 'mock', SMS_PROVIDER: 'console' });
const out = []; let ko = 0; const ok = (n, c, x) => { if (!c) ko++; out.push((c ? 'OK    ' : 'ÉCHEC ') + n + (x ? ' — ' + x : '')); };
(async () => {
  const { server } = require('../server.js'), { chromium } = require('playwright');
  await new Promise(r => server.listen(3000, '127.0.0.1', r));
  const browser = await chromium.launch(), ctx = await browser.newContext({ userAgent: WIN_UA, viewport: { width: 1280, height: 900 } }), errors = [];
  for (const f of ['index', 'conditions', 'confidentialite', 'admin', 'controle']) {
    const p = await ctx.newPage(); p.on('pageerror', e => errors.push(f + ' : ' + e.message));
    await p.goto('file://' + path.join(PUB, f + '.html')); await p.waitForSelector('.site-menu a');
    const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor), n = await p.locator('.site-menu a').count();
    ok(`${f}.html ouvert directement : design appliqué (fond ${bg}) et menu (${n} liens)`, bg === 'rgb(245, 246, 242)' && n === 8);
    if (f === 'index') {
      await p.waitForSelector('article.card', { timeout: 8000 }); ok('index : affiches chargées depuis le serveur local', (await p.locator('article.card').count()) >= 3);
      await p.locator('button[data-id]:not([disabled])').first().click(); await p.waitForSelector('#dialog #pay'); ok('index : fenêtre de réservation (montant calculé)', /FCFA/.test(await p.textContent('.total')));
      await p.click('#x');
    }
    if (f === 'conditions') { await p.waitForSelector('#bandeau', { state: 'visible' }); ok('conditions : bandeau « Projet non validé » (appel API depuis file://)', true); }
    if (f === 'admin') { await p.fill('#key', 'cle-admin-demo'); await p.click('#b-login'); await p.waitForSelector('[data-ev]'); ok('admin : connexion et liste des événements', true); }
    if (f === 'controle') { await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.reload(); await p.waitForSelector('#key', { state: 'visible' }); await p.fill('#key', 'cle-borne-demo'); await p.click('#b-login'); await p.waitForSelector('#s-setup:not(.hidden)'); ok('contrôle : connexion avec la clé de borne', true); }
    await p.screenshot({ path: path.join(CAP, f + '.png') }); await p.close();
  }
  ok('aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
  await browser.close(); server.closeAllConnections(); server.close();
  const txt = `Pages ouvertes directement depuis les fichiers — ${new Date().toISOString().slice(0, 16)} UTC\n` + out.join('\n') + '\n'; fs.writeFileSync(path.join(__dirname, 'rapport-fichiers.txt'), txt); console.log(txt); process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e.stack); process.exit(2); });
