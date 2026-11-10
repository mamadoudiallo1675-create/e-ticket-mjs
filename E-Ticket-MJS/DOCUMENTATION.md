# E-Ticket Mali — Documentation complète

Site de billetterie en ligne du **Ministère de la Jeunesse et des Sports du Mali** : consulter les affiches, réserver une tribune, payer par Mobile Money, recevoir un billet QR, entrer au stade en le faisant scanner.

> Version de cette documentation : novembre 2026. Les passages **« À fournir »** ne peuvent pas être réglés par le code : ils dépendent du ministère ou de tiers (opérateurs, hébergeur, juristes).

---

## 1. Vue d'ensemble

| Pour qui | Page | Ce qu'on y fait |
|---|---|---|
| Public | `/` (index.html) | Voir les affiches, réserver, payer, retrouver ses billets, historique, support |
| Public | `/conditions.html`, `/confidentialite.html` | Textes juridiques (projets tant que non validés) |
| Agents aux entrées | `/controle.html` | Scanner les QR des billets (caméra ou saisie), test du poste |
| Administration | `/admin.html` | Publier les matchs, fixer prix/places, remboursements, statistiques, support, journal |

Toutes les pages partagent **le même menu, le même design et les mêmes scripts** (voir §3).

**Technique en une phrase** : un serveur Node.js unique (sans aucune dépendance npm, base SQLite intégrée), qui sert le site et l'API, et qui parle aux guichets de paiement.

## 2. Démarrage rapide (local, paiements simulés)

```bash
cd eticket
npm start            # http://localhost:3000   (Node.js ≥ 22.13)
npm test             # 21 tests de bout en bout (aucun appel externe)
```
En local, le site affiche « Mode démonstration » : aucune somme n'est débitée, les paiements passent par une page simulée. Des événements de démonstration sont créés (jamais en production).

Clés de démonstration : définissez `ADMIN_KEY` et `CONTROL_KEY` avant `npm start` (ex. `ADMIN_KEY=demo-admin CONTROL_KEY=demo-borne npm start`) pour utiliser `/admin.html` et `/controle.html`.

## 3. Organisation des fichiers

```
eticket/
├─ server.js              API HTTP, webhooks, sécurité, fichiers statiques
├─ db.js                  Base SQLite + règles métier (réservation, paiement, billets, journal)
├─ providers/             Guichets de paiement : cinetpay.js, orange.js, moov.js, mock.js, index.js
├─ sms/                   Envoi des SMS (code de récupération des billets)
├─ public/                Tout ce que le navigateur télécharge
│  ├─ index.html          Site public
│  ├─ admin.html          Administration
│  ├─ controle.html       Contrôle aux entrées
│  ├─ conditions.html     Conditions de vente  (générée par deploy/build-legal.py)
│  ├─ confidentialite.html
│  ├─ css/site.css        Design commun : couleurs, menu, boutons, cartes, formulaires
│  ├─ js/common.js        Menu de navigation commun, outils (esc, fmt, api, config)
│  ├─ js/cart.js          Panier → serveur (devis du montant, création de la commande)
│  ├─ js/cinetpay-checkout.js   Pop-up de paiement CinetPay
│  └─ vendor/qr.js        Générateur de QR code hébergé ici (aucun service externe)
├─ data/evenements.json   Événements réels (sans tarifs tant que non communiqués)
├─ deploy/                Outils d'exploitation (voir §10)
├─ docs/etat/             Page d'état du projet (fait / reste à faire) avec captures
├─ Dockerfile, docker-compose.yml, .env.example
├─ README.md, DEPLOY.md, DOCUMENTATION.md
└─ test.js                Tests automatiques
```

**Design et interactivité centralisés** : une page ne contient plus que son contenu propre. Pour changer les couleurs, modifier les variables en tête de `public/css/site.css`. Pour ajouter une page au menu, ajouter une ligne dans `PAGES` de `public/js/common.js` : le menu (avec bouton « Menu » sur mobile), le bandeau démo et le pied de page apparaissent partout.

## 4. Parcours d'achat

1. **Choix** : l'acheteur choisit un événement, une tribune, 1 à 6 places, un moyen de paiement et saisit son numéro.
2. **Panier → serveur** (`public/js/cart.js`) : le navigateur n'envoie **jamais de prix**, seulement `{eventId, tribuneId, qty}`.
   - `POST /api/cart/quote` : le serveur calcule `amount = prix × qty` et répond `{amount, currency:"XOF", available, payable}`.
   - La page affiche ce montant ; si le prix a changé entre-temps, l'achat est bloqué et l'acheteur est prévenu.
3. **Commande** : `POST /api/orders` réserve les places pendant 15 minutes (`ORDER_TTL_MIN`), recalcule le montant côté serveur, demande la transaction au guichet et renvoie `payUrl`.
4. **Pop-up** (`public/js/cinetpay-checkout.js`) : la page ouvre `payUrl` dans une fenêtre centrée, ouverte *avant* l'appel réseau pour ne pas être bloquée. Si le navigateur la bloque, bascule automatique sur une redirection plein écran.
5. **Retour** : au retour sur `/?order=CMD-…`, la pop-up se ferme et prévient la page d'origine ; celle-ci interroge le serveur jusqu'au résultat.
6. **Confirmation** : le guichet notifie le serveur (webhook). **La notification n'est jamais crue** : le serveur interroge le guichet (« check ») et vérifie que le montant encaissé est égal au montant de la commande. Si oui → commande `PAID`, billets créés (QR). Sinon → places remises en vente.

Statuts d'une commande : `PENDING` (en attente), `PAID`, `FAILED`, `EXPIRED`, `REFUND_DUE` (paiement reçu trop tard, à rembourser), `REFUNDED`.

## 5. Paiement

### 5.1 CinetPay (recommandé) — Orange Money, Moov, Wave, Sama Money
CinetPay est un guichet qui regroupe plusieurs moyens de paiement ; **les canaux disponibles dépendent de ce qu'active votre compte CinetPay** pour le Mali.

- **Adaptateur serveur** : `providers/cinetpay.js`.
  - `POST {base}/payment` avec `apikey`, `site_id`, `transaction_id` (= référence de commande), `amount` (entier, multiple de 5), `currency` (`XOF`), `notify_url`, `return_url`, `channels`.
  - `POST {base}/payment/check` pour vérifier le résultat.
  - Le montant encaissé doit être égal au total de la commande, sinon la commande est refusée (jamais de billets pour un montant inférieur).
- **Sécurité** : la clé API reste **uniquement sur le serveur**. Le navigateur ne reçoit que l'adresse du guichet (`payUrl`). Un test automatique vérifie que la clé n'apparaît dans aucune réponse.
- **Pourquoi pas le SDK « seamless » de CinetPay dans la page ?** Il demande de mettre la clé API dans le JavaScript du navigateur, donc visible par n'importe qui. Ici, c'est le serveur qui crée la transaction ; la pop-up ouvre le même guichet CinetPay, sans exposer la clé.
- **Notification** : déclarer `https://VOTRE-DOMAINE/api/webhooks/cinetpay` dans le compte CinetPay (le serveur répond 200 au test GET).

Variables : `PROVIDER_CINETPAY=live`, `CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `CINETPAY_CHANNELS` (`MOBILE_MONEY` par défaut), `CINETPAY_CURRENCY` (`XOF`).

Essai réel (une fois le compte ouvert) : `node deploy/cinetpay-test.js 100` crée une transaction de 100 FCFA, affiche l'adresse du guichet, suit l'état.

> **Vérification à faire** : l'adaptateur suit l'API CinetPay « v2 » (`apikey` / `site_id`). CinetPay publie aussi une API plus récente (v1, avec identifiants API + mot de passe). Je n'ai pas pu consulter leur documentation depuis l'environnement de développement : à la création du compte, confirmez quelle API est attribuée à votre site. L'adaptateur est isolé dans un seul fichier pour faciliter ce changement.

### 5.2 Orange Money direct (Web Payment)
Adaptateur `providers/orange.js` : OAuth → `webpayment` → notification → `transactionstatus`. Variables `PROVIDER_ORANGE=live`, `OM_AUTH_HEADER`, `OM_MERCHANT_KEY`, `OM_COUNTRY`, `OM_CURRENCY`. Essai bac à sable : `node deploy/orange-sandbox-test.js`.

**Essai gratuit en bac à sable (solution tirée du fichier `logique_paiement.docx`)** : le portail développeur Orange fournit gratuitement un jeton d'accès (OAuth `client_credentials`, en-tête `Authorization: Basic <clé encodée en base64>`) puis une demande de paiement `webpayment` avec `merchant_key`, `currency` (**`OUV`** en test, `XOF` en production), `amount`, `order_id`, `reference`, `return_url`, `cancel_url`, `notif_url`. Le serveur fait exactement ce flux dans `providers/orange.js`, avec trois différences volontaires par rapport à l'exemple du fichier :
- l'exemple utilise la même adresse pour retour, annulation et notification ; ici ce sont trois adresses du site (`/?order=…`, et `/api/webhooks/orange` pour la notification) ;
- l'exemple ne vérifie pas le résultat ; ici le serveur appelle `transactionstatus` avant de délivrer les billets ;
- les adresses de l'exemple sont tronquées (`https://orange.com`) : les vraies adresses sont `https://api.orange.com/oauth/v3/token` et `https://api.orange.com/orange-money-webpay/{pays}/v1/webpayment` (surchargeables par `OM_OAUTH_URL` / `OM_BASE_URL`).

Pour essayer : copier `deploy/env.bac-a-sable.example` en `.env`, y mettre la clé et la `merchant_key` du portail, rendre le serveur joignable (domaine ou tunnel), puis `node deploy/orange-sandbox-test.js 100`. Le test `tests/test-pages-interactives.js` rejoue déjà ce flux contre un faux serveur Orange.

**Compte marchand Orange Money (numéro 91765870)** — *À fournir.* Un compte marchand ne peut pas être créé par un logiciel : c'est un contrat avec Orange Mali (identification de l'organisme, pièces, signature d'une personne habilitée du ministère). Marche à suivre :
1. Demander à Orange Mali / Orange Business Services l'ouverture d'un compte marchand Orange Money « paiement en ligne » rattaché au numéro 91765870 (le titulaire doit être le ministère ou l'entité habilitée).
2. Obtenir : clé marchande (`OM_MERCHANT_KEY`), identifiants OAuth (`OM_AUTH_HEADER`), code pays et devise de production, accès bac à sable.
3. Renseigner `.env`, lancer `node deploy/orange-sandbox-test.js`, puis passer en production.
Le numéro est conservé dans `.env.example` (`ORANGE_MERCHANT_MSISDN`) à titre d'information interne ; il n'est jamais affiché sur le site ni utilisé par le code.

Attention : si l'encaissement passe par CinetPay, c'est **CinetPay** qui verse les fonds sur le compte du ministère (virement/retrait selon contrat) ; le compte Orange Money direct n'est nécessaire que pour le mode 5.2.

### 5.3 Moov Money direct
Désactivé : aucune documentation publique de l'API marchande n'a été trouvée. Moov est accessible via CinetPay (5.1).

### 5.4 Mode simulation
`PROVIDER_xxx=mock` : page de paiement fictive (`/sandbox/pay/…`) pour la démonstration et les tests. **Interdit en production** (le serveur refuse de démarrer).

## 6. API

Public
| Route | Rôle |
|---|---|
| `GET /api/config` | Moyens de paiement actifs, durée de réservation, mode démo, `legalValidated` |
| `GET /api/events` | Événements et tribunes (prix, places restantes) |
| `POST /api/cart/quote` | Devis du panier : montant calculé par le serveur |
| `POST /api/orders` | Crée la commande et le paiement → `{ref, token, payUrl}` |
| `GET /api/orders/{ref}?token=…` | Suivi d'une commande et billets |
| `POST /api/webhooks/cinetpay` (`GET` = test) | Notification CinetPay |
| `POST /api/webhooks/orange` / `moov` | Notifications opérateurs directs |
| `POST /api/recover/request` / `verify` | Retrouver ses billets par SMS (code à 6 chiffres) |
| `GET /api/my/orders` | Commandes de la session SMS |
| `POST /api/support` | Message au support |
| `GET /healthz` | État du serveur |

Administration (en-tête `x-api-key`)
| Route | Clé | Rôle |
|---|---|---|
| `POST /api/admin/validate` | `CONTROL_KEY` ou `ADMIN_KEY` | Valider/vérifier un billet (`consume:false` = vérifier seulement) |
| `GET/POST /api/admin/events…`, `/tribunes…` | `ADMIN_KEY` | Publier, modifier, fixer prix et stocks |
| `GET /api/admin/stats`, `/refunds`, `/support`, `/audit` | `ADMIN_KEY` | Statistiques, remboursements dus, messages, journal |
| `POST /api/admin/orders/{ref}/refunded` | `ADMIN_KEY` | Marquer un remboursement effectué |

## 7. Données (SQLite)
Tables : `events`, `tribunes` (prix, stock), `orders` (statut, total, opérateur, référence guichet), `tickets` (code unique `ML-XXXX-XXXX-XXXX`, utilisé le…), `otp` et `sessions` (récupération SMS), `support`, `admin_log` (journal inaltérable : modification et suppression interdites par la base).

## 8. Sécurité
- Clés `ADMIN_KEY` (≥ 24 car.) et `CONTROL_KEY` (≥ 16 car.) distinctes ; plusieurs clés de borne possibles.
- Prix et montants toujours calculés par le serveur ; clé CinetPay/Orange jamais envoyée au navigateur.
- Notifications jamais crues : revérification auprès du guichet, opération idempotente.
- Réservation et stock atomiques (aucune survente) ; billet acceptable **une seule fois**, même scanné en parallèle.
- Codes d'accès aux commandes et codes SMS stockés hachés ; limites de tentatives ; mêmes réponses qu'un numéro ait ou non des commandes.
- En-têtes de sécurité (CSP…), redirection vers le domaine officiel, HTTPS obligatoire en production.
- Journal des actions d'administration.
- En production, le serveur **refuse de démarrer** si : HTTP, clés faibles, mode simulation, aucun guichet actif, textes juridiques non validés.

## 9. Configuration (`.env`, modèle : `.env.example`)
`BASE_URL`, `DOMAIN`, `NODE_ENV=production`, `ADMIN_KEY`, `CONTROL_KEY`, `ORDER_TTL_MIN`, `PROVIDER_CINETPAY`, `CINETPAY_*`, `PROVIDER_ORANGE`, `OM_*`, `PROVIDER_MOOV`, `SMS_PROVIDER/URL/AUTH_HEADER/BODY_TEMPLATE`, `LEGAL_VALIDATED`, `RATE_ORDERS_PER_10MIN` (100 par défaut), `BACKUP_KEEP`.
Vérification avant ouverture : `node deploy/check-config.js` (chaque ligne « À FAIRE » doit disparaître).

## 10. Outils d'exploitation (`deploy/`)
| Fichier | Usage |
|---|---|
| `check-config.js` | Contrôle de la configuration de production |
| `cinetpay-test.js`, `orange-sandbox-test.js` | Essais avec de vrais identifiants |
| `import-events.js` | Charge `data/evenements.json` (idempotent) |
| `backup.js` | Sauvegarde cohérente de la base (`npm run backup`) |
| `loadtest.js` + `rapport-charge.txt` | Test de charge : aucune survente, un billet par place payée |
| `e2e-cinetpay.js` | Essai navigateur (Playwright) avec faux guichet CinetPay |
| `env.bac-a-sable.example` | Réglages d'essai Orange Money en bac à sable |
| `../tests/test-pages-interactives.js` | **Fichier unique** testant toutes les pages interactives (voir §11) |
| `build-legal.py` | Génère les pages juridiques à partir des textes |
| `Caddyfile`, `eticket.service`, `Dockerfile`, `docker-compose.yml` | Déploiement HTTPS |

Déploiement détaillé : `DEPLOY.md`.

## 11. Tests réalisés (en local)
- **21 tests automatiques** (`npm test`) : parcours complet, échec de paiement, réservation expirée, remboursement dû, anti-survente, récupération SMS, contrôle des billets, journal, verrou juridique, CinetPay (devis, montant vérifié, notification truquée ignorée, clé non exposée).
- **Test navigateur CinetPay** (`deploy/e2e-cinetpay.js`) avec un faux guichet : menu, pop-up de paiement ouverte sur le guichet, montant du panier reçu par le guichet, retour « Paiement confirmé », billets délivrés, clé absente du navigateur — 9/9.
- **Fichier unique de test des pages** (`node tests/test-pages-interactives.js`) : 45 contrôles dans un vrai navigateur — menu sur les 5 pages (ordinateur et mobile), affiches et filtres, réservation, paiement CinetPay en pop-up, paiement refusé, paiement Orange Money (faux serveur), billets QR, historique, support, récupération par SMS, administration (publication, statistiques, support, journal), contrôle aux entrées (valide, doublon, faux billet, diagnostic), pages juridiques, clé API jamais exposée. Rapport : `tests/rapport-pages.txt`, captures : `tests/captures/`.
- **Test navigateur du site** : achat par pop-up, billets QR, récupération SMS sur un second appareil, administration, borne, diagnostic, pages juridiques — sans erreur JavaScript.
- **Test de charge** : 1 800 acheteurs simultanés, 7/7 contrôles d'exactitude.
- **Non testé** : tout appel à de **vrais** serveurs CinetPay/Orange (identifiants requis), l'envoi de vrais SMS, Docker/Caddy, la caméra sur un vrai téléphone dans le stade.

## 12. Mise en ligne : ce qui reste à fournir
1. **Compte CinetPay** (clé API, identifiant du site, canaux Orange/Moov/Wave/Sama activés) et/ou **compte marchand Orange Money** (numéro 91765870, voir 5.2).
2. **Prix, places et horaires officiels** par tribune (saisie dans `/admin.html`).
3. **Passerelle SMS**, **hébergeur**, **nom de domaine**.
4. **Validation juridique** des conditions de vente et de la confidentialité, puis `LEGAL_VALIDATED=1`.
5. **Essai dans le stade** (réseau mobile, caméra) avec la page « Tester ce poste ».
6. **Remboursements** : le site les suit ; l'envoi de l'argent se fait chez l'opérateur.

## 13. Dépannage
| Symptôme | Cause probable |
|---|---|
| Le serveur ne démarre pas en production | Lire le message : il liste précisément ce qui manque |
| La pop-up ne s'ouvre pas | Bloqueur du navigateur : le site bascule en redirection plein écran |
| « Ce montant ne peut pas être payé en ligne » | CinetPay exige un montant entier multiple de 5 : ajuster le prix |
| Paiement fait mais pas de billet | Attendre quelques secondes ; sinon vérifier que `/api/webhooks/cinetpay` est joignable depuis Internet et déclaré chez CinetPay |
| « Plus assez de places » | Stock de la tribune épuisé pendant la saisie |
| Caméra refusée à l'entrée | Utiliser HTTPS, autoriser la caméra, ou saisie manuelle du code |

## 14. Copie fonctionnelle : ouvrir les pages directement
Les pages utilisent des liens **relatifs** (`css/site.css`, `js/common.js`, `vendor/qr.js`) : le design (fond, menu, boutons) s'applique que la page soit servie par le serveur ou ouverte par double-clic (`public/index.html`).
Ouvertes directement (adresse `file://`), les pages restent sur les fichiers pour naviguer et envoient leurs appels au serveur local (à lancer avec `npm start`) ; le serveur l'autorise uniquement en développement. **Limite** : le retour d'un paiement revient sur le site servi par le serveur (`http://localhost:3000`) ; pour acheter de bout en bout, utilisez cette adresse plutôt que le double-clic. En production, tout passe par le domaine officiel et rien de cela n'est actif. Test : `npm run test:fichiers`.

## 15. Connexion unique du personnel et clés par défaut
- **Menu → « Connexion personnel »** (sur toutes les pages) : une seule saisie de clé ouvre ensuite **Admin** et **Contrôle** sans nouvelle connexion, et la connexion est reprise dans les autres onglets du même navigateur pendant 8 h. « Déconnexion » dans le menu (ou « Quitter » dans l'administration) la supprime partout.
- La clé **administrateur** ouvre l'administration et le contrôle ; la clé **de contrôle** ouvre seulement le contrôle (l'administration reste protégée).
- **Clés par défaut (développement uniquement)**, utilisées si `ADMIN_KEY` / `CONTROL_KEY` ne sont pas définies : administrateur `admin-eticket-2026`, contrôle `controle-eticket-2026`.
- **Production** : ces clés par défaut ne s'appliquent jamais, et le serveur **refuse de démarrer** si elles sont utilisées. Définir des clés secrètes (`ADMIN_KEY` ≥ 24 caractères, `CONTROL_KEY` ≥ 16) dans `.env`.
- API : `POST /api/staff/login {key}` → `{role:"admin"|"control"}` ou 401 (limitée à 20 essais / 10 min).

## 16. Liaison avec le serveur : recherche, vérification, voyant
Chaque page affiche dans le menu un voyant : **● Serveur connecté (xx ms)**, **● Recherche du serveur…** ou **● Serveur introuvable**.
- **Chercher** : la page essaie, en parallèle, sa propre adresse (si servie par le serveur), la dernière adresse mémorisée, `http://localhost:3000`, `http://127.0.0.1:3000`, les ports 3001, 3002 et 8080.
- **Vérifier** : un serveur n'est accepté que s'il répond à `GET /healthz` avec `{"ok":true,"app":"E-Ticket Mali"}` (un autre programme sur le même port est refusé).
- **Établir** : l'adresse trouvée est mémorisée et utilisée pour tous les appels ; si le serveur n'était pas là au chargement, les affiches se chargent toutes seules dès qu'il apparaît.
- **Surveiller** : contrôle toutes les 15 s, au retour du réseau et après chaque échec ; un clic sur le voyant ouvre la fenêtre « Chercher et tester » (avec saisie d'une adresse).
- **Connexion personnel** : si aucun serveur n'est trouvé, le message l'explique (« Lancez-le avec npm start ») au lieu d'une erreur vague ; une mauvaise clé donne « Clé incorrecte ».
- Pages servies par un autre serveur local (ex. Live Server, port 5500) : l'API est trouvée ailleurs et le serveur l'autorise en développement (origines `localhost` / `127.0.0.1` uniquement).
- Lancement : `npm start`, ou double-clic sur `demarrer.bat` (Windows) / `demarrer.sh` (Mac, Linux) qui vérifient Node.js ≥ 22 et ouvrent le site. Test : `npm run test:reseau` (21 contrôles).

## 17. « Aucun serveur E-Ticket trouvé » : causes et solutions

**Cause** : la page est affichée, mais aucun serveur E-Ticket ne répond sur l'ordinateur (non lancé, Node.js absent ou trop ancien, port occupé, pare-feu).

Solutions, dans l'ordre :
1. `npm run doctor` : vérifie Node ≥ 22.13, node:sqlite, les fichiers, les ports 3000–3010, démarre un serveur d'essai et indique « OK » ou « À CORRIGER » avec le remède.
2. Installer/mettre à jour Node.js 22.13 ou plus récent (https://nodejs.org), puis relancer.
3. Lancer `npm start` ou double-cliquer `demarrer.bat` (Windows) / `demarrer.sh` (Mac/Linux) : ils exécutent le diagnostic avant le démarrage.
4. Si le port 3000 est occupé, le serveur prend automatiquement 3001 à 3010 ; les pages cherchent ces ports toutes seules. On peut aussi saisir l'adresse à la main dans la fenêtre « Connexion au serveur ».
5. Ouvrir directement http://localhost:3000 (et non le fichier) : seul ce mode permet le retour de paiement.
6. Dernier recours, **mode démonstration hors serveur** (bouton dans la fenêtre d'erreur) : l'API est simulée dans le navigateur (données locales, paiements simulés). Aucun vrai billet, aucun SMS, aucun vrai paiement ; sert uniquement à tester l'interface.

Clés par défaut en développement : administrateur `admin-eticket-2026`, contrôle `controle-eticket-2026` (refusées en production).
Tests : `npm run test:reseau` (31 contrôles, scénarios A à G).

## 18. Sports, version téléphone, journal des actions et synchronisation en temps réel

**Sports** (source : document « liste des sports au Mali », fichier `sports.js`) : football, basketball, athlétisme, arts martiaux, cyclisme, natation, courses de chevaux, lutte traditionnelle (Balla/Laamb), Sokone, jeux traditionnels, tir à l'arc, sports nautiques, culture & jeunesse. Chaque événement porte un champ `sport` (colonne `events.sport`, rempli automatiquement pour les événements existants). L'accueil propose un filtre par sport (avec le nombre d'affiches) ; l'administration choisit le sport à la publication et peut le modifier. `GET /api/sports` donne la liste ; un sport inconnu est refusé (400).

**Appareils et profils (§18 bis)** — règles d'affichage, détectées d'après le navigateur (`common.js`, `ET.platform`) :
- **Téléphones et tablettes Android / iOS (iPadOS compris)** : uniquement les options des utilisateurs (Accueil, Mes billets, Historique, Support, Conditions, Confidentialité). Aucune option « Admin » ni « Connexion personnel » ; la page admin affiche « Espace réservé aux ordinateurs ».
- **Ordinateurs Windows et Mac** : version ordinateur complète (options utilisateurs + Contrôle + Admin + « Connexion personnel »).
- **Autres appareils (Linux, ChromeOS, inconnu)** : options des utilisateurs seulement.
- **Agent de contrôle connecté (clé de contrôle)** : il ne voit QUE les options de contrôle (« Contrôle des billets » + « Déconnexion »), sur téléphone comme sur ordinateur. Toute autre page (accueil, admin…) le renvoie vers le contrôle. Il y arrive par le lien direct `…/controle.html` (qui reste utilisable sur téléphone) et saisit sa clé. La page admin n'est jamais accessible avec la clé de contrôle.
- **Administrateur** : uniquement sur ordinateur Windows/Mac ; la clé admin ouvre aussi le contrôle.
- Le paramètre `?personnel=1` a été supprimé. **Limite honnête** : ce filtrage est un confort d'affichage fondé sur le User-Agent (modifiable par un utilisateur averti) ; la vraie protection reste la clé vérifiée par le serveur à chaque requête. Test : `npm run test:appareils` (47 contrôles).

**Journal des actions (base de données)** : table `activity_log`, en lecture seule (déclencheurs SQL interdisant modification et suppression). Y sont enregistrées : pages et événements consultés, filtres, ouverture/annulation du paiement, consultation des billets, messages au support, récupération de billets, connexions du personnel (réussies ou refusées), création/paiement/échec/expiration des commandes, scans et vérifications de billets. Les numéros de téléphone sont masqués. Le journal des modifications de l'administration reste dans `admin_log`. Consultation : administration → « Activité en direct » (`GET /api/admin/activity`, clé administrateur).

**Synchronisation en temps réel** : une seule base sur le serveur ; chaque changement est poussé par flux SSE.
- `GET /api/stream` (public) : l'accueil se met à jour sans recharger quand l'administration change un événement, un prix ou un stock, ou quand des places sont vendues/remises en vente.
- `GET /api/admin/stream` (clé du personnel) : l'administration voit en direct les actions des visiteurs, les commandes, les statistiques, les remboursements, les messages du support ; l'écran de contrôle suit la liste des événements.
- Le voyant du menu indique « ⇄ temps réel » ; en cas de coupure, la reconnexion est automatique et l'écran se remet à jour.
- Mode démonstration hors serveur : les onglets du même navigateur se synchronisent entre eux (BroadcastChannel) ; il n'y a pas de synchronisation entre appareils sans serveur.
- Pour que les téléphones et les postes du personnel partagent les mêmes données, tous doivent utiliser le MÊME serveur (adresse du serveur sur le réseau, ex. http://192.168.x.x:3000 ou le domaine en production).

Tests : `npm run test:sports` (34 contrôles : sports, journal, flux temps réel, téléphone, synchronisation d'écrans, mode démo).

## 19. Version de présentation (live server Python, HTTPS, clés réelles)
`python live_server.py` démarre le moteur Node en interne (écoute locale 127.0.0.1:3100, paiement simulé, clés fortes), sert les fichiers du site, relaie l'API, le paiement simulé et le temps réel (SSE) et expose le tout en HTTPS sur `https://eticket-mjs.local:8443` (TLS 1.2/1.3, HSTS, CSP, redirection http→https sur 8080). Certificat signé par une autorité locale limitée au domaine (`certificats/`). Clés : `cles-acces.txt` (1 administration + 3 contrôle ; régénération : `--nouvelles-cles`). Guide : PRESENTATION.md ; test : `node tests/test-presentation-https.js` (25 contrôles).

## 20. Classement des bases de données par domaine
Voir **BASES-DE-DONNEES.md** : utilisateurs, admin et personnel en bases relationnelles (SQLite, une base chacune, transactions atomiques entre elles) ; contrôle (entrées validées + passages) et journal d'activité en bases non relationnelles (documents / clé-valeur, ajout seul). Comptes du personnel en base (clés hachées, révocation immédiate, noms de postes dans les journaux), écrans Administration → Personnel et Bases de données, sauvegarde unifiée (`deploy/backup.js`), migration automatique de l'ancienne base unique. Tests : `npm run test:bases` (41 contrôles).

## 21. Clés d'accès et mode de lancement
Ordre de priorité des clés (hors production) : variables d'environnement / `.env` → `cles-acces.json` (lu par `server.js`, donc par demarrer.bat, npm start et live_server.py ; `KEYS_FILE=none` pour l'ignorer) → clés de développement par défaut. Corrige le cas où les clés de `cles-acces.txt` étaient refusées lorsque le site était lancé par demarrer.bat.

## 22. Images des sports, carrousels et fond du site
- **Images locales** : `public/img/sports/<id>/1.svg 2.svg 3.svg` pour chacun des 13 sports du document « liste des sports au Mali » (illustrations originales aux couleurs du Mali : savane, fleuve Niger et mosquée de style soudanais, motifs bogolan). Ce sont des **illustrations, pas des photos**.
- **Photos réelles** : déposez simplement des fichiers `.jpg/.png/.webp/.svg` dans le dossier du sport (ex. `public/img/sports/football/`) — le serveur les liste (`/api/config` → `sports[].images`) et elles défilent sans toucher au code. Supprimez les `.svg` d'origine si vous ne voulez que vos photos. Prévoir les droits d'image.
- **Carrousels automatiques** (`ET.carousel` dans `public/js/common.js`) : changement toutes les 4 s, départs décalés, pause au survol / au focus / onglet masqué, points indicateurs, désactivé si l'utilisateur préfère « réduire les animations ». Présents dans **chaque affiche** (selon le sport de l'événement) et dans la section **« Autres affiches »** de l’accueil : uniquement les sports qui n’ont pas encore d’affiche à l’honneur, avec la mention « Bientôt » et un bouton « Bientôt disponible » (il devient une vraie affiche dès qu’un événement est publié pour ce sport).
- **Fond du site** : `public/img/fond-jeunesse.svg` (jeunes sportifs, mosquée, baobabs, soleil — très atténué sous un voile clair pour rester sobre) et `fond-hero.svg` (bandeau d'accueil). Appliqué aux pages publiques seulement (pas à admin/contrôle). Classe CSS `body.fond`.
- **Mode démo / fichier ouvert directement** : liste de secours `public/js/sport-images.js`.
- **Régénérer les illustrations** : `python3 outils/generer_images.py` (écrase les `1/2/3.svg` et `sport-images.js`).
- Test : `npm run test:images` (20 contrôles : images chargées, défilement, pause, clic filtre, fond, téléphone, démo, dépôt d'une photo).

**Lien « Autres affiches » ↔ « Affiches à l'honneur »** : une affiche est « à l'honneur » dès que sa billetterie est ouverte (au moins une tribune). Un événement annoncé sans tribune reste dans « Autres affiches » (avec son titre, sa date et le bouton grisé « Bientôt disponible ») ; quand l'administrateur ajoute une tribune (Admin → Événements → ajouter une tribune), l'affiche passe seule, en direct et sans recharger la page, dans « Affiches à l'honneur » avec son bouton « Réserver », et son sport reçoit sa puce de filtre. Test : `npm run test:affiches` (12 contrôles).

**Paiement : CinetPay retiré des options utilisateurs.** Les utilisateurs ne voient plus que **Orange Money** (actif dès que le compte marchand est configuré) et **Moov Money** (« bientôt disponible » tant que l'adaptateur n'est pas écrit). L'adaptateur `providers/cinetpay.js` reste dans le dépôt, inactif : il ne se réactive que par `ENABLE_CINETPAY=1`. Ce que les opérateurs doivent fournir est détaillé dans les deux lettres du Ministère (documents « Lettre à Orange Mali » et « Lettre à Moov Africa Mali »). Variables Orange : `OM_AUTH_HEADER`, `OM_MERCHANT_KEY`, `OM_COUNTRY`, `OM_CURRENCY`, `OM_BASE_URL`, `OM_OAUTH_URL`.

**Flux de paiement d'après les documents des opérateurs (`npm run test:flux`, 22 contrôles).**
- **Orange Money** (`providers/orange.js`) : deux modes. *Direct* (fichier `flow_paiement_OM`) : `OM_CLIENT_ID` + `OM_CLIENT_SECRET` (jeton OAuth en JSON), `OM_MERCHANT_KEY`, `OM_OAUTH_URL`, `OM_WEBPAYMENT_URL` ; *classique* (SDK WebPay) : `OM_AUTH_HEADER` + `OM_MERCHANT_KEY`. Redirection vers la page Orange, notification `notif_url` jamais crue : le site revérifie le statut et le montant. Le fichier d'Orange demande de « vérifier la signature » de la notification : Orange doit nous dire si elle est signée et comment (lettre, ligne 7).
- **Moov Money Mali** (`providers/moov.js`) : API directe SOAP/XML, **push USSD** (aucune redirection : l'acheteur saisit son code PIN sur son téléphone ; le site affiche « validez sur votre téléphone » et suit la commande). `requestPayment` (merchantId, password, `customerMsisdn` = 223 + 8 chiffres, montant, XOF, `referenceId` = référence de commande unique par tentative, `callbackUrl`) → réponse PENDING / 01 = demande prise en compte, pas un débit. Callback JSON ou XML limité aux IP Moov (`MOOV_CALLBACK_IPS`), jamais cru : revérification par `getTransactionStatus`, aussi interrogé en secours si rien n'arrive sous 120 s, avec contrôle du montant. L'IP fixe publique du serveur doit être enregistrée au contrat Moov.
- **À confirmer avec Moov** (absents du document) : l'adresse `MOOV_URL`, l'enveloppe exacte de `getTransactionStatus` (supposée : mêmes champs + `referenceId`), l'en-tête `SOAPAction`, les valeurs de statut autres que PENDING/SUCCESS. Pièces à fournir à Moov : RCCM (< 3 mois), NIF, pièce d'identité ou carte NINA du représentant légal, RIB d'une institution financière malienne agréée ; contrat « Grand Compte / Marchand » à la Direction Commerciale (Hamdallaye ACI 2000, Bamako). Un ministère n'a peut-être ni RCCM ni NIF au sens commercial : à voir avec Moov.

## 23. Préparation à la mise en ligne
Voir **PUBLICATION.md** (ce qui est prêt, ce que le ministère doit fournir, checklist de déploiement). Ajouts : contraste AA, lien d'évitement, libellés, SEO/partage, icône, manifest, robots.txt/sitemap.xml, page 404, en-têtes de sécurité supplémentaires, Dockerfile corrigé, mention du journal d'activité dans la politique de confidentialité. Test : `npm run test:publication`.

## 24. Accessibilité
Voir **ACCESSIBILITE.md** : résultats WebAbility/axe-core, limites, corrections (pause du défilement, images décoratives, cibles ≥ 24 px) et recommandations de test et d'audit (clavier, lecteurs d'écran, zoom, mobile, audit externe, déclaration d'accessibilité).


## Paiement CinetPay, fonctions Netlify et passerelle SMS (mise à jour)
- CinetPay est **de nouveau proposé** aux utilisateurs avec Orange Money et Moov Money (`ENABLE_CINETPAY=0` le masque).
- Fonctions Netlify : `initier_paiement`, `webhook_cinetpay`, `billet`, `valider_billet`, `liberer_reservations` (dossier `netlify/`), base SQL + MongoDB Atlas, connexions mises en cache. Guide complet : `DEPLOY-NETLIFY.md` ; test : `npm run test:netlify`.
- Passerelle SMS : `SMS_PROVIDER` = `console` | `twilio` | `orange` | `http` (voir `.env.example`).
