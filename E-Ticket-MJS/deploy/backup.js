'use strict';
// Sauvegarde cohérente de TOUTES les bases (même pendant que le site tourne) :
//   utilisateurs / admin / personnel (SQLite) + contrôle / journal (documents).
//   node deploy/backup.js   ->  <dossier des bases>/backups/eticket-AAAAMMJJ-HHMM.{sqlite, admin.sqlite, personnel.sqlite, controle/, journal/}
// BACKUP_KEEP : nombre de sauvegardes (jeux complets) conservées (défaut 14).
// Restauration : arrêter le site, recopier les 5 éléments d'un même jeu à la place des bases actuelles en retirant le préfixe « eticket-AAAAMMJJ-HHMM. »
//   (utilisateurs.sqlite, admin.sqlite, personnel.sqlite, controle/, journal/), puis relancer.
const fs = require('fs');
const path = require('path');
const store = require('../db');

const dir = process.env.BACKUP_DIR || path.join(path.dirname(store.FILES.utilisateurs), 'backups');
fs.mkdirSync(dir, { recursive: true });
const d = new Date(), p = n => String(n).padStart(2, '0');
const stamp = `eticket-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
const files = store.backupTo(path.join(dir, stamp + '.sqlite'));
for (const f of files) { try { fs.chmodSync(f, 0o700); } catch (_) {} }
const keep = +process.env.BACKUP_KEEP || 14;
const stamps = [...new Set(fs.readdirSync(dir).map(f => (f.match(/^(eticket-\d{8}-\d{4})\./) || [])[1]).filter(Boolean))].sort();
for (const st of stamps.slice(0, Math.max(0, stamps.length - keep))) for (const f of fs.readdirSync(dir)) if (f.startsWith(st + '.')) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
console.log(`Sauvegarde : ${stamp} — ${files.length} éléments dans ${dir} — ${Math.min(stamps.length, keep)} jeu(x) conservé(s)`);
