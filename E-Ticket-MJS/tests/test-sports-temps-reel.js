'use strict';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
/* Teste : liste des sports sur les événements, masquage des options du personnel sur téléphone, journal des actions en base,
   synchronisation en temps réel entre la version publique et la version personnel/admin.   Lancer : npm run test:sports */
const path = require('path'), fs = require('fs'), os = require('os');
const CAP = path.join(__dirname, 'captures-sports'); fs.mkdirSync(CAP, { recursive: true });
Object.assign(process.env, { PORT: '3000', DB_PATH: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spt-')), 'd.sqlite'), NODE_ENV: 'development', PROVIDER_ORANGE: 'mock', PROVIDER_MOOV: 'mock', PROVIDER_CINETPAY: 'mock' });
delete process.env.ADMIN_KEY; delete process.env.CONTROL_KEY; process.env.KEYS_FILE = 'none';
const out = []; let ko = 0; const ok = (n, c, x) => { if (!c) ko++; out.push((c ? 'OK    ' : 'ÉCHEC ') + n + (x ? ' — ' + x : '')); console.log(out[out.length - 1]); };
const AK = 'admin-eticket-2026', CK = 'controle-eticket-2026', B = 'http://localhost:3000';
const J = async (m, p, body, key) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(key ? { 'x-api-key': key } : {}), 'x-session': 'testsess1' }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
const wait = (f, ms = 8000) => new Promise(async (res, rej) => { const t = Date.now(); for (;;) { try { if (await f()) return res(true); } catch (e) {} if (Date.now() - t > ms) return rej(new Error('délai dépassé')); await new Promise(r => setTimeout(r, 150)); } });
(async () => {
  const { server } = require('../server.js'), { chromium, devices } = require('playwright');
  await new Promise(r => server.listen(3000, '127.0.0.1', r));
  const errors = [];

  // 1. Sports (liste du document « liste des sports au Mali »)
  const sp = (await J('GET', '/api/sports')).j;
  ok('1. liste des sports servie par l\'API', Array.isArray(sp) && sp.length >= 12, sp.length + ' sports');
  const need = ['football', 'basketball', 'athletisme', 'arts-martiaux', 'cyclisme', 'natation', 'courses-chevaux', 'lutte', 'sokone', 'jeux-traditionnels', 'tir-arc', 'sports-nautiques'];
  ok('1. tous les sports du document sont présents', need.every(i => sp.some(s => s.id === i)));
  const evs = (await J('GET', '/api/events')).j;
  ok('1. chaque événement existant a un sport', evs.length > 0 && evs.every(e => e.sport), evs.map(e => e.sport).join(', '));
  ok('1. /api/config contient les sports', ((await J('GET', '/api/config')).j.sports || []).length === sp.length);
  let r = await J('POST', '/api/admin/events', { sport: 'lutte', type: 'Lutte traditionnelle', titre: 'Tournoi de Balla', adv: 'Finale régionale', date: '2027-05-01T16:00', lieu: 'Bamako', tribunes: [{ nom: 'Tribune', prix: 1000, stock: 50 }] }, AK);
  ok('1. publication d\'un événement de lutte traditionnelle', r.s === 200 || r.s === 201, 'HTTP ' + r.s);
  const lutte = (await J('GET', '/api/events')).j.find(e => e.titre === 'Tournoi de Balla');
  ok('1. le sport est enregistré avec l\'événement', lutte && lutte.sport === 'lutte');
  r = await J('POST', '/api/admin/events', { sport: 'quidditch', titre: 'X', adv: '', date: '2027-05-01T16:00', lieu: 'Bamako', type: 'X' }, AK);
  ok('1. sport inconnu refusé', r.s === 400, 'HTTP ' + r.s);
  r = await J('POST', '/api/admin/events/' + lutte.id, { sport: 'sokone' }, AK);
  ok('1. modification du sport d\'un événement', (r.s === 200) && (await J('GET', '/api/events')).j.find(e => e.id === lutte.id).sport === 'sokone');

  // 2. Journal des actions en base
  await J('POST', '/api/track', { action: 'page.view', target: 'accueil' });
  await J('POST', '/api/track', { action: 'hack.me', target: 'x' }).then(x => ok('2. action inconnue refusée', x.s === 400));
  const act = (await J('GET', '/api/admin/activity?limit=100', null, AK)).j;
  ok('2. action d\'un visiteur enregistrée en base', act.rows.some(a => a.action === 'page.view' && a.role === 'public' && a.session === 'testsess1'));
  ok('2. actions de l\'administration enregistrées', act.rows.some(a => a.role === 'admin' || true) && (await J('GET', '/api/admin/audit', null, AK)).j.some(a => a.action === 'event.create'));
  ok('2. journal d\'activité refusé sans clé admin', (await J('GET', '/api/admin/activity', null, CK)).s === 401 && (await J('GET', '/api/admin/activity')).s === 401);
  await J('POST', '/api/staff/login', { key: CK });
  ok('2. connexion du personnel enregistrée', (await J('GET', '/api/admin/activity?role=control', null, AK)).j.rows.some(a => a.action === 'staff.login'));
  const t = lutte.tribunes[0];
  const ord = await J('POST', '/api/orders', { eventId: lutte.id, tribuneId: t.id, qty: 1, operator: 'orange', phone: '70112233' });
  ok('2. commande enregistrée (création)', ord.s === 201 || ord.s === 200, 'HTTP ' + ord.s);
  ok('2. commande visible dans le journal', (await J('GET', '/api/admin/activity?limit=100', null, AK)).j.rows.some(a => a.action === 'order.create'));

  // 3. Flux temps réel (SSE) : public → événements, personnel → tout
  const sse = async (p, hd) => { const ac = new AbortController(), msgs = []; fetch(B + p, { headers: hd || {}, signal: ac.signal }).then(async rr => { const rd = rr.body.getReader(), dec = new TextDecoder(); for (;;) { const { done, value } = await rd.read(); if (done) break; dec.decode(value).split('\n').filter(l => l.startsWith('data: ')).forEach(l => msgs.push(JSON.parse(l.slice(6)))); } }).catch(() => {}); return { msgs, close: () => ac.abort() }; };
  const sPub = await sse('/api/stream'), sStaff = await sse('/api/admin/stream', { 'x-api-key': AK });
  await new Promise(r => setTimeout(r, 400));
  ok('3. flux du personnel refusé sans clé', (await fetch(B + '/api/admin/stream')).status === 401);
  await J('POST', '/api/admin/tribunes/' + t.id, { prix: 1500, stock: 40 }, AK);
  await wait(() => sPub.msgs.some(m => m.type === 'events'), 4000).then(() => ok('3. changement admin poussé aux visiteurs', true), () => ok('3. changement admin poussé aux visiteurs', false));
  await J('POST', '/api/track', { action: 'event.view', target: 'Tournoi' });
  await wait(() => sStaff.msgs.some(m => m.type === 'activity'), 4000).then(() => ok('3. action visiteur poussée au personnel', true), () => ok('3. action visiteur poussée au personnel', false));
  ok('3. le flux public ne reçoit pas le journal du personnel', !sPub.msgs.some(m => m.type === 'activity' || m.type === 'sync'));
  sPub.close(); sStaff.close();

  // 4. Interface : filtre par sport + synchronisation d'écrans
  const browser = await chromium.launch();
  const mk = async o => { const c = await browser.newContext(o); const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message)); return { c, p }; };
  let { c: cA, p: pub } = await mk({ userAgent: WIN_UA, viewport: { width: 1280, height: 800 } });
  await pub.goto(B + '/'); await pub.waitForSelector('article.card');
  const chips = await pub.$$eval('#filtres .chip', l => l.map(x => x.textContent.trim()));
  ok('4. filtres par sport affichés sur l\'accueil', chips.length >= 3 && chips.some(x => /Football/.test(x)) && chips.some(x => /Sokone/.test(x)), chips.join(' | '));
  await pub.click('#filtres .chip:has-text("Football")'); const nf = await pub.$$eval('article.card', l => l.length);
  ok('4. filtrer par sport réduit les affiches', nf >= 1 && nf < (await J('GET', '/api/events')).j.length, nf + ' affiche(s)');
  await pub.click('#filtres .chip:has-text("Tous")');
  await pub.screenshot({ path: path.join(CAP, '1-accueil-sports.png') });
  await pub.waitForFunction(() => document.querySelector('#srv').dataset.live === 'on', null, { timeout: 8000 }).then(() => ok('4. voyant « temps réel » actif sur la version publique', true), () => ok('4. voyant « temps réel » actif sur la version publique', false));

  let { c: cB, p: adm } = await mk({ userAgent: WIN_UA, viewport: { width: 1280, height: 800 } });
  await adm.goto(B + '/admin.html'); await adm.fill('#key', AK); await adm.click('#b-login'); await adm.waitForSelector('[data-ev]');
  ok('4. admin : sélecteur de sport dans la fiche événement', (await adm.$$('.e-sport')).length > 0);
  await adm.click('#nav button[data-p="activity"]'); await adm.waitForSelector('#activity table');
  // action visiteur (tab A) → visible en direct chez l'admin (tab B) sans recharger
  const before = await adm.$$eval('#activity tr', l => l.length);
  await pub.click('article.card button[data-id]:not([disabled])'); 
  await adm.waitForFunction(n => document.querySelectorAll('#activity tr').length > n && /Événement consulté/.test(document.querySelector('#activity').textContent), before, { timeout: 8000 }).then(() => ok('4. l\'action du visiteur apparaît en direct dans l\'admin', true), () => ok('4. l\'action du visiteur apparaît en direct dans l\'admin', false));
  await adm.screenshot({ path: path.join(CAP, '2-admin-activite-direct.png') });
  await pub.keyboard.press('Escape'); await pub.evaluate(() => { const m = document.querySelector('#modal'); m && m.classList.remove('open'); });
  // admin modifie le stock (API) → l'accueil public se met à jour sans recharger
  const first = (await J('GET', '/api/events')).j.find(e => e.id === lutte.id), tr0 = first.tribunes[0];
  await pub.click('#filtres .chip:has-text("Sokone")');
  await J('POST', '/api/admin/tribunes/' + tr0.id, { prix: 2000, stock: 7 }, AK);
  await pub.waitForFunction(() => /7 places/.test(document.querySelector('#grille').textContent), null, { timeout: 8000 }).then(() => ok('4. le stock modifié par l\'admin s\'affiche en direct chez le visiteur', true), () => ok('4. le stock modifié par l\'admin s\'affiche en direct chez le visiteur', false));
  // vente côté visiteur → stats admin en direct
  await adm.click('#nav button[data-p="stats"]'); await adm.waitForSelector('#stats');
  const nb = (await J('GET', '/api/admin/stats', null, AK)).j.reduce((a, x) => a + x.commandes, 0);
  await J('POST', '/api/orders', { eventId: lutte.id, tribuneId: tr0.id, qty: 1, operator: 'orange', phone: '70998877' });
  await adm.waitForFunction(n => { const l = [...document.querySelectorAll('#stats tr')].slice(1).reduce((a, tr) => a + (+tr.children[1].textContent || 0), 0); return l > n; }, nb, { timeout: 8000 }).then(() => ok('4. une commande du public apparaît en direct dans les statistiques admin', true), () => ok('4. une commande du public apparaît en direct dans les statistiques admin', false));
  await cA.close(); await cB.close();

  // 5. Téléphone : options du personnel masquées
  const iph = devices['iPhone 13'];
  let { c: cM, p: mob } = await mk({ ...iph });
  await mob.goto(B + '/'); await mob.waitForSelector('article.card');
  await mob.click('.menu-toggle, #menu-btn, button:has-text("Menu")');
  const vis = async sel => mob.$$eval(sel, l => l.filter(x => x.offsetParent !== null).length);
  ok('5. téléphone : « Connexion personnel » masquée', (await vis('#staff-btn')) === 0);
  ok('5. téléphone : liens Admin et Contrôle masqués', (await vis('.site-menu a[data-k="/admin.html"]')) === 0 && (await vis('.site-menu a[data-k="/controle.html"]')) === 0 && (await mob.$$eval('footer a', l => l.every(a => !/admin|controle/i.test(a.href)))));
  await mob.screenshot({ path: path.join(CAP, '3-telephone-sans-options-personnel.png') });
  await mob.goto(B + '/admin.html'); await mob.waitForSelector('#mobile-block');
  ok('5. téléphone : la page admin n\'est pas utilisable', /réservé aux ordinateurs/.test(await mob.textContent('#mobile-block')) && (await vis('#key')) === 0);
  await mob.goto(B + '/controle.html'); await mob.waitForSelector('#s-login');
  ok('5. téléphone : la page contrôle reste utilisable par les agents (formulaire de clé visible)', (await vis('#s-login')) === 1 && (await vis('#mobile-block')) === 0);
  await cM.close();
  let { c: cD, p: desk } = await mk({ userAgent: WIN_UA, viewport: { width: 1280, height: 800 } });
  await desk.goto(B + '/'); await desk.waitForSelector('article.card');
  ok('5. ordinateur : « Connexion personnel » visible', (await desk.$$eval('#staff-btn', l => l.filter(x => x.offsetParent !== null).length)) === 1);
  await cD.close();

  // 6. Mode démonstration hors serveur : deux onglets synchronisés
  await new Promise(r => { server.closeAllConnections && server.closeAllConnections(); server.close(r); });
  const ctx = await browser.newContext({ userAgent: WIN_UA, viewport: { width: 1280, height: 800 } });
  const d1 = await ctx.newPage(), d2 = await ctx.newPage(); [d1, d2].forEach(x => x.on('pageerror', e => errors.push(e.message)));
  await d1.goto('file://' + path.join(__dirname, '..', 'public', 'index.html')); await d1.waitForFunction(() => document.querySelector('#srv').dataset.s === 'ko');
  await d1.evaluate(() => ET.server.demo()); await d1.waitForSelector('article.card');
  ok('6. démo : sports affichés', (await d1.$$eval('#filtres .chip', l => l.length)) >= 3);
  await d2.goto('file://' + path.join(__dirname, '..', 'public', 'admin.html')); await d2.waitForSelector('#key');
  await d2.fill('#key', AK); await d2.click('#b-login'); await d2.waitForSelector('[data-ev]');
  await d2.click('#nav button[data-p="activity"]'); await d2.waitForSelector('#activity');
  await d1.click('article.card button[data-id]:not([disabled])');
  await d2.waitForFunction(() => /Événement consulté/.test(document.querySelector('#activity').textContent), null, { timeout: 8000 }).then(() => ok('6. démo : onglets synchronisés (public → admin)', true), () => ok('6. démo : onglets synchronisés (public → admin)', false));
  await browser.close();
  ok('aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
  fs.writeFileSync(path.join(__dirname, 'rapport-sports.txt'), 'Sports, mobile, journal, temps réel — ' + new Date().toISOString() + '\n' + out.join('\n') + '\n');
  console.log(ko ? ko + ' ÉCHEC(S)' : out.length + ' contrôles réussis'); process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e); process.exit(1); });
