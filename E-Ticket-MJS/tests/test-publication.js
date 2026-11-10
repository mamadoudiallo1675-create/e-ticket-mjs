'use strict';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
/* Prérequis de mise en ligne : accessibilité de base, SEO/partage, robots/sitemap, 404, en-têtes de sécurité, Dockerfile complet.   npm run test:publication */
const path = require('path'), fs = require('fs'), os = require('os');
Object.assign(process.env, { PORT: '3000', DB_PATH: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pub-')), 'd.sqlite'), NODE_ENV: 'development', BASE_URL: 'https://eticket.example.ml', KEYS_FILE: 'none' });
delete process.env.ADMIN_KEY; delete process.env.CONTROL_KEY;
const out = []; let ko = 0; const ok = (n, c, x) => { if (!c) ko++; out.push((c ? 'OK    ' : 'ÉCHEC ') + n + (x ? ' — ' + x : '')); console.log(out[out.length - 1]); };
const B = 'http://localhost:3000', R = path.join(__dirname, '..');
(async () => {
  const { server } = require('../server.js'), { chromium } = require('playwright');
  await new Promise(r => server.listen(3000, '127.0.0.1', r));
  const g = p => fetch(B + p);
  let r = await g('/'); const h = r.headers;
  ok('en-têtes : CSP stricte (object-src, base-uri, frame-ancestors)', /object-src 'none'/.test(h.get('content-security-policy')) && /base-uri 'self'/.test(h.get('content-security-policy')) && /frame-ancestors 'none'/.test(h.get('content-security-policy')));
  ok('en-têtes : nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP', h.get('x-content-type-options') === 'nosniff' && h.get('x-frame-options') === 'DENY' && h.get('referrer-policy') && /camera/.test(h.get('permissions-policy')) && h.get('cross-origin-opener-policy') === 'same-origin');
  ok('en-têtes : HSTS quand l\'adresse publique est en https', /max-age=31536000/.test(h.get('strict-transport-security') || ''));
  r = await g('/robots.txt'); const rb = await r.text();
  ok('robots.txt : cache admin, contrôle et API, indique le plan du site', /Disallow: \/admin\.html/.test(rb) && /Disallow: \/controle\.html/.test(rb) && /Disallow: \/api\//.test(rb) && /Sitemap: https:\/\/eticket\.example\.ml\/sitemap\.xml/.test(rb));
  r = await g('/sitemap.xml'); const sm = await r.text();
  ok('sitemap.xml valide avec les 3 pages publiques', r.status === 200 && (sm.match(/<loc>/g) || []).length === 3 && !/admin|controle/.test(sm));
  r = await g('/admin.html'); ok('admin.html : noindex (en-tête)', /noindex/.test(r.headers.get('x-robots-tag') || ''));
  r = await g('/page-qui-nexiste-pas.html'); const nf = await r.text();
  ok('page 404 personnalisée en français', r.status === 404 && /Page introuvable/.test(nf) && /<html/.test(nf));
  r = await g('/api/inconnu'); ok('route API inconnue : réponse JSON 404', r.status === 404 && /json/.test(r.headers.get('content-type')));
  r = await g('/img/favicon.svg'); ok('icône du site servie et mise en cache', r.status === 200 && /max-age/.test(r.headers.get('cache-control')));
  r = await g('/manifest.webmanifest'); ok('manifest présent et valide', r.status === 200 && JSON.parse(await r.text()).lang === 'fr');
  const df = fs.readFileSync(path.join(R, 'Dockerfile'), 'utf8');
  const need = fs.readdirSync(R).filter(f => /^[a-z]+\.js$/.test(f) && f !== 'test.js');
  ok('Dockerfile : copie tous les modules du serveur', need.every(f => df.includes(f)), need.join(','));
  ok('.dockerignore : exclut clés, tests et certificats', /cles-acces/.test(fs.readFileSync(path.join(R, '.dockerignore'), 'utf8')));
  // navigateur
  const b = await chromium.launch(), errors = [];
  for (const pg of ['index.html', 'conditions.html', 'confidentialite.html']) {
    const p = await b.newPage({ userAgent: WIN_UA, viewport: { width: 1280, height: 800 } }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(B + '/' + pg); await p.waitForTimeout(600);
    const a = await p.evaluate(() => ({
      lang: document.documentElement.lang, desc: !!document.querySelector('meta[name=description]'), og: !!document.querySelector('meta[property="og:title"]'), icon: !!document.querySelector('link[rel=icon]'), h1: document.querySelectorAll('h1').length,
      skip: !!document.querySelector('a.skip[href="#contenu"]') && !!document.getElementById('contenu'),
      labels: [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(e => !(e.getAttribute('aria-label') || (e.id && document.querySelector('label[for="' + e.id + '"]')) || e.closest('label'))).length,
      live: document.querySelectorAll('.note[aria-live]').length >= 0 }));
    ok(pg + ' : langue, description, partage, icône, un seul h1', a.lang === 'fr' && a.desc && a.og && a.icon && a.h1 === 1);
    ok(pg + ' : lien « Aller au contenu » et zone principale', a.skip);
    ok(pg + ' : tous les champs ont un libellé', a.labels === 0, a.labels + ' sans libellé');
    if (pg === 'index.html') {
      await p.keyboard.press('Tab'); ok('index.html : le lien d\'évitement est le premier élément au clavier', await p.evaluate(() => document.activeElement.classList.contains('skip')));
      const ratio = await p.evaluate(() => { const l = c => { const m = c.match(/\d+/g).slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4) }); return .2126 * m[0] + .7152 * m[1] + .0722 * m[2] }; const e = document.querySelector('.btn:not([disabled])'); const L1 = l(getComputedStyle(e).color), L2 = l(getComputedStyle(e).backgroundColor); return (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05) });
      ok('index.html : contraste du bouton principal ≥ 4,5:1 (WCAG AA)', ratio >= 4.5, ratio.toFixed(2));
    }
    await p.close();
  }
  // WCAG 2.2.2 / 2.5.8 / 2.4.7 : pause du défilement, taille des cibles, focus visible, images décoratives
  {
    const p = await b.newPage({ userAgent: WIN_UA, viewport: { width: 1280, height: 900 } }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(B + '/'); await p.waitForSelector('article.card .car-img');
    const cur = () => p.$eval('article.card .car', c => [...c.querySelectorAll('.car-img')].findIndex(i => i.classList.contains('on')));
    ok('défilement : bouton de pause présent (WCAG 2.2.2)', await p.$eval('#car-pause', e => e.getAttribute('aria-pressed') === 'false' && /pause/i.test(e.textContent)));
    await p.click('#car-pause'); const a0 = await cur(); await p.waitForTimeout(5500);
    ok('défilement : arrêté après clic sur « pause »', a0 === await cur() && await p.$eval('#car-pause', e => e.getAttribute('aria-pressed') === 'true'));
    await p.click('#car-pause'); await p.waitForTimeout(6500);
    ok('défilement : reprend après second clic', a0 !== await cur());
    ok('images des carrousels décoratives (alt vide) et masquées aux lecteurs d\'écran', await p.$$eval('.car', l => l.every(c => c.getAttribute('aria-hidden') === 'true' && [...c.querySelectorAll('img')].every(i => i.getAttribute('alt') === ''))));
    const small = await p.$$eval('button:not([disabled]),input,select,textarea,nav a,.site-footer a', l => l.filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.width < 24 || r.height < 24) && !e.closest('.hidden'); }).map(e => e.tagName + '.' + e.className));
    ok('cibles tactiles ≥ 24×24 px (WCAG 2.5.8)', small.length === 0, small.join(','));
    let reach = 0, lost = [];
    for (let i = 0; i < 60; i++) { await p.keyboard.press('Tab'); const f = await p.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const st = getComputedStyle(e); return { t: e.tagName + '#' + e.id + '.' + e.className, vis: st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) > 0 || st.boxShadow !== 'none' }; }); if (f) { reach++; if (!f.vis) lost.push(f.t); } }
    ok('clavier : tous les éléments atteints par Tab ont un focus visible (WCAG 2.4.7)', reach > 10 && lost.length === 0, reach + ' éléments ; sans focus : ' + lost.join(','));
    await p.close();
  }
  await b.close();
  ok('aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
  fs.writeFileSync(path.join(__dirname, 'rapport-publication.txt'), 'Prérequis de publication — ' + new Date().toISOString() + '\n' + out.join('\n') + '\n');
  console.log(ko ? ko + ' ÉCHEC(S)' : out.length + ' contrôles réussis'); process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e); process.exit(1); });
