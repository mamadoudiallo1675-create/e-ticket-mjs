'use strict';
// Importe des événements depuis un fichier JSON (par défaut data/evenements.json).
//   node deploy/import-events.js [fichier.json]
// Idempotent : un événement déjà présent (même titre + même date) est ignoré.
const fs = require('fs');
const path = require('path');
const store = require('../db');

const file = process.argv[2] || path.join(__dirname, '..', 'data', 'evenements.json');
const list = JSON.parse(fs.readFileSync(file, 'utf8')).evenements;
if (!Array.isArray(list)) { console.error('Format invalide : clé "evenements" attendue.'); process.exit(1); }

let added = 0, skipped = 0;
for (const e of list) {
  for (const k of ['type', 'titre', 'date', 'lieu']) if (!e[k]) { console.error(`Champ « ${k} » manquant :`, JSON.stringify(e)); process.exit(1); }
  if (isNaN(new Date(e.date))) { console.error('Date invalide :', e.date); process.exit(1); }
  const tribunes = (e.tribunes || []).map(t => {
    if (!t.nom || !Number.isInteger(t.prix) || t.prix < 100 || !Number.isInteger(t.stock) || t.stock < 0) { console.error('Tribune invalide :', JSON.stringify(t)); process.exit(1); }
    return t;
  });
  if (store.findEvent(e.titre, e.date)) { skipped++; continue; }
  store.createEvent({ type: e.type, titre: e.titre, adv: e.adv, date: e.date, lieu: e.lieu, tribunes, heureConfirmee: e.heureConfirmee !== false });
  added++;
  if (!tribunes.length) console.log(` ! « ${e.titre} » : aucune tribune → affiché « Billetterie bientôt ouverte » (ajoutez-les via l'API admin).`);
}
console.log(`Import terminé : ${added} ajouté(s), ${skipped} déjà présent(s).`);
