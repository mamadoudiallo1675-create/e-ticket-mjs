# E-Ticket MJS – Organisation des bases de données

Les données sont classées en **quatre domaines** ; chacun a sa propre base, du **type adapté à son usage**.
(Tout est embarqué : aucun serveur de base à installer, `npm install` reste inutile.)

| Domaine | Type de base | Moteur | Fichier(s) | Contenu |
|---|---|---|---|---|
| **Utilisateurs** (acheteurs) | **Relationnelle** | SQLite | `utilisateurs.sqlite` | commandes, paiements, billets achetés, codes SMS (OTP), sessions de récupération, messages au support |
| **Admin** | **Relationnelle** | SQLite | `admin.sqlite` | événements, tribunes, prix, stocks, journal des modifications (lecture seule) |
| Admin – journal d'activité | **Non relationnelle** (documents, ajout seul) | magasin de documents embarqué | `journal/activite.ndjson` | toutes les actions des utilisateurs (visiteurs, contrôle, administration) |
| **Personnel** | **Relationnelle** | SQLite | `personnel.sqlite` | comptes, rôles, postes, clés (empreintes seulement), révocation, journal des connexions (lecture seule) |
| **Contrôle** | **Non relationnelle** (documents / clé-valeur, ajout seul, fsync) | magasin de documents embarqué | `controle/entrees.ndjson`, `controle/scans.ndjson` | entrées validées (1 billet = 1 clé) et journal de chaque passage devant une borne |

## Pourquoi ce choix, domaine par domaine
- **Utilisateurs → relationnelle.** On y manipule de l'argent, des places et des billets : il faut des transactions ACID, des contraintes d'unicité (une référence de commande, un code de billet), des jointures (commande ↔ billets ↔ téléphone) et des totaux fiables. C'est le cas d'école du relationnel.
- **Admin → relationnelle.** Le catalogue est fortement structuré (événement → tribunes → tarifs/stocks) avec intégrité référentielle ; le journal des modifications est protégé par des déclencheurs SQL (impossible à modifier ou effacer).
- **Personnel → relationnelle.** Peu de lignes, mais des règles strictes : une clé = un compte (unicité), un rôle parmi une liste fermée, révocation datée, « au moins un administrateur actif », journal infalsifiable. Les clés ne sont jamais stockées, seulement leurs empreintes salées.
- **Contrôle → non relationnelle.** Aux portes d'un stade, des milliers de personnes passent en quelques minutes : écritures en rafale, lecture par **clé unique** (le code du billet), documents de forme libre (borne, résultat, appareil, heure) qui évolueront, journal qui ne se modifie jamais, et possibilité de copier le magasin sur un poste hors-ligne. Pas besoin de jointures : un modèle clé-valeur / documents est plus simple et plus rapide.
- **Journal d'activité → non relationnelle.** Gros volume d'événements de formes variées, écrits au fil de l'eau et seulement lus (les plus récents, filtrés) : un journal de documents à ajout seul convient mieux qu'une table.

## Garanties techniques
- **Transaction entre bases** : les 3 bases SQLite sont ouvertes dans une seule connexion (`ATTACH`) en mode journal `DELETE` ; une commande (stock en base admin + commande en base utilisateurs) est validée ou annulée **en bloc**, même en cas de coupure (testé : `npm run test:bases`).
- **Une entrée = une seule fois** : `putIfAbsent` sur la clé du billet est atomique ; deux bornes ne peuvent pas faire entrer deux fois le même billet (testé aussi sous charge : 200 billets × 5 scans simultanés = 200 acceptés, 800 refusés).
- **Écriture durable** : chaque document de contrôle est écrit puis `fsync`é avant d'être confirmé ; une ligne tronquée par une coupure de courant est ignorée au redémarrage, les données précédentes restent intactes.
- **Lecture seule** : journaux (administration, connexions du personnel, scans, activité) non modifiables ni supprimables par l'application.
- **Séparation** : une base ne contient que les tables de son domaine. Les références entre domaines (commande → événement/tribune) sont des identifiants ; l'intégrité est assurée par le code, dans la même transaction.

## Fichiers et emplacement
`DB_PATH` désigne la base **utilisateurs** ; les autres sont créées à côté (`admin.sqlite`, `personnel.sqlite`, `controle/`, `journal/`). Avec un `DB_PATH` de nom différent (ex. `ma.sqlite`) : `ma.admin.sqlite`, `ma.personnel.sqlite`, `ma.controle/`, `ma.journal/`. Par défaut : `data/utilisateurs.sqlite`. Versions antérieures (une seule base `data.sqlite`) : **migration automatique** au premier démarrage, en une transaction (tout ou rien).

## Personnel : comptes et clés
- `ADMIN_KEY` / `CONTROL_KEY` (séparées par des virgules) sont transformées en comptes au démarrage. Syntaxe `Nom=clé` pour nommer le compte (ex. `CONTROL_KEY="Porte nord=MJS-CTL-…,Porte sud=MJS-CTL-…"`) : le nom apparaît dans les journaux (qui a scanné quel billet, qui a modifié quel tarif).
- Une clé retirée de la configuration est révoquée au prochain démarrage.
- Administration → **Personnel** : créer un compte (la clé n'est affichée qu'une fois), révoquer (effet immédiat), consulter le journal des connexions (réussies et refusées).
- Administration → **Bases de données** : inventaire des 5 bases (type, moteur, taille, nombre de lignes/documents, justification).

## Sauvegarde et restauration
`node deploy/backup.js` sauvegarde **les 5 bases ensemble** (`eticket-AAAAMMJJ-HHMM.sqlite`, `.admin.sqlite`, `.personnel.sqlite`, `.controle/`, `.journal/`) et garde les 14 derniers jeux. Restauration : site arrêté, remettre les 5 éléments d'un même jeu sous leurs noms d'origine, relancer.

## Limites à connaître (honnêtement)
- Le magasin de documents est **embarqué et mono-processus** (un seul serveur E-Ticket). Pour plusieurs serveurs en parallèle ou des millions de scans, remplacer ces deux collections par un vrai système non relationnel (MongoDB, Redis…) et SQLite par PostgreSQL : toute la logique passe par `db.js` (relationnel) et `docstore.js` (documents, interface `get/put/putIfAbsent/append/recent/count`), les remplacer ne touche pas le reste du site.
- Le mode journal `DELETE` (nécessaire pour l'atomicité entre fichiers SQLite) est un peu plus lent en écriture que `WAL` ; mesure sur 2 cœurs : 1 800 acheteurs simultanés pour 600 places, aucune survente, p95 des commandes ≈ 0,8 s (`node deploy/loadtest.js`).
- Les statistiques « 24 h » du journal d'activité portent sur les 50 000 derniers événements gardés en mémoire.
- Le mode « démonstration hors serveur » (navigateur seul) ne contient pas ces bases : il les simule.
- Hébergement réel : base de données personnelles (téléphones d'acheteurs) → sauvegardes chiffrées et conformité à la réglementation malienne sur les données personnelles à faire valider par le ministère.
