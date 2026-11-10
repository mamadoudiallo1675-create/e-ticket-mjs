# Déploiement – E-Ticket Mali

> Les fichiers Docker/Caddy/systemd ci-dessous n'ont **pas pu être exécutés** dans l'environnement de développement (pas de Docker). Le serveur lui-même, lui, a été testé (21 tests + démarrage en configuration « production »). Faites un premier déploiement de recette avant l'ouverture au public.

## 1. Prérequis
- Un serveur Linux (VPS 1 vCPU / 1 Go suffit pour démarrer) avec Docker + Docker Compose, **ou** Node.js ≥ 22.13.
- Un nom de domaine dont l'enregistrement DNS pointe vers le serveur ; ports 80 et 443 ouverts.
- Choisir l'hébergement avec les services juridiques du ministère (lieu de stockage des données, souveraineté).
- Un compte marchand Orange Money, et une passerelle SMS (voir §5).

## 2. Installation (Docker)
```bash
unzip eticket-mjs-mali.zip && cd eticket
cp .env.example .env && nano .env        # remplir DOMAIN, BASE_URL, ADMIN_KEY, CONTROL_KEY, OM_*, SMS_*
docker compose up -d --build
docker compose logs -f app               # doit afficher « Orange Money: mode=live actif »
curl https://VOTRE-DOMAINE/healthz       # {"ok":true}
```
Si la configuration est dangereuse (clé trop courte, HTTP, mode simulation…), le serveur **refuse de démarrer** et dit pourquoi.

Sans Docker : voir `deploy/eticket.service` (systemd) et placer un reverse proxy HTTPS (Caddy/nginx) devant le port 3000.

> **Un seul nom de domaine** : `BASE_URL` fixe l'adresse officielle ; en production le serveur redirige toute autre adresse (par exemple `www.`) vers elle. Sans cela, l'acheteur perdrait le lien avec sa commande au retour du paiement (domaine canonique).

## 3. Charger les événements
**Le plus simple : l'espace administrateur `https://VOTRE-DOMAINE/admin.html`** (clé `ADMIN_KEY`) permet de publier un match, d'ouvrir la billetterie (tribunes, prix, places), de confirmer l'horaire et de suivre les remboursements, sans ligne de commande. Les commandes ci-dessous font la même chose par l'API.

```bash
docker compose exec app node deploy/import-events.js            # importe data/evenements.json (idempotent)
```
Le fichier contient les deux matchs à domicile vérifiés (Mali–Rwanda 13/11/2026, Mali–Libéria 27/03/2027) **sans tarif** : ils s'affichent « Billetterie bientôt ouverte ». Quand le ministère/la FEMAFOOT communique les tribunes, les prix et les capacités :
```bash
curl -X POST https://VOTRE-DOMAINE/api/admin/events/1/tribunes -H "x-api-key: $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"tribunes":[{"nom":"Pelouse populaire","prix":1000,"stock":5000},{"nom":"Tribune d'\''honneur","prix":10000,"stock":300}]}'
# confirmer l'horaire officiel :
curl -X POST https://VOTRE-DOMAINE/api/admin/events/1 -H "x-api-key: $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"date":"2026-11-13T19:00","heureConfirmee":true}'
# ajuster un prix ou un stock :  POST /api/admin/tribunes/<id>  {"prix":1500,"stock":4000}
# nouvel événement :             POST /api/admin/events  {"type","titre","adv","date","lieu","tribunes":[…]}
```
Les heures sont en UTC (= heure du Mali). Les capacités ne doivent jamais dépasser celles du stade.

## 4. Orange Money – de la recette à la production
1. Sandbox : `OM_COUNTRY=dev`, `OM_CURRENCY=OUV`. Faire un achat complet, vérifier que la notification arrive sur `https://VOTRE-DOMAINE/api/webhooks/orange` et que les billets sont émis.
2. Demander à Orange le passage en production et **vérifier avec leur documentation** : code pays, devise, URLs. Le code suit le flux public de l'API WebPay mais n'a été validé que contre un faux serveur local.
3. Faire un achat réel de faible montant, puis rapprocher avec le relevé Orange.
4. Moov Money reste désactivé (`PROVIDER_MOOV=off`) tant que l'adaptateur `providers/moov.js` n'est pas complété avec la documentation de Moov Africa Malitel.

## 5. SMS de récupération des billets
Renseigner `SMS_URL`, `SMS_AUTH_HEADER`, `SMS_BODY_TEMPLATE` selon l'API de votre fournisseur (le message est envoyé au format `+223XXXXXXXX`). Sans SMS configuré, la fonction est masquée sur le site. Protections : 1 SMS/minute et 5/heure par numéro, 5 essais par code, code valable 10 min, réponse identique que le numéro ait ou non des billets. Limite connue : une personne qui contrôle la ligne (ex. échange de SIM frauduleux) pourrait récupérer les billets de ce numéro.

## 6. Bornes d'entrée
- Page : `https://VOTRE-DOMAINE/controle.html` (HTTPS obligatoire pour la caméra).
- Donner aux agents la **CONTROL_KEY** (jamais l'ADMIN_KEY). On peut en émettre plusieurs, séparées par des virgules, et en retirer une en cas de perte d'un téléphone.
- Choisir l'événement, « Valider l'entrée ». Vert = valide, rouge = déjà utilisé / invalide, orange = autre événement. Mode « Vérifier seulement » pour la formation.
- Tester la veille sur place : connexion 3G/4G au stade, luminosité, 2 téléphones scannant le même billet (le 2e doit être refusé).
- **Il faut du réseau** : le contrôle interroge le serveur en direct. Prévoir un plan B (saisie manuelle, 2e opérateur mobile, point d'accès).

## 7. Exploitation
- **Sauvegardes** : `docker compose exec app node deploy/backup.js` (14 dernières conservées dans le volume). Planifier chaque nuit (cron hôte) **et copier hors du serveur** :
  `0 2 * * * cd /opt/eticket && docker compose exec -T app node deploy/backup.js`
- **Supervision** : surveiller `https://VOTRE-DOMAINE/healthz` (UptimeRobot ou équivalent) ; alerte si l'état n'est pas 200.
- **Remboursements** : une commande `REFUND_DUE` = paiement reçu mais places épuisées. Liste : `GET /api/admin/stats` (compte) ; détail par requête SQL sur la base. Rembourser via l'opérateur.
- **Mise à jour** : remplacer le code, `docker compose up -d --build` (la base est dans le volume `eticket-data`, conservée).
- Une seule instance du serveur (SQLite). Largement suffisant pour des milliers de ventes ; pour une très forte affluence simultanée, prévoir une montée en charge avec une vraie base client-serveur.

## 8. Check-list avant l'ouverture
- [ ] HTTPS valide, `/healthz` OK, `BASE_URL` correct
- [ ] Achat Orange réel de test + billet scanné à une borne + 2ᵉ scan refusé
- [ ] SMS de récupération reçu sur un vrai téléphone
- [ ] Tarifs, capacités et horaires validés par le ministère/la FEMAFOOT
- [ ] Sauvegarde nocturne planifiée et restauration testée
- [ ] Conditions de vente, politique de remboursement, protection des données publiées
- [ ] Procédure de support (numéro/adresse du service client) renseignée sur le site


## Liste de contrôle avant ouverture

1. `cp .env.example .env`, renseigner toutes les variables, puis `node deploy/check-config.js` : chaque ligne « À FAIRE » doit disparaître.
2. **Textes juridiques** : faire valider `public/conditions.html` et `public/confidentialite.html`, remplacer les passages `[entre crochets]` dans `deploy/build-legal.py`, lancer `python3 deploy/build-legal.py`, puis `LEGAL_VALIDATED=1`. Le serveur refuse de démarrer en production sinon.
3. **Orange Money (bac à sable)** : avec les identifiants reçus, `PROVIDER_ORANGE=live node deploy/orange-sandbox-test.js 100` crée un paiement test, affiche l'adresse à ouvrir sur un téléphone, puis suit l'état jusqu'à SUCCESS/FAILED. Vérifier ensuite que la notification arrive bien sur `/api/webhooks/orange`.
4. **SMS** : `SMS_PROVIDER=http` + `SMS_URL`, `SMS_AUTH_HEADER`, `SMS_BODY_TEMPLATE` selon le contrat du fournisseur ; tester la récupération par SMS avec un vrai numéro.
5. **Bornes au stade** : sur chaque téléphone, ouvrir `/controle.html`, saisir la clé, puis « Lancer le test du poste » (réseau, caméra, lecteur de QR). Un vrai billet doit être scanné sur place, en plein soleil, avant le match.
6. **Test de charge sur le serveur réel** : `node deploy/loadtest.js` (voir `deploy/rapport-charge.txt` pour un exemple sur une machine de développement ; les temps dépendent de la machine).
7. **Journal** : chaque action d'administration (match, tarif, stock, remboursement) est inscrite dans l'onglet « Journal » et ne peut être ni modifiée ni effacée.
