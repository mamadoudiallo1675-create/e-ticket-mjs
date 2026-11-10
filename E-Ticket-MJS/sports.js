'use strict';
// Liste des sports pratiqués au Mali, d'après le document « liste des sports au Mali » fourni par le ministère.
// `id` est l'identifiant stocké avec chaque événement ; `nom` est le libellé affiché.
const SPORTS = [
  { id: 'football', nom: 'Football', famille: 'moderne', detail: 'Sport roi au Mali, pratiqué par les hommes et les femmes (compétitions nationales et internationales).' },
  { id: 'basketball', nom: 'Basketball', famille: 'moderne', detail: 'Ligues nationales et tournois internationaux.' },
  { id: 'athletisme', nom: 'Athlétisme', famille: 'moderne', detail: 'Sprints, sauts et lancers.' },
  { id: 'arts-martiaux', nom: 'Arts martiaux', famille: 'moderne', detail: 'Karaté, taekwondo et autres arts martiaux.' },
  { id: 'cyclisme', nom: 'Cyclisme', famille: 'moderne', detail: 'Compétitions locales de vélo.' },
  { id: 'natation', nom: 'Natation', famille: 'moderne', detail: 'Surtout près du fleuve Niger et des plans d’eau.' },
  { id: 'courses-chevaux', nom: 'Courses de chevaux', famille: 'moderne', detail: 'Importance culturelle dans certaines régions.' },
  { id: 'lutte', nom: 'Lutte traditionnelle', famille: 'traditionnel', detail: 'Balla et Laamb : force, grappling et rituels culturels.' },
  { id: 'sokone', nom: 'Sokone', famille: 'traditionnel', detail: 'Jeu traditionnel proche du football, règles et nombre de joueurs différents.' },
  { id: 'jeux-traditionnels', nom: 'Jeux traditionnels', famille: 'traditionnel', detail: 'Dama, Moribayassa et diverses formes de lutte lors des festivals.' },
  { id: 'tir-arc', nom: 'Tir à l’arc', famille: 'autre', detail: 'Dimension souvent culturelle ou rituelle.' },
  { id: 'sports-nautiques', nom: 'Sports nautiques', famille: 'autre', detail: 'Natation et sports aquatiques des zones fluviales.' },
  { id: 'culture', nom: 'Culture & jeunesse', famille: 'autre', detail: 'Événements culturels et de jeunesse (concerts, animations).' }
];
const byId = Object.fromEntries(SPORTS.map(s => [s.id, s]));
const byName = Object.fromEntries(SPORTS.map(s => [s.nom.toLowerCase(), s]));
// Retrouve l'identifiant à partir d'un id ou d'un libellé (ex. « Football », « Basket »…) ; '' si inconnu.
function resolve(v) {
  const x = String(v || '').trim().toLowerCase();
  if (!x) return '';
  if (byId[x]) return x;
  if (byName[x]) return byName[x].id;
  const alias = { basket: 'basketball', foot: 'football', lutte: 'lutte', laamb: 'lutte', balla: 'lutte', karate: 'arts-martiaux', karaté: 'arts-martiaux', taekwondo: 'arts-martiaux', velo: 'cyclisme', vélo: 'cyclisme', chevaux: 'courses-chevaux', arc: 'tir-arc' };
  return alias[x] || '';
}
// Images locales d'un sport : tous les .svg/.png/.jpg/.webp du dossier public/img/sports/<id>/ (ordre alphabétique).
// Déposez-y de vraies photos : elles apparaissent automatiquement dans les carrousels.
const fs = require('fs'), path = require('path');
const IMG_DIR = path.join(__dirname, 'public', 'img', 'sports');
function images(id) {
  try { return fs.readdirSync(path.join(IMG_DIR, id)).filter(f => /\.(svg|png|jpe?g|webp|avif)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(f => `img/sports/${id}/${f}`); }
  catch (_) { return []; }
}
const withImages = () => SPORTS.map(x => ({ ...x, images: images(x.id) }));
module.exports = { SPORTS, resolve, images, withImages, nom: id => (byId[id] || {}).nom || '' };
