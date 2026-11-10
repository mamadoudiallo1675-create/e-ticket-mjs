// Exporte le catalogue réel (événements et tribunes saisis dans l'Admin) vers un fichier SQL à exécuter sur la base Netlify.
// Aucune donnée n'est inventée : seuls les événements ayant au moins une tribune (billetterie ouverte) sont repris.
//   node netlify/scripts/export-catalogue.mjs [chemin/admin.sqlite] > netlify/catalogue.sql
import { DatabaseSync } from 'node:sqlite'; import path from 'node:path'; import fs from 'node:fs';
const f = process.argv[2] || path.join(process.cwd(), 'data', 'utilisateurs.admin.sqlite');
const cands = [f, path.join(process.cwd(), 'data', 'admin.sqlite')].filter(p => fs.existsSync(p));
if (!cands.length) { console.error('Base Admin introuvable. Indiquez son chemin en argument.'); process.exit(1); }
const db = new DatabaseSync(cands[0], { readOnly: true });
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const rows = db.prepare(`SELECT t.id, t.event_id, e.titre, t.nom, t.prix, t.stock FROM tribunes t JOIN events e ON e.id = t.event_id ORDER BY t.id`).all();
console.log('-- Catalogue exporté le ' + new Date().toISOString() + ' depuis ' + path.basename(cands[0]));
for (const r of rows) console.log(`INSERT INTO tribunes (id, event_id, event_titre, nom, prix, capacite) VALUES (${r.id}, ${r.event_id}, ${q(r.titre)}, ${q(r.nom)}, ${r.prix}, ${r.stock}) ON CONFLICT (id) DO UPDATE SET event_titre = EXCLUDED.event_titre, nom = EXCLUDED.nom, prix = EXCLUDED.prix, capacite = GREATEST(EXCLUDED.capacite, tribunes.en_cours + tribunes.vendu);`);
