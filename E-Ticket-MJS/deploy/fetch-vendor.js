'use strict';
// Installe jsQR (lecture des QR codes par caméra pour les navigateurs sans lecteur intégré, notamment iPhone)
// dans public/vendor/jsQR.js, depuis le registre npm, avec vérification d'intégrité (sha512 publié par le registre).
//   node deploy/fetch-vendor.js
// Sans ce fichier, la page de contrôle fonctionne avec Chrome sur Android (lecteur intégré) et la saisie manuelle.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const VERSION = '1.4.0';
(async () => {
  const meta = await (await fetch(`https://registry.npmjs.org/jsqr/${VERSION}`, { signal: AbortSignal.timeout(30000) })).json();
  const tarUrl = meta.dist && meta.dist.tarball, integrity = meta.dist && meta.dist.integrity;
  if (!tarUrl || !/^sha512-/.test(integrity || '')) throw new Error('Métadonnées npm inattendues pour jsqr@' + VERSION);
  const buf = Buffer.from(await (await fetch(tarUrl, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
  const got = 'sha512-' + crypto.createHash('sha512').update(buf).digest('base64');
  if (got !== integrity) throw new Error('Intégrité invalide : fichier refusé');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jsqr-'));
  fs.writeFileSync(path.join(tmp, 'p.tgz'), buf);
  execFileSync('tar', ['-xzf', path.join(tmp, 'p.tgz'), '-C', tmp, 'package/dist/jsQR.js']);
  const dest = path.join(__dirname, '..', 'public', 'vendor');
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.join(tmp, 'package', 'dist', 'jsQR.js'), path.join(dest, 'jsQR.js'));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`jsQR ${VERSION} installé dans public/vendor/jsQR.js (intégrité vérifiée)`);
})().catch(e => { console.error('Échec :', e.message); process.exit(1); });
