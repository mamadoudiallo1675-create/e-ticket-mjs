# Mise en production avec Netlify + MongoDB Atlas + CinetPay + SMS

Ce guide complète `PUBLICATION.md`. Il décrit ce que le code fait déjà et ce que **seul le ministère** (ou un tiers) peut fournir.

## 1. Architecture

| Élément | Rôle | Où |
|---|---|---|
| Pages du site (`public/`) | Affiches, réservation, billets | Netlify (statique) |
| `initier_paiement` | Vérifie le stock, **réserve** les places (« en cours »), crée la commande `attente_paiement` avec un `transac_id` unique, crée la transaction dans MongoDB, ouvre le guichet CinetPay | `/api/cinetpay/initier` |
| `webhook_cinetpay` | Reçoit la notification CinetPay, **revérifie statut + montant** auprès de CinetPay, passe « en cours » → « vendu » (SQL), « payé » (MongoDB), génère un jeton par place, un lien court et envoie le SMS | `/api/cinetpay/notification` |
| `billet` | Page du billet (QR codes) et page de retour de paiement | `/b/<code>`, `/commande/<réf>` |
| `valider_billet` | Contrôle à l'entrée : un billet n'est accepté qu'une fois (réservé au personnel, clé `CONTROL_KEY`) | `/api/cinetpay/valider` |
| `liberer_reservations` | Toutes les 10 minutes, libère les réservations jamais payées | tâche planifiée |
| Base SQL | Places (`tribunes`) et commandes (`commandes`), contrainte « jamais de sur-vente » | Netlify Database (PostgreSQL), migration `netlify/database/migrations/` |
| MongoDB Atlas | Transactions, billets (jetons), liens courts, état des SMS | Atlas |

Les connexions (pool SQL, client MongoDB) sont **mises en cache** au niveau du module / `globalThis` pour être réutilisées entre les invocations serverless.

## 2. Ce que vous devez faire (je ne peux pas le faire à votre place)

1. **Compte CinetPay** : inscription et validation (KYC, pièces de l'entité) sur https://cinetpay.com — elles se font avec les informations du ministère et ne peuvent pas être créées automatiquement depuis un compte Google. Récupérez ensuite, dans le back-office, la **clé API** et l'**identifiant du site**. Activez les canaux voulus (Orange Money, Moov, Wave, Sama Money). Ne partagez jamais la clé dans un message ou un fichier du dépôt.
2. **MongoDB Atlas** : créez le cluster (offre gratuite possible pour les essais), un utilisateur de base dédié, puis récupérez l'adresse `mongodb+srv://…`.
3. **Netlify** : créez le site depuis le dépôt, puis saisissez les variables du § 4 (portée *Functions*).
4. **Nom de domaine** : achat auprès d'un bureau d'enregistrement (domaine `.ml` : voir l'autorité malienne), puis ajout dans Netlify > Domain management et création des enregistrements DNS demandés. Le certificat HTTPS est automatique.
5. **Passerelle SMS** : choisir le fournisseur (Orange Developer SMS, Twilio ou un agrégateur local), obtenir ses identifiants et un **numéro/nom d'expéditeur autorisé pour le Mali**.
6. **Catalogue** : `node netlify/scripts/export-catalogue.mjs > netlify/catalogue.sql`, puis exécuter ce fichier sur la base Netlify (les prix et stocks viennent de l'Admin, rien n'est inventé).
7. **Dans le back-office CinetPay** : enregistrer l'adresse de notification `https://VOTRE-DOMAINE/api/cinetpay/notification` (elle est aussi envoyée à chaque paiement).
8. Dans `public/index.html`, mettre `<meta name="et-pay-backend" content="netlify">`.

## 3. Points d'attention (à lire avant de choisir l'hébergement)

- **IP fixe** : les fonctions Netlify n'ont **pas d'adresse IP sortante fixe**. Or Moov Money exige l'enregistrement de l'IP fixe du serveur, et Atlas filtre par adresse IP. Conséquences : (a) Moov direct doit rester sur le **serveur Node** hébergé sur un serveur à IP fixe (VPS) — il n'est pas porté sur Netlify ; (b) pour Atlas, il faut autoriser `0.0.0.0/0` avec un mot de passe long et unique (ou une option réseau privée payante d'Atlas).
- **Deux chaînes de vente** : le serveur Node (Orange/Moov directs, SQLite) et les fonctions Netlify (CinetPay, PostgreSQL + MongoDB) ont chacune leur base de places. Choisissez **un seul** point de vente en production, sinon le stock serait compté deux fois : soit tout sur le serveur Node, soit CinetPay seul sur Netlify.
- Les billets émis par les fonctions Netlify sont dans MongoDB : l'écran de contrôle doit appeler `/api/cinetpay/valider` (non encore branché sur `controle.html`).
- Le format exact du SMS Orange (adresse de l'expéditeur, quotas) est à confirmer avec Orange Developer.

## 4. Variables d'environnement (Netlify, portée Functions)

`CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `MONGODB_URI`, `MONGODB_DB`, `SITE_URL`, `CONTROL_KEY`, `RESERVATION_TTL_MIN` (facultatif), `SMS_PROVIDER` + identifiants (voir `.env.example`). Le total des variables ne doit pas dépasser ~4 Ko.

## 5. Vérifications avant l'ouverture

- `npm run test:netlify` (37 contrôles, bases et guichet simulés).
- Paiement d'essai en mode bac à sable CinetPay, avec un petit montant (multiple de 5 FCFA).
- Contrôler dans Atlas : transaction « payé », billets, lien court ; et que le SMS arrive.
- Couper volontairement le webhook : CinetPay doit renvoyer la notification (la fonction répond 5xx en cas d'erreur).

## 6. État de ce qui a été vérifié

Vérifié : toute la logique (stock sans sur-vente, anti-fraude, doublons, SMS en échec, paiement tardif, validation unique) avec **SQLite et MongoDB simulés** et un faux guichet CinetPay. **Non vérifié** (réseau et comptes absents) : connexion réelle à Atlas et à Netlify Database, appel réel à CinetPay et à la passerelle SMS, installation des paquets `mongodb` et `@netlify/database` (`npm install` à lancer au premier déploiement).
