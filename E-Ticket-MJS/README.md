# E-Ticket – Ministère de la Jeunesse et des Sports du Mali

**Documentation complète : `DOCUMENTATION.md`.**

Serveur + site de billetterie en ligne. **Aucune dépendance npm** : Node.js ≥ 22.13 suffit (SQLite intégré).

## Démarrer (mode démonstration, paiements simulés)

```bash
node --disable-warning=ExperimentalWarning server.js    # ou : npm start
# puis ouvrir http://localhost:3000
npm test                                                # 21 tests de bout en bout
```

## Architecture

| Fichier | Rôle |
|---|---|
| `server.js` | API HTTP, webhooks, contrôle d'accès, fichiers statiques |
| `db.js` | Base SQLite (événements, tribunes, commandes, billets), règles métier |
| `providers/orange.js` | Orange Money Web Payment (OAuth → webpayment → notification → transactionstatus) |
| `providers/moov.js` | **À compléter** (voir ci-dessous) |
| `providers/mock.js` | Simulation (aucun débit) |
| `sms/index.js` | Envoi des SMS (code de récupération) |
| `public/index.html` | Site : affiches, réservation, mes billets, historique, support, récupération par SMS |
| `public/admin.html` | Espace administrateur : publier/modifier les matchs, tarifs, stocks, remboursements, statistiques, support |
| `public/controle.html` | Page de scan des billets pour les bornes d'entrée |
| `data/evenements.json` + `deploy/import-events.js` | Événements réels (sans tarifs tant que non communiqués) |
| `deploy/`, `Dockerfile`, `docker-compose.yml` | Déploiement (HTTPS automatique via Caddy), sauvegardes |

## Parcours d'achat

1. `POST /api/orders` : le serveur recalcule le prix, **réserve les places** (15 min) et demande un paiement à l'opérateur.
2. Le client est redirigé vers la page de paiement de l'opérateur, puis revient sur `/?order=CMD-…`.
3. L'opérateur notifie `POST /api/webhooks/orange`. Le serveur **ne croit pas la notification** : il interroge l'opérateur (`transactionstatus`) avant de valider.
4. Paiement confirmé → billets générés (code unique non devinable, affiché en QR). Échec/expiration → places libérées.
5. Paiement arrivé après expiration → places re-réservées si possible, sinon commande `REFUND_DUE` (à rembourser).

## Contrôle à l'entrée

```bash
curl -X POST https://votre-site/api/admin/validate -H "x-api-key: $ADMIN_KEY" \
     -H "Content-Type: application/json" -d '{"code":"ML-XXXX-XXXX-XXXX","eventId":1}'
# -> {"result":"valid" | "already_used" | "invalid" | "wrong_event"}
```
Un billet ne peut être validé qu'une seule fois (opération atomique). La page de scan pour les bornes est fournie : `/controle.html` (caméra + saisie manuelle, clé `CONTROL_KEY`).

## Administration

- **Interface** : `/admin.html` (clé `ADMIN_KEY`) — publier un match, modifier date/lieu/horaire, prix et places, suivre ventes et recettes, remboursements à traiter, messages du support.
- API : `POST /api/admin/events` (en-tête `x-api-key`) : publier un match/événement avec ses tribunes.
- `GET /api/admin/stats` : commandes, billets et montants par statut.

**Déploiement, événements réels, bornes et SMS : voir `DEPLOY.md`.**

## Passage en production – ce qui reste à faire

1. **Orange Money** : ouvrir un compte marchand, obtenir `OM_AUTH_HEADER`, `OM_MERCHANT_KEY`, le code pays et la devise de production du Mali, puis vérifier les URLs dans leur documentation (le code suit le flux public de l'API WebPay ; il a été testé contre un faux serveur local, **pas contre Orange**). Tester d'abord en sandbox (`OM_COUNTRY=dev`, `OM_CURRENCY=OUV`).
2. **Moov Money** : aucune documentation publique de l'API marchand pour le Mali n'a été trouvée ; l'adaptateur est volontairement désactivé. À implémenter avec la documentation de Moov Africa Malitel, ou via un agrégateur.
3. **HTTPS** obligatoire (reverse proxy nginx/Caddy), `NODE_ENV=production`, `ADMIN_KEY` robuste, `BASE_URL` public (les opérateurs doivent pouvoir joindre `/api/webhooks/*`).
4. **Sauvegarde** régulière de toutes les bases : `node deploy/backup.js` (3 bases SQLite + 2 bases de documents, voir BASES-DE-DONNEES.md).
5. **Réconciliation** quotidienne avec les relevés des opérateurs, et procédure de remboursement pour les commandes `REFUND_DUE`.
6. Revue juridique : conditions de vente, protection des données (numéros de téléphone), conformité avec l'autorité compétente.
7. Les billets sont liés au navigateur du client (jeton stocké localement). Pour retrouver ses billets sur un autre appareil, prévoir une récupération par SMS/OTP.


## Ajouts récents
- Pages `conditions.html` et `confidentialite.html` (projets, passages à compléter surlignés) ; garde-fou : pas de démarrage en production sans `LEGAL_VALIDATED=1`.
- QR codes générés par le serveur lui-même (`public/vendor/qr.js`), sans service externe.
- Journal des actions d'administration (inaltérable), test de charge (`deploy/loadtest.js`), diagnostic des bornes (`/controle.html`), `deploy/check-config.js`, `deploy/orange-sandbox-test.js`.
- Limite par adresse IP portée à 100 commandes / 10 min (réseaux mobiles partagés), réglable par `RATE_ORDERS_PER_10MIN`.
- Paiement **CinetPay** (Orange Money, Moov, Wave, Sama Money selon le compte) : `providers/cinetpay.js`, pop-up `public/js/cinetpay-checkout.js`, panier `public/js/cart.js` (`POST /api/cart/quote`).
- Menu, design et scripts communs : `public/css/site.css`, `public/js/common.js`.
- Fichiers rangés : `deploy/import-events.js`, `docs/etat/`. Essais : `deploy/cinetpay-test.js`, `deploy/e2e-cinetpay.js`.
