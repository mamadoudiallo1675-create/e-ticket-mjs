# E-Ticket Mali — copie fonctionnelle

Construite à partir de vos fichiers (site.css, common.js, cart.js, cinetpay-checkout.js, qr.js, index/admin/controle/conditions/confidentialite.html) reliés entre eux : chaque page charge le même design et les mêmes scripts.

Windows : double-clic sur `demarrer.bat` · Mac/Linux : `./demarrer.sh`
```bash
npm start            # http://localhost:3000  (Node.js ≥ 22.13) — paiements simulés
```
**Clés par défaut (développement)** — administrateur : `admin-eticket-2026` · contrôle : `controle-eticket-2026`.
Menu → « Connexion personnel » : une seule connexion pour Admin et Contrôle, dans tous les onglets. En production, ces clés sont refusées : définir les vôtres dans `.env` (voir `.env.example`).
Vous pouvez aussi ouvrir `public/index.html` directement : le design s'affiche et les données viennent du serveur local lancé ci-dessus.

Le voyant « ● Serveur connecté » du menu indique que la page est bien liée au serveur ; sinon cliquez dessus.

Tests : `npm run test:reseau` (21, liaison au serveur) · `npm test` (23, API) · `npm run test:pages` (45, navigateur) · `npm run test:fichiers` (pages ouvertes directement). Playwright requis pour les deux derniers.
Captures : `tests/captures/` et `tests/captures-fichiers/`. Documentation : `DOCUMENTATION.md`.


## Serveur introuvable ?
Lancez `npm run doctor` : il indique quoi corriger (Node 22.13+, port, fichiers). Puis `npm start` ou demarrer.bat / demarrer.sh et ouvrez http://localhost:3000. Voir DOCUMENTATION.md §17. Mode démonstration hors serveur disponible (simulé).

## Sports, téléphone, temps réel
Filtre par sport sur l'accueil (liste du ministère), options du personnel réservées aux ordinateurs Windows/Mac (téléphones et tablettes Android/iOS : options utilisateurs seulement), agents de contrôle limités aux options de contrôle (`npm run test:appareils`), toutes les actions enregistrées en base (admin → « Activité en direct »), synchronisation en temps réel public ↔ personnel/admin. Voir DOCUMENTATION.md §18 ; test : `npm run test:sports`.
Images locales par sport, carrousels automatiques dans les affiches et la section « Les sports du Mali », fond jeunesse/sport malien : voir DOCUMENTATION.md §22 ; test : `npm run test:images` ; photos réelles : les déposer dans `public/img/sports/<sport>/`.
Mise en ligne : voir PUBLICATION.md (checklist, ce qui est prêt, ce que le ministère doit fournir) ; test : `npm run test:publication`.
Accessibilité : voir ACCESSIBILITE.md (contrôles réalisés avec WebAbility, limites, guide de test et d’audit à lancer avant l’ouverture).
