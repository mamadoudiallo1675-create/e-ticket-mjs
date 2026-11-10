'use strict';
// Diagnostic « pourquoi le serveur est introuvable ? »   node deploy/doctor.js   (ou : npm run doctor)
// Vérifie Node.js, le module SQLite, les fichiers du site, l'écriture de la base, les ports, puis démarre le serveur
// quelques secondes pour contrôler qu'il répond réellement sur /healthz. Chaque ligne « À CORRIGER » dit quoi faire.
const fs = require('fs'), path = require('path'), net = require('net'), os = require('os'), { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..'); const rows = []; const add = (ok, n, d) => rows.push([ok, n, d || '']);
const [maj, min] = process.versions.node.split('.').map(Number);
add(maj > 22 || (maj === 22 && min >= 13), `Node.js ${process.versions.node} (22.13 ou plus requis)`, 'Installez la version LTS : https://nodejs.org');
let sqlite = true; try { require('node:sqlite'); } catch (e) { sqlite = false; } add(sqlite, 'Module SQLite intégré (node:sqlite)', 'Node.js trop ancien : mettez-le à jour');
for (const f of ['server.js', 'db.js', 'public/index.html', 'public/admin.html', 'public/controle.html', 'public/css/site.css', 'public/js/common.js', 'public/js/cart.js', 'public/js/cinetpay-checkout.js', 'public/vendor/qr.js'])
  add(fs.existsSync(path.join(ROOT, f)), `Fichier ${f}`, 'Manquant : recopiez le dossier complet depuis le zip');
try { const t = path.join(ROOT, '.doctor-' + process.pid); fs.writeFileSync(t, 'x'); fs.unlinkSync(t); add(true, 'Écriture dans le dossier du site (base de données)'); }
catch (e) { add(false, 'Écriture dans le dossier du site', 'Dossier en lecture seule ? Copiez le site hors de « Téléchargements »/zip, ou définissez DB_PATH=un/dossier/ecrivable/data.sqlite'); }
const free = p => new Promise(r => { const s = net.createServer().once('error', () => r(false)).once('listening', () => s.close(() => r(true))).listen(p, '127.0.0.1'); });
(async () => {
  const ports = []; for (let p = 3000; p <= 3010; p++) ports.push([p, await free(p)]);
  const libre = ports.find(x => x[1]);
  add(!!libre, libre ? `Port libre trouvé : ${libre[0]}${libre[0] !== 3000 ? ' (3000 est occupé ; le serveur prendra ce port automatiquement)' : ''}` : 'Aucun port libre entre 3000 et 3010', 'Fermez les autres serveurs (ou une autre fenêtre E-Ticket)');
  if (rows.slice(0, 2).every(r => r[0]) && libre) {
    const port = libre[0], db = path.join(os.tmpdir(), 'doctor-' + Date.now() + '.sqlite');
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: String(port), DB_PATH: db, NODE_ENV: 'development' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = ''; child.stderr.on('data', d => err += d); child.on('exit', () => {});
    let ok = false, info = '';
    for (let i = 0; i < 40 && !ok; i++) { await new Promise(r => setTimeout(r, 250)); try { const r = await fetch(`http://127.0.0.1:${port}/healthz`); const j = await r.json(); ok = !!(j && j.ok && j.app === 'E-Ticket Mali'); } catch (_) {} }
    if (!ok) info = (err.trim().split('\n').slice(-3).join(' | ') || 'le serveur n\'a pas répondu en 10 s');
    add(ok, `Démarrage d'essai du serveur et réponse sur http://127.0.0.1:${port}/healthz`, info);
    if (ok) { try { const h = await (await fetch(`http://127.0.0.1:${port}/`)).text(); add(/E-Ticket/.test(h), 'La page d\'accueil est servie'); const c = await (await fetch(`http://127.0.0.1:${port}/css/site.css`)).text(); add(/--vert/.test(c), 'Le design (site.css) est servi'); } catch (e) { add(false, 'Pages servies', e.message); } }
    child.kill('SIGTERM'); setTimeout(() => { try { fs.rmSync(db, { force: true }); fs.rmSync(db + '-wal', { force: true }); fs.rmSync(db + '-shm', { force: true }); } catch (_) {} }, 400);
  }
  let bad = 0; for (const [ok, n, d] of rows) { console.log((ok ? 'OK        ' : 'À CORRIGER ') + n + (!ok && d ? '\n            → ' + d : '')); if (!ok) bad++; }
  console.log(bad ? `\n${bad} point(s) à corriger. Corrigez-les, relancez « npm run doctor », puis « npm start ».` : '\nTout est en ordre. Lancez le serveur avec « npm start » (ou demarrer.bat / demarrer.sh) puis ouvrez http://localhost:3000.');
  process.exit(bad ? 1 : 0);
})();
