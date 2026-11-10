# Mise en ligne d'E-Ticket — checklist de publication

**Statut : prêt techniquement, non publié.** Le site n'a été publié nulle part. Les points marqués 🔴 ne peuvent être réglés que par le ministère ou un tiers.

## 1. Déjà fait dans le code (vérifié par `npm run test:publication`, 30 contrôles ; accessibilité détaillée dans ACCESSIBILITE.md)
- Accessibilité WCAG 2.1 AA de base : contraste des boutons 5,5:1, lien « Aller au contenu », libellés de champs, annonces pour lecteurs d'écran, focus visible, un seul titre h1, langue `fr`.
- Référencement et partage : description, Open Graph, icône, manifest, `robots.txt` (cache admin/contrôle/API), `sitemap.xml` (adresse = `BASE_URL`), admin/contrôle en `noindex`.
- Sécurité : CSP stricte, `X-Frame-Options`, `nosniff`, `Permissions-Policy`, HSTS dès que `BASE_URL` est en https, refus de démarrer en production avec une configuration dangereuse (clés par défaut, mode simulé, etc.).
- Page 404 en français, mise en cache des images, `Dockerfile` corrigé (il omettait `docstore.js` et `sports.js` : le conteneur n'aurait pas démarré) + `.dockerignore` (clés, tests, certificats exclus).
- Sauvegardes (`deploy/backup.js`), test de charge (aucune survente), vérifications `npm run doctor`.

## 2. Hébergement conseillé
Le site est un serveur Node avec bases de fichiers : il lui faut une machine (VPS ou serveur du ministère) avec disque persistant, **pas** un hébergement statique/serverless (Netlify, Vercel…).
1. Serveur Linux avec Docker, un nom de domaine pointant dessus (ports 80 et 443 ouverts).
2. `cp .env.example .env`, renseigner `DOMAIN`, `BASE_URL=https://<domaine>`, `NODE_ENV=production`, `ADMIN_KEY` / `CONTROL_KEY` (clés longues et uniques, format `Nom=clé`), clés des opérateurs.
3. `docker compose up -d --build` : Caddy obtient le certificat HTTPS (Let's Encrypt) automatiquement.
4. `node deploy/doctor.js` puis `GET /healthz` ; planifier `deploy/backup.js` (cron) et copier les sauvegardes hors du serveur.

## 3. À fournir par le ministère / des tiers (🔴 bloquant pour une vraie billetterie)
- 🔴 **Compte marchand Orange Money et Moov Money** (clés API réelles, URL de retour et webhooks ; CinetPay n'est plus proposé aux utilisateurs). Lettres de demande prêtes dans les documents « Lettre à Orange Mali » et « Lettre à Moov Africa Mali » du projet. **Moov** : adaptateur écrit d'après le document technique Moov (push USSD, SOAP) ; reste à obtenir de Moov `MOOV_URL`, les identifiants, l'enveloppe de `getTransactionStatus`, les IP de la passerelle et l'enregistrement de l'IP fixe du serveur ; tant que ce n'est pas fait, le paiement est simulé.
- 🔴 **Passerelle SMS** pour la récupération des billets.
- 🔴 **Nom de domaine officiel** (ex. sous un domaine gouvernemental) et hébergement choisi ; renseigner les mentions `[à compléter]`.
- 🔴 **Validation juridique** des CGV et de la politique de confidentialité (les passages à compléter sont surlignés ; formalités auprès de l'autorité malienne de protection des données — APDP — à vérifier par le service juridique ; durée de conservation à fixer).
- 🔴 **Prix, lieux, horaires et événements réels** saisis par l'administration (aucun prix officiel n'a été inventé).
- 🔴 **Essai sur place** avec les bornes de contrôle (réseau du stade, éclairage, lecteurs QR) avant le premier match.
- 🔴 **Photos réelles** (avec droits d'image) à déposer dans `public/img/sports/<sport>/` si souhaité ; les images actuelles sont des illustrations.
- Recommandé : audit de sécurité indépendant, test d'accessibilité avec un lecteur d'écran (NVDA/VoiceOver), supervision (alerte si `/healthz` tombe).

## 4. Checklist de déploiement
- [ ] `npm test` et toutes les suites `test:*` au vert
- [ ] `.env` de production rempli, `NODE_ENV=production`, clés fortes (aucune clé de démonstration)
- [ ] Paiement en mode réel validé en bac à sable de l'opérateur (`deploy/cinetpay-test.js`, `orange-sandbox-test.js`)
- [ ] HTTPS actif, `BASE_URL` correct (sitemap, HSTS, retours de paiement)
- [ ] Sauvegarde automatique testée **et restauration testée**
- [ ] Textes légaux validés et placeholders `[à compléter]` supprimés
- [ ] Essai de bout en bout : réservation → paiement → billet QR → contrôle → remboursement
- [ ] Plan de retour arrière : conserver l'ancienne version et la dernière sauvegarde ; déclencheurs : paiements en échec > quelques %, erreurs 5xx, billets refusés à l'entrée
