'use strict';
// Essai de bout en bout dans un vrai navigateur (Playwright requis : npm i -D playwright) avec un FAUX guichet CinetPay local.
// Vérifie : montant du panier envoyé au serveur, pop-up de paiement, retour, billets délivrés, clé API absente du navigateur.
//   node deploy/e2e-cinetpay.js            (captures dans deploy/e2e-out/)
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const OUT = path.join(__dirname, 'e2e-out'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 3344, FAKE = 3355, SECRET = 'cle-api-secrete-ne-doit-pas-fuiter';
Object.assign(process.env, { PORT: String(PORT), DB_PATH: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-')), 'd.sqlite'), ADMIN_KEY: 'cle-admin-demo', CONTROL_KEY: 'cle-borne-demo',
  PROVIDER_CINETPAY: 'live', PROVIDER_ORANGE: 'off', PROVIDER_MOOV: 'off', CINETPAY_API_KEY: SECRET, CINETPAY_SITE_ID: '1', CINETPAY_BASE_URL: `http://127.0.0.1:${FAKE}/v2`, SMS_PROVIDER: 'console', RATE_ORDERS_PER_10MIN: '1000' });
const tx = {};   // transaction_id -> { amount, ret, notify, status }
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', async () => {
    const u = new URL(req.url, 'http://x'), json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    if (req.method === 'POST' && u.pathname === '/v2/payment') { const j = JSON.parse(b); tx[j.transaction_id] = { amount: j.amount, ret: j.return_url, notify: j.notify_url, status: 'WAITING_FOR_CUSTOMER', apikey: j.apikey };
      return json({ code: '201', data: { payment_url: `http://127.0.0.1:${FAKE}/pay/${j.transaction_id}`, payment_token: 't' + j.transaction_id } }); }
    if (req.method === 'POST' && u.pathname === '/v2/payment/check') { const t = tx[JSON.parse(b).transaction_id]; return json(t ? { code: '00', data: { status: t.status, amount: t.amount, currency: 'XOF' } } : { code: '627' }); }
    const m = u.pathname.match(/^\/pay\/(CMD-\w+)$/);
    if (m && tx[m[1]]) {
      const t = tx[m[1]];
      if (req.method === 'POST') { t.status = 'ACCEPTED'; await fetch(t.notify, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'cpm_trans_id=' + m[1] }).catch(() => {}); res.statusCode = 302; res.setHeader('Location', t.ret); return res.end(); }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(`<meta charset=utf-8><title>Faux guichet CinetPay</title><body style="font-family:system-ui;padding:30px"><h2>Guichet de paiement (simulation)</h2><p>Montant : <b id=m>${t.amount} XOF</b></p><form method=post><button id=ok style="padding:12px 20px">Payer avec Orange Money / Moov / Wave / Sama Money</button></form></body>`);
    }
    res.statusCode = 404; res.end('{}');
  });
});
const log = []; const ok = (n, c, x) => log.push((c ? 'OK   ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
(async () => {
  const { server } = require('../server.js'), { chromium } = require('playwright');
  await new Promise(r => fake.listen(FAKE, '127.0.0.1', r)); await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const B = `http://localhost:${PORT}`, browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage(), errors = [], seen = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.postData()) seen.push(r.postData()); });
  await page.goto(B + '/'); await page.waitForSelector('article.card');
  // menu commun
  const links = await page.$$eval('.site-menu a', a => a.map(x => x.getAttribute('href')));
  ok('menu de navigation présent', ['/', '/#billets', '/#historique', '/#aide', '/conditions.html', '/confidentialite.html', '/controle.html', '/admin.html'].every(h => links.includes(h)), links.length + ' liens');
  await page.locator('button[data-id]:not([disabled])').first().click(); await page.waitForSelector('#dialog #pay');
  ok('l\'option CinetPay est proposée', (await page.textContent('#op')).includes('CinetPay'));
  await page.click('[data-d="1"]');                                          // 2 places
  const total = (await page.textContent('.total')).replace(/\s/g, ''); await page.fill('#tel', '70112233');
  await page.screenshot({ path: path.join(OUT, '1-reservation.png') });
  const popupP = page.waitForEvent('popup');
  await page.click('#pay'); const pop = await popupP;
  await pop.waitForLoadState(); await pop.waitForSelector('#ok', { timeout: 8000 });
  const amt = Number((await pop.textContent('#m')).replace(/\D/g, ''));
  ok('pop-up de paiement ouverte sur le guichet', true, pop.url().replace(/CMD-\w+/, 'CMD-…'));
  ok('montant du panier transmis au guichet', total.includes(String(amt)) || total.replace(/\D/g, '').startsWith(String(amt)), `${amt} XOF · page : ${total}`);
  await pop.screenshot({ path: path.join(OUT, '2-popup-guichet.png') });
  await pop.click('#ok');                                                    // « paiement » -> notification -> retour
  await page.waitForSelector('text=Paiement confirmé', { timeout: 15000 });
  ok('retour : « Paiement confirmé » dans la page d\'origine', true);
  ok('pop-up refermée automatiquement', await pop.evaluate(() => true).then(() => false).catch(() => true));
  await page.screenshot({ path: path.join(OUT, '3-confirmation.png') });
  await page.click('#go'); await page.waitForSelector('.billet');
  ok('2 billets délivrés', (await page.locator('.billet').count()) === 2);
  ok('la clé API CinetPay n\'apparaît jamais dans le navigateur', !seen.join('').includes(SECRET) && !(await page.content()).includes(SECRET));
  ok('aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
  console.log(log.join('\n')); await browser.close(); server.closeAllConnections(); server.close(); fake.close();
  process.exit(log.some(l => l.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.log(log.join('\n')); console.error('ERREUR :', e.message); process.exit(2); });
