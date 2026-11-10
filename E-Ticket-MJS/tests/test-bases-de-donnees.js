'use strict';
/* Vérifie l'organisation des données : une base par domaine, du type adapté (voir BASES-DE-DONNEES.md).
   Lancer : npm run test:bases */
const path = require('path'), fs = require('fs'), os = require('os'), { spawnSync } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bases-'));
Object.assign(process.env, { PORT: '3411', DB_PATH: path.join(tmp, 'utilisateurs.sqlite'), NODE_ENV: 'development', PROVIDER_ORANGE: 'mock', PROVIDER_MOOV: 'mock', PROVIDER_CINETPAY: 'mock',
  ADMIN_KEY: 'Direction=ADM-KEY-test-0123456789abcdef', CONTROL_KEY: 'Porte A=CTL-KEY-A-0123456789abcd,Porte B=CTL-KEY-B-0123456789abcd' });
const out = []; let ko = 0; const ok = (n, c, x) => { if (!c) ko++; out.push((c ? 'OK    ' : 'ÉCHEC ') + n + (x ? ' — ' + x : '')); console.log(out[out.length - 1]); };
const B = 'http://127.0.0.1:3411', AK = 'ADM-KEY-test-0123456789abcdef', CA = 'CTL-KEY-A-0123456789abcd', CB = 'CTL-KEY-B-0123456789abcd';
const J = async (m, p, body, key) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(key ? { 'x-api-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
const node = (code, env) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', code], { cwd: path.join(__dirname, '..'), env: { ...process.env, ...env }, encoding: 'utf8' });
(async () => {
  const store = require('../db'), { server } = require('../server.js');
  await new Promise(r => server.listen(3411, '127.0.0.1', r));

  // 1. Une base par domaine, au bon endroit
  const has = (schema, t) => !!store.db.prepare(`SELECT 1 FROM ${schema}.sqlite_master WHERE type='table' AND name=?`).get(t);
  ok('1. UTILISATEURS (relationnelle) : orders, tickets, otp, sessions, support', ['orders', 'tickets', 'otp', 'sessions', 'support'].every(t => has('main', t)));
  ok('1. ADMIN (relationnelle) : events, tribunes, admin_log', ['events', 'tribunes', 'admin_log'].every(t => has('admin', t)));
  ok('1. PERSONNEL (relationnelle) : staff, staff_log', ['staff', 'staff_log'].every(t => has('personnel', t)));
  ok('1. aucune table d\'un autre domaine dans la base utilisateurs', !['events', 'tribunes', 'admin_log', 'staff'].some(t => has('main', t)));
  ok('1. fichiers : 3 bases SQLite + dossiers contrôle et journal (documents)', ['utilisateurs.sqlite', 'admin.sqlite', 'personnel.sqlite'].every(f => fs.existsSync(path.join(tmp, f))) && fs.statSync(path.join(tmp, 'controle')).isDirectory() && fs.statSync(path.join(tmp, 'journal')).isDirectory());
  const inv = (await J('GET', '/api/admin/databases', null, AK)).j;
  ok('1. inventaire des bases servi à l\'administration', Array.isArray(inv) && inv.length === 5 && inv.filter(d => /^Relationnelle/.test(d.type)).length === 3 && inv.filter(d => /^Non relationnelle/.test(d.type)).length === 2, inv.map(d => d.domaine + ' = ' + d.type.split(' ')[0] + ' ' + d.type.split(' ')[1]).join(' | '));
  ok('1. inventaire réservé à l\'administration', (await J('GET', '/api/admin/databases', null, CA)).s === 401 && (await J('GET', '/api/admin/databases')).s === 401);

  // 2. Transaction multi-bases : tout ou rien (commande = stock en base admin + commande en base utilisateurs)
  const ev = (await J('GET', '/api/events')).j.find(e => e.tribunes.some(t => t.stock >= 5)), tr = ev.tribunes.find(t => t.stock >= 5);
  const stock0 = store.db.prepare('SELECT stock FROM tribunes WHERE id=?').get(tr.id).stock, n0 = store.db.prepare('SELECT COUNT(*) c FROM orders').get().c;
  try { store.tx(() => { store.db.prepare('UPDATE tribunes SET stock=stock-2 WHERE id=?').run(tr.id); store.db.prepare("INSERT INTO orders(ref,token_hash,event_id,tribune_id,qty,total,operator,phone,created_at,updated_at) VALUES('X','h',?,?,2,1,'orange','70000000',1,1)").run(ev.id, tr.id); throw new Error('panne simulée'); }); } catch (e) {}
  ok('2. panne au milieu d\'une commande : stock (admin) ET commande (utilisateurs) annulés ensemble', store.db.prepare('SELECT stock FROM tribunes WHERE id=?').get(tr.id).stock === stock0 && store.db.prepare('SELECT COUNT(*) c FROM orders').get().c === n0);

  // 3. Parcours : achat → billet → contrôle (base documents)
  const o = await J('POST', '/api/orders', { eventId: ev.id, tribuneId: tr.id, qty: 2, operator: 'orange', phone: '70112233' });
  const ref = o.j.ref; await fetch(B + '/sandbox/pay/' + ref + '/ok', { method: 'POST', redirect: 'manual' });
  const paid = (await J('GET', `/api/orders/${ref}?token=${o.j.token}`)).j, code = paid.tickets[0].code;
  ok('3. billet émis dans la base utilisateurs (relationnelle)', paid.status === 'PAID' && store.db.prepare('SELECT COUNT(*) c FROM tickets WHERE order_id=(SELECT id FROM orders WHERE ref=?)').get(ref).c === 2);
  ok('3. stock décrémenté dans la base admin', store.db.prepare('SELECT stock FROM tribunes WHERE id=?').get(tr.id).stock === stock0 - 2);
  const v1 = (await J('POST', '/api/admin/validate', { code, eventId: ev.id }, CA)).j, v2 = (await J('POST', '/api/admin/validate', { code, eventId: ev.id }, CB)).j;
  ok('3. entrée inscrite dans la base de contrôle (documents) : 1re valide, 2e (autre borne) refusée', v1.result === 'valid' && v2.result === 'already_used');
  const ent = store.ctl.entrees.get(code), sc = store.ctl.scans.recent(10, d => d.code === code);
  ok('3. document « entrées » : clé = code du billet, avec poste de contrôle', ent && ent.poste === 'Porte A' && ent.event === ev.id, JSON.stringify(ent));
  ok('3. journal des passages : 2 documents (accepté + refusé) avec le poste', sc.length === 2 && sc.map(d => d.result + '@' + d.poste).sort().join() === 'already_used@Porte B,valid@Porte A', sc.map(d => d.result + '@' + d.poste).join(', '));
  ok('3. le billet n\'est PAS modifié dans la base utilisateurs (usage = fait de contrôle)', !store.db.prepare('PRAGMA table_info(tickets)').all().some(c => /status|used/.test(c.name)));
  ok('3. le client voit « utilisé » (lecture croisée)', (await J('GET', `/api/orders/${ref}?token=${o.j.token}`)).j.tickets[0].status === 'USED');
  ok('3. statistiques admin : entrées comptées depuis la base de contrôle', (await J('GET', '/api/admin/events', null, AK)).j.find(e => e.id === ev.id).entres === 1);
  ok('3. contrôle : fausse clé / clé révoquée refusées', (await J('POST', '/api/admin/validate', { code }, 'nimporte')).s === 401);

  // 4. Base documents : lecture seule, atomique, tolérante aux coupures
  let refused = 0; try { store.ctl.entrees.put(code, { x: 1 }); } catch (e) { refused++; } try { store.ctl.entrees.del(code); } catch (e) { refused++; }
  ok('4. documents d\'entrée non modifiables ni supprimables', refused === 2);
  ok('4. putIfAbsent atomique', store.ctl.entrees.putIfAbsent(code, { y: 1 }).created === false);
  const ndj = path.join(tmp, 'controle', 'entrees.ndjson');
  ok('4. écrit à plat, en ajout seul (NDJSON lisible)', fs.readFileSync(ndj, 'utf8').trim().split('\n').every(l => { try { JSON.parse(l); return true; } catch (e) { return false; } }));
  fs.appendFileSync(ndj, '{"k":"ML-COUPE","t":1,"d":{"ev');       // coupure de courant en pleine écriture
  const rc = node(`const {DocStore}=require('./docstore');const c=new DocStore(process.env.D).collection('entrees');console.log(JSON.stringify({n:c.count(),bad:c.corrupt,has:c.has(process.env.C)}))`, { D: path.join(tmp, 'controle'), C: code });
  ok('4. après coupure : ligne tronquée ignorée, données intactes', JSON.parse(rc.stdout || '{}').n === 1 && JSON.parse(rc.stdout || '{}').bad === 1 && JSON.parse(rc.stdout || '{}').has === true, rc.stdout.trim() + rc.stderr.slice(0, 120));
  fs.writeFileSync(ndj, fs.readFileSync(ndj, 'utf8').replace(/\{"k":"ML-COUPE.*$/, ''));

  // 5. Personnel : comptes en base relationnelle, clés hachées, révocation
  const st = (await J('GET', '/api/admin/staff', null, AK)).j;
  ok('5. comptes créés depuis la configuration (noms conservés)', st.staff.map(s => s.nom).sort().join() === 'Direction,Porte A,Porte B', st.staff.map(s => s.nom + ':' + s.role).join(', '));
  const grep = f => { const b = fs.readFileSync(f); return b.includes(AK) || b.includes(CA) || b.includes(CB); };
  const allFiles = fs.readdirSync(tmp, { recursive: true }).map(f => path.join(tmp, f)).filter(f => fs.statSync(f).isFile());
  ok('5. aucune clé en clair dans AUCUN fichier de base (empreintes seulement)', !allFiles.some(grep), allFiles.length + ' fichiers examinés');
  ok('5. la clé de contrôle ne donne pas l\'administration', (await J('GET', '/api/admin/staff', null, CA)).s === 401 && (await J('GET', '/api/admin/events', null, CA)).s === 401);
  const mk = await J('POST', '/api/admin/staff', { nom: 'Agent Kati', role: 'control', poste: 'Porte nord' }, AK);
  ok('5. création d\'un compte : clé forte renvoyée une seule fois', mk.s === 201 && /^MJS-CTL-([A-Z0-9]{5}-){3}[A-Z0-9]{5}$/.test(mk.j.key), mk.j.key && mk.j.key.slice(0, 12) + '…');
  ok('5. la nouvelle clé fonctionne à l\'entrée', (await J('POST', '/api/admin/validate', { code: 'ML-AAAA-AAAA-AAAA' }, mk.j.key)).j.result === 'invalid');
  ok('5. la clé n\'est plus lisible ensuite', !JSON.stringify((await J('GET', '/api/admin/staff', null, AK)).j).includes(mk.j.key));
  ok('5. révocation immédiate', (await J('POST', `/api/admin/staff/${mk.j.id}/revoke`, {}, AK)).s === 200 && (await J('POST', '/api/admin/validate', { code: 'ML-AAAA-AAAA-AAAA' }, mk.j.key)).s === 401);
  const me = st.staff.find(s => s.nom === 'Direction').id;
  ok('5. impossible de se révoquer soi-même / de supprimer le dernier administrateur', (await J('POST', `/api/admin/staff/${me}/revoke`, {}, AK)).s === 409);
  let upd = 0; try { store.db.prepare('UPDATE staff_log SET nom=?').run('x'); } catch (e) { upd++; } try { store.db.prepare('DELETE FROM staff_log').run(); } catch (e) { upd++; }
  ok('5. journal des connexions du personnel en lecture seule (base)', upd === 2);
  await J('POST', '/api/staff/login', { key: 'mauvaise' }); await J('POST', '/api/staff/login', { key: CA });
  const lg = (await J('GET', '/api/admin/staff', null, AK)).j.log.map(l => l.action);
  ok('5. connexions réussies et refusées tracées', lg.includes('connexion') && lg.includes('connexion.refusee') && lg.includes('compte.revoque'));
  store.syncStaffFromEnv(process.env.ADMIN_KEY, 'Porte A=' + CA);        // « redémarrage » avec la Porte B retirée de la configuration
  ok('5. clé retirée de la configuration = compte révoqué au démarrage', (await J('POST', '/api/admin/validate', { code: 'ML-AAAA-AAAA-AAAA' }, CB)).s === 401 && (await J('POST', '/api/admin/validate', { code: 'ML-AAAA-AAAA-AAAA' }, CA)).s === 200);
  store.syncStaffFromEnv(process.env.ADMIN_KEY, process.env.CONTROL_KEY);

  // 6. Journal d'activité (documents)
  await J('POST', '/api/track', { action: 'page.view', target: 'accueil' });
  const act = (await J('GET', '/api/admin/activity?limit=50', null, AK)).j;
  ok('6. journal d\'activité servi depuis la base de documents', act.rows.some(a => a.action === 'page.view') && act.rows.some(a => a.action === 'ticket.scan' && a.actor === 'Porte A'));
  ok('6. fichier journal en ajout seul', fs.existsSync(path.join(tmp, 'journal', 'activite.ndjson')));
  let w = 0; try { store.journal.put('x', {}); } catch (e) { w++; }
  ok('6. journal non modifiable', w === 1);

  // 7. Sauvegarde de toutes les bases
  const bk = store.backupTo(path.join(tmp, 'sauv', 'eticket-test.sqlite'));
  ok('7. sauvegarde : 3 bases SQLite + 2 dossiers de documents', bk.length === 5 && bk.every(f => fs.existsSync(f)));
  const rs = node(`const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.env.F);console.log(d.prepare('SELECT COUNT(*) c FROM events').get().c)`, { F: bk[1] });
  ok('7. la sauvegarde de la base admin est lisible', +rs.stdout >= 1, rs.stdout.trim());
  server.close(); setTimeout(() => {}, 0);

  // 8. Migration depuis l'ancienne base unique
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-')), old = path.join(dir2, 'ancienne.sqlite');
  const legacy = fs.readFileSync(process.env.LEGACY_DB_JS || path.join(__dirname, 'legacy', 'db-ancienne.js'), 'utf8');
  fs.writeFileSync(path.join(dir2, 'db-old.js'), legacy.split("require('./sports')").join(`require(${JSON.stringify(path.join(__dirname, '..', 'sports'))})`));
  let r = node(`const s=require(process.env.OLD);const {order}=s.createOrder({eventId:1,tribuneId:1,qty:2,operator:'orange',phone:'70112233'});s.settle(order.ref,'SUCCESS','T');const t=s.ticketsOf(order.id);s.validateTicket(t[0].code,1,true);s.logActivity({action:'page.view',target:'x'});s.audit('test','demo','x','y');console.log(JSON.stringify({ref:order.ref,code:t[0].code,other:t[1].code}))`, { OLD: path.join(dir2, 'db-old.js'), DB_PATH: old });
  const info = JSON.parse((r.stdout || '{}').trim().split('\n').pop());
  ok('8. ancienne base unique préparée (1 commande payée, 1 billet utilisé)', !!info.ref, (r.stderr || '').split('\n').filter(l => /Error|error/.test(l)).join(' ').slice(0, 300));
  r = node(`const s=require('./db');const g=q=>s.db.prepare(q).get();console.log(JSON.stringify({ev:g('SELECT COUNT(*) c FROM admin.events').c,ord:g('SELECT status FROM orders').status,tk:g('SELECT COUNT(*) c FROM tickets').c,used:s.ctl.entrees.has(process.env.CODE),other:s.ctl.entrees.has(process.env.OTHER),act:s.journal.count(),adm:g('SELECT COUNT(*) c FROM admin.admin_log').c,mainEv:!!g("SELECT 1 x FROM main.sqlite_master WHERE name='events'"),ticks:s.ticketsOf(1).map(t=>t.status)}))`, { DB_PATH: old, CODE: info.code, OTHER: info.other, NODE_ENV: 'development' });
  const m = JSON.parse((r.stdout || '{}').trim().split('\n').pop());
  ok('8. migration : événements → admin, commande/billets → utilisateurs, billet utilisé → contrôle, activité → journal', m.ev >= 1 && m.ord === 'PAID' && m.tk === 2 && m.used === true && m.other === false && m.act >= 1 && m.adm >= 1 && m.mainEv === false, r.stdout.trim() + r.stderr.slice(0, 200));
  ok('8. statuts des billets conservés après migration', JSON.stringify(m.ticks) === '["USED","VALID"]');
  r = node(`const s=require('./db');console.log(s.db.prepare('SELECT COUNT(*) c FROM orders').get().c)`, { DB_PATH: old });
  ok('8. réouverture sans nouvelle migration', r.stdout.trim() === '1');

  // 9. Lancement « demarrer.bat » (node server.js sans variables) : les clés de cles-acces.json sont celles qui fonctionnent
  const kf = path.join(tmp, 'cles.json'); fs.writeFileSync(kf, JSON.stringify({ admin: ['MJS-ADM-TEST1-TEST2-TEST3-TEST4'], controle: { 'Porte test': 'MJS-CTL-TEST1-TEST2-TEST3-TEST4' } }));
  const env9 = { ...process.env, PORT: '3557', DB_PATH: path.join(tmp, 'k', 'utilisateurs.sqlite'), KEYS_FILE: kf }; delete env9.ADMIN_KEY; delete env9.CONTROL_KEY;
  const ch = require('child_process').spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: path.join(__dirname, '..'), env: env9, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 2500));
  const login9 = async k => (await fetch('http://127.0.0.1:3557/api/staff/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k }) })).json().catch(() => ({}));
  const [l1, l2, l3, l4] = [await login9('MJS-ADM-TEST1-TEST2-TEST3-TEST4'), await login9(' MJS-CTL-TEST1-TEST2-TEST3-TEST4\n'), await login9('admin-eticket-2026'), await login9('MJS-ADM-FAUSSE')];
  ch.kill();
  ok('9. node server.js (demarrer.bat) : les clés de cles-acces.json sont acceptées', l1.role === 'admin' && l2.role === 'control' && l2.nom === 'Porte test', JSON.stringify([l1, l2]));
  ok('9. clé collée avec espaces / retour à la ligne acceptée ; clés par défaut et fausses refusées', l3.error && l4.error);

  fs.writeFileSync(path.join(__dirname, 'rapport-bases.txt'), 'Organisation des bases de données — ' + new Date().toISOString() + '\n' + out.join('\n') + '\n');
  console.log(ko ? ko + ' ÉCHEC(S)' : out.length + ' contrôles réussis'); process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e); process.exit(1); });
