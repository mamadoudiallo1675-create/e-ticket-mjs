'use strict';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
/* Teste : images locales de chaque sport, carrousels automatiques (affiches + section « Sports du Mali »), fond du site,
   fonctionnement en mode démo (fichier ouvert directement), ajout d'une photo déposée dans un dossier.   Lancer : npm run test:images */
const path = require('path'), fs = require('fs'), os = require('os');
const CAP = path.join(__dirname, 'captures-images'); fs.mkdirSync(CAP, { recursive: true });
Object.assign(process.env, { PORT: '3000', DB_PATH: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spt-')), 'd.sqlite'), NODE_ENV: 'development', PROVIDER_ORANGE: 'mock', PROVIDER_MOOV: 'mock', PROVIDER_CINETPAY: 'mock' });
delete process.env.ADMIN_KEY; delete process.env.CONTROL_KEY; process.env.KEYS_FILE = 'none';
const out = []; let ko = 0; const ok = (n, c, x) => { if (!c) ko++; out.push((c ? 'OK    ' : 'ÉCHEC ') + n + (x ? ' — ' + x : '')); console.log(out[out.length - 1]); };
const B = 'http://localhost:3000', PUB = path.join(__dirname, '..', 'public');
(async () => {
  const { server } = require('../server.js'), { chromium } = require('playwright'), sports = require('../sports');
  await new Promise(r => server.listen(3000, '127.0.0.1', r));
  const errors = [];
  // 1. Fichiers
  const ids = sports.SPORTS.map(s => s.id);
  ok('1. 13 sports, chacun avec au moins 3 images locales', ids.length === 13 && ids.every(i => sports.images(i).length >= 3), ids.map(i => sports.images(i).length).join(','));
  ok('1. toutes les images existent sur le disque', ids.every(i => sports.images(i).every(u => fs.existsSync(path.join(PUB, u)))));
  ok('1. fonds présents', fs.existsSync(path.join(PUB, 'img/fond-jeunesse.svg')) && fs.existsSync(path.join(PUB, 'img/fond-hero.svg')));
  const cfg = await (await fetch(B + '/api/config')).json();
  ok('1. /api/config fournit les images de chaque sport', cfg.sports.every(s => s.images.length >= 3));
  const img = await fetch(B + '/' + cfg.sports[0].images[0]);
  ok('1. image servie avec le bon type', img.status === 200 && /image\/svg/.test(img.headers.get('content-type')));
  // 2. Navigateur
  const browser = await chromium.launch();
  const pub = await (await browser.newContext({ userAgent: WIN_UA, viewport: { width: 1280, height: 900 } })).newPage();
  pub.on('pageerror', e => errors.push(e.message)); pub.on('requestfailed', r => /img\//.test(r.url()) && errors.push('image ' + r.url()));
  await pub.goto(B + '/'); await pub.waitForSelector('article.card .car');
  ok('2. chaque affiche contient un carrousel', await pub.$$eval('article.card', l => l.length > 0 && l.every(c => c.querySelectorAll('.car-img').length >= 3)));
  const first = await pub.$eval('article.card .car', c => [...c.querySelectorAll('.car-img')].findIndex(i => i.classList.contains('on')));
  await pub.waitForTimeout(6500);
  const later = await pub.$eval('article.card .car', c => [...c.querySelectorAll('.car-img')].findIndex(i => i.classList.contains('on')));
  ok('2. le carrousel défile automatiquement', later !== first, first + ' → ' + later);
  ok('2. images réellement chargées (non cassées)', await pub.$$eval('.car-img.on', l => l.length > 0 && l.every(i => i.complete && i.naturalWidth > 0)));
  const autres = await pub.$$eval('.sport-card', l => l.map(c => c.dataset.sport));
  const avecAffiche = await pub.$$eval('article.card .affiche .car', l => [...new Set(l.map(c => c.dataset.sport))]);
  ok('2. « Autres affiches » : uniquement les sports sans affiche', autres.length > 0 && autres.every(i => !avecAffiche.includes(i)) && autres.length + avecAffiche.length === 13, autres.join(','));
  ok('2. section renommée « Autres affiches »', /Autres affiches/.test(await pub.$eval('.sports-titre', h => h.textContent)) && !/Les sports du Mali/.test(await pub.content()));
  ok('2. chaque carte a un carrousel, la mention Bientôt et un bouton de réservation', await pub.$$eval('.sport-card', l => l.every(c => c.querySelectorAll('.car-img').length >= 3 && /Bientôt/.test(c.querySelector('.sc-n').textContent) && c.querySelector('button.btn') && /Bientôt disponible/.test(c.querySelector('button.btn').textContent))));
  await pub.hover('article.card .affiche');
  const h1 = await pub.$eval('article.card .car', c => [...c.querySelectorAll('.car-img')].findIndex(i => i.classList.contains('on')));
  await pub.waitForTimeout(4800);
  ok('2. pause du défilement au survol', h1 === await pub.$eval('article.card .car', c => [...c.querySelectorAll('.car-img')].findIndex(i => i.classList.contains('on'))));
  await pub.mouse.move(5, 5);
  const bg = await pub.evaluate(() => getComputedStyle(document.body).backgroundImage);
  ok('2. image d\'arrière-plan du site appliquée', /fond-jeunesse\.svg/.test(bg));
  ok('2. bandeau d\'accueil avec image', /fond-hero\.svg/.test(await pub.$eval('.hero', h => getComputedStyle(h).backgroundImage)));
  await pub.evaluate(() => window.scrollTo(0, 0)); await pub.screenshot({ path: path.join(CAP, 'accueil-bureau.png') });
  await pub.evaluate(() => document.querySelector('.sports-titre').scrollIntoView()); await pub.screenshot({ path: path.join(CAP, 'sports-bureau.png') });
  // 3. Téléphone
  const ph = await (await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true })).newPage();
  ph.on('pageerror', e => errors.push(e.message));
  await ph.goto(B + '/'); await ph.waitForSelector('.sport-card');
  ok('3. téléphone : pas de défilement horizontal', await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ph.screenshot({ path: path.join(CAP, 'accueil-telephone.png') });
  // 4. Photo déposée par le ministère
  const dir = path.join(PUB, 'img/sports/football'), f = path.join(dir, '9-photo-test.svg');
  fs.copyFileSync(path.join(dir, '1.svg'), f);
  try { const c2 = await (await fetch(B + '/api/config')).json(); ok('4. une image déposée dans le dossier apparaît sans modifier le code', c2.sports.find(s => s.id === 'football').images.length === 4); }
  finally { fs.unlinkSync(f); }
  // 5. Mode démo (fichier ouvert directement)
  const d = await (await browser.newContext({ userAgent: WIN_UA, viewport: { width: 1280, height: 900 } })).newPage();
  d.on('pageerror', e => errors.push('démo ' + e.message));
  await d.goto('file://' + path.join(PUB, 'index.html')); await d.evaluate(() => ET.server.demo()); await d.waitForSelector('article.card .car');
  ok('5. démo : carrousels et 13 sports', (await d.$$eval('.sport-card', l => l.length)) > 5 && (await d.$$eval('.car-img', l => l.length)) > 20);
  await d.waitForTimeout(800);
  ok('5. démo : images chargées', await d.$$eval('.car-img.on', l => l.length > 0 && l.every(i => i.complete && i.naturalWidth > 0)));
  // 6. Pages du personnel sans image de fond
  const a = await (await browser.newContext({ userAgent: WIN_UA, viewport: { width: 1280, height: 800 } })).newPage();
  await a.goto(B + '/admin.html'); ok('6. page admin sans fond décoratif', !/fond-jeunesse/.test(await a.evaluate(() => getComputedStyle(document.body).backgroundImage)));
  await browser.close();
  ok('aucune erreur JavaScript / image', errors.length === 0, errors.join(' | '));
  fs.writeFileSync(path.join(__dirname, 'rapport-images.txt'), 'Images, carrousels, fond — ' + new Date().toISOString() + '\n' + out.join('\n') + '\n');
  console.log(ko ? ko + ' ÉCHEC(S)' : out.length + ' contrôles réussis'); process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e); process.exit(1); });
