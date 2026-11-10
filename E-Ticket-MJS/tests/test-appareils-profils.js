'use strict';
/* E-Ticket Mali — appareils et profils : téléphones/tablettes Android et iOS = options utilisateurs ; ordinateurs Windows/Mac = version ordinateur ;
   agent de contrôle = uniquement les options de contrôle. Lancer : node tests/test-appareils-profils.js  (Playwright requis). */
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..'), PORT = 3388, B = `http://localhost:${PORT}`;
Object.assign(process.env, { PORT: String(PORT), DB_PATH: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'app-')), 'd.sqlite'), ADMIN_KEY: 'cle-admin-demo', CONTROL_KEY: 'cle-borne-demo', NODE_ENV: 'development', PROVIDER_CINETPAY: 'off', PROVIDER_ORANGE: 'off', PROVIDER_MOOV: 'off', SMS_PROVIDER: 'console' });
const UAS = {
  'Android téléphone': ['mobile', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36', 390],
  'Android tablette': ['mobile', 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 900],
  'iPhone': ['mobile', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1', 390],
  'iPad': ['mobile', 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1', 820],
  'Windows': ['desktop', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 1280],
  'Mac': ['desktop', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15', 1280],
  'Linux': ['autre', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 1280]
};
let pass = 0, fail = 0; const out = [];
const ok = (n, c) => { (c ? pass++ : fail++); out.push((c ? 'OK   ' : 'ÉCHEC ') + n); console.log(out[out.length - 1]); };
(async () => {
  const { server } = require(path.join(ROOT, 'server.js')); await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const { chromium } = require('playwright'), br = await chromium.launch(), errors = [];
  const open = async (ua, w) => { const c = await br.newContext({ userAgent: ua, viewport: { width: w, height: 900 } }), p = await c.newPage(); p.on('pageerror', e => errors.push(e.message)); return { c, p }; };
  const vis = (p, sel) => p.$$eval(sel, l => l.filter(x => x.offsetParent !== null).length);
  const menuLinks = async p => { if (await p.locator('.menu-toggle').isVisible()) await p.click('.menu-toggle'); return p.$$eval('.site-menu a', l => l.filter(a => a.offsetParent !== null).map(a => a.dataset.k || a.getAttribute('href'))); };
  // 1. Matrice des plateformes (visiteur)
  for (const [nom, [plat, ua, w]] of Object.entries(UAS)) {
    const { c, p } = await open(ua, w); await p.goto(B + '/'); await p.waitForSelector('article.card');
    ok(`${nom} : plateforme détectée « ${plat} »`, (await p.evaluate(() => ET.platform)) === plat);
    const staff = (await vis(p, '#staff-btn')) + (await vis(p, '.site-menu a[data-k="/admin.html"]')) + (await vis(p, '.site-menu a[data-k="/controle.html"]'));
    ok(`${nom} : ${plat === 'desktop' ? 'options personnel (Connexion, Contrôle, Admin) visibles' : 'AUCUNE option du personnel'}`, plat === 'desktop' ? staff >= 2 : staff === 0);
    ok(`${nom} : les options utilisateurs sont présentes`, (await vis(p, 'article.card')) > 0);
    await c.close();
  }
  // 2. Administration : bloquée hors ordinateur, même avec une clé valide
  for (const nom of ['Android téléphone', 'iPad', 'Linux']) {
    const { c, p } = await open(UAS[nom][1], UAS[nom][2]); await p.goto(B + '/admin.html'); await p.waitForSelector('#mobile-block');
    ok(`${nom} : page admin bloquée`, (await vis(p, '#key')) === 0 && (await vis(p, '#login')) === 0); await c.close();
  }
  { const { c, p } = await open(UAS.Windows[1], 1280); await p.goto(B + '/admin.html'); await p.waitForSelector('#login', { state: 'visible' }); ok('Windows : page admin utilisable', (await vis(p, '#mobile-block')) === 0); await c.close(); }
  // 3. Agent de contrôle : uniquement les options de contrôle (téléphone ET ordinateur)
  for (const nom of ['Android téléphone', 'iPhone', 'Windows', 'Mac']) {
    const { c, p } = await open(UAS[nom][1], UAS[nom][2]);
    await p.goto(B + '/controle.html'); await p.waitForSelector('#s-login'); await p.fill('#key', 'cle-borne-demo'); await p.click('#b-login');
    await p.waitForSelector('#s-setup:not(.hidden)', { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(600);
    const links = await menuLinks(p);
    ok(`${nom} : agent de contrôle → le menu ne contient que le Contrôle (${links.join(',')})`, links.length === 1 && /controle/.test(links[0]));
    ok(`${nom} : agent de contrôle → bouton de déconnexion présent`, /Déconnexion/.test(await p.textContent('#staff-btn')));
    await p.goto(B + '/'); await p.waitForURL(/controle\.html/, { timeout: 6000 }).catch(() => {});
    ok(`${nom} : agent de contrôle → l'accueil public le renvoie au contrôle`, /controle\.html/.test(p.url()));
    await p.goto(B + '/admin.html'); await p.waitForURL(/controle\.html/, { timeout: 6000 }).catch(() => {});
    ok(`${nom} : agent de contrôle → l'admin le renvoie au contrôle`, /controle\.html/.test(p.url()));
    if (await p.locator('.menu-toggle').isVisible()) await p.click('.menu-toggle'); await p.click('#staff-btn'); await p.waitForTimeout(800);
    ok(`${nom} : déconnexion → retour aux options utilisateurs`, await p.evaluate(() => !localStorage.getItem('eticket-staff')));
    await c.close();
  }
  // 4. Administrateur (ordinateur) : voit toutes les options
  { const { c, p } = await open(UAS.Windows[1], 1280); await p.goto(B + '/'); await p.evaluate(() => localStorage.setItem('eticket-staff', JSON.stringify({ role: 'admin', key: 'cle-admin-demo', exp: Date.now() + 36e5 }))); await p.goto(B + '/'); await p.waitForSelector('article.card');
    const l = await menuLinks(p); ok('Administrateur Windows : Accueil, Contrôle et Admin visibles', l.some(x => /admin/.test(x)) && l.some(x => /controle/.test(x)) && l.some(x => x === '/' || /accueil/.test(x))); await c.close(); }
  ok('aucune erreur JavaScript', errors.length === 0 || (console.log(errors), false));
  await br.close();
  fs.writeFileSync(path.join(__dirname, 'rapport-appareils.txt'), out.join('\n') + `\n\n${pass} réussis, ${fail} échecs\n`);
  console.log(`\n${pass} réussis, ${fail} échecs`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
