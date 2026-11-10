# E-Ticket MJS – Guide de présentation (situation réelle)

Ce dossier contient le site complet du Ministère de la Jeunesse et des Sports du Mali, prêt à être présenté à un agent du ministère
sur un nom de domaine sécurisé : **https://eticket-mjs.local:8443**.

## 1. Démarrage en 3 étapes (ordinateur de présentation)
1. **Prérequis** : Python 3.8+ et Node.js 22.13+ (le moteur du site). Rien d'autre à installer (`npm install` inutile).
2. **Nom de domaine** (une seule fois) : ouvrir un terminal EN ADMINISTRATEUR dans ce dossier et lancer `python live_server.py --installer-domaine`
   (ou ajouter à la main la ligne `127.0.0.1 eticket-mjs.local` au fichier hosts).
3. **Cadenas HTTPS sans alerte** (une seule fois) : installer `certificats/ca-eticket-mjs.crt` comme autorité de confiance :
   - Windows : double-clic → « Installer le certificat » → « Ordinateur local » → « Placer tous les certificats dans le magasin suivant » → **Autorités de certification racines de confiance**.
   - macOS : double-clic (Trousseau d'accès) → ouvrir le certificat → « Se fier » → « Toujours approuver ».
   - Linux/Chrome : Paramètres → Confidentialité → Sécurité → Gérer les certificats → Autorités → Importer. Firefox : Paramètres → Certificats → Autorités → Importer.
   Cette autorité est limitée par construction à `eticket-mjs.local`, `localhost` et `127.0.0.1` ; sa clé privée a été détruite après la signature.
4. **Lancer** : `python live_server.py` (ou double-clic sur `lancer_presentation.bat` / `./lancer_presentation.sh`), puis ouvrir **https://eticket-mjs.local:8443**.

## 2. Clés d'accès (réelles, aléatoires — fichier `cles-acces.txt`)
| Rôle | Où l'utiliser | Clé |
|---|---|---|
| Administration | « Connexion personnel » ou /admin.html | `MJS-ADM-4UTSD-268Z2-PM4KH-WY5V7` |
| Contrôle – Porte principale | « Connexion personnel » ou /controle.html | `MJS-CTL-7FGQR-SC35C-YS4H2-2RU8J` |
| Contrôle – Porte tribune | idem | `MJS-CTL-JZ5JZ-RZNZJ-RJVL4-P3TAW` |
| Contrôle – Équipe personnel | idem | `MJS-CTL-H5QDD-9G845-8ERER-A9XQV` |

- Une seule connexion suffit pour tous les onglets (8 h). La clé d'administration ouvre aussi le contrôle ; une clé de contrôle ne donne PAS accès à l'administration.
- Les anciennes clés de développement (`admin-eticket-2026`…) sont refusées sur cette version.
- Avant toute mise en service réelle : `python live_server.py --nouvelles-cles` (et ne pas diffuser ce dossier : il contient les clés).

## 3. Scénario de démonstration conseillé (≈ 10 minutes)
1. **Visiteur sur téléphone ou ordinateur** : affiches, filtre par sport (liste du ministère), choix d'une tribune, montant calculé par le serveur.
2. **Réservation** : numéro Orange Money (8 chiffres), paiement → page de la passerelle **simulée** → « Simuler un paiement réussi » → billet QR (M-Ticket).
3. **Administration** (ordinateur) : « Connexion personnel » + clé admin → *Événements* (stocks en direct), *Statistiques*, **Activité en direct** (chaque action du visiteur apparaît instantanément), *Journal*.
4. **Contrôle aux entrées** : clé de poste → choisir l'événement → scanner le QR (caméra) ou saisir le code → « VALIDE » ; un 2ᵉ passage → « DÉJÀ UTILISÉ ».
5. **Temps réel** : modifier le stock ou le prix dans l'administration ; l'accueil du visiteur change sans rechargement.
6. **Sur téléphone ou tablette (Android, iOS)** : seules les options utilisateurs apparaissent ; Admin et Connexion personnel sont réservés aux ordinateurs Windows/Mac. Un agent de contrôle connecté ne voit que le Contrôle.

## 4. Présenter depuis des téléphones du même réseau
`python live_server.py --lan`, puis sur chaque téléphone : ajouter `IP_DU_PC eticket-mjs.local` à la résolution du nom (hosts / DNS du routeur) et installer le certificat `ca-eticket-mjs.crt`. L'accès par IP seule déclenche une alerte de certificat (normal).
Pare-feu : autoriser les ports 8443 et 8080.

## 5. Ce qui est simulé et ce qui est réel — à dire clairement au ministère
- **Réel** : site, base de données, clés d'accès, HTTPS (TLS 1.2/1.3, HSTS, CSP), billets QR uniques, contrôle anti-double passage, journal d'activité infalsifiable, temps réel, calcul des montants côté serveur.
- **Simulé** : le paiement Mobile Money (aucun argent ne circule, aucune vraie transaction Orange/Moov) et l'envoi de SMS (affiché dans la console). Les événements de démonstration, leurs prix et leurs lieux sont fictifs ; les vrais tarifs et horaires viennent du ministère.
- **Non couvert par ce dossier** (dépend du ministère ou de tiers) : compte marchand Orange Money et Moov Money et contrats, passerelle SMS, hébergement, **vrai nom de domaine** (ex. billetterie.sports.gouv.ml), validation juridique des conditions de vente, test sur site au stade.

## 6. Passer à un vrai nom de domaine public
Le nom `eticket-mjs.local` est un nom **local** : un certificat public (Let's Encrypt) ne peut pas être délivré pour lui. Pour un domaine réel : obtenir le domaine auprès de l'autorité compétente, le faire pointer vers le serveur, renseigner `.env` (voir `.env.example`, `DEPLOY.md`) et utiliser `deploy/Caddyfile` (HTTPS automatique) ; le moteur refuse alors de démarrer si la configuration est dangereuse (paiement simulé, clés faibles, textes juridiques non validés).
`python live_server.py --domaine billetterie.exemple.ml` fonctionne aussi avec un certificat que vous placez dans `certificats/` (`billetterie.exemple.ml.crt` + `.key`).

## 7. Dépannage
- « connexion non sécurisée » : le certificat `ca-eticket-mjs.crt` n'est pas installé, ou le navigateur n'a pas été redémarré.
- « site introuvable » : la ligne hosts manque (étape 2).
- Port occupé : `python live_server.py --port-https 9443 --port-http 9080` (le moteur interne utilise 3100 ; `ETICKET_BACKEND_PORT` pour le changer).
- Diagnostic du moteur : `npm run doctor`. Test complet de cette version : `node tests/test-presentation-https.js` (25 contrôles).
- Arrêt : Ctrl+C. Les données sont dans `donnees/` (supprimer ce dossier = repartir d'une base de démonstration vide).

## 8. Bases de données (à montrer au ministère)
Administration → **Bases de données** : chaque domaine a sa base du type adapté (utilisateurs, admin, personnel = relationnelles ; contrôle = documents/clé-valeur). Administration → **Personnel** : créer/révoquer des clés d'agents en direct. Détail et justification : `BASES-DE-DONNEES.md`.

## 9. Les clés fonctionnent quel que soit le mode de lancement
`demarrer.bat`, `npm start` et `python live_server.py` lisent tous les mêmes clés : celles de `cles-acces.json` (liste lisible : `cles-acces.txt`). Si ce fichier est supprimé, `demarrer.bat` retombe sur les clés de développement (`admin-eticket-2026` / `controle-eticket-2026`). Une clé changée prend effet au redémarrage ; l'ancienne est alors révoquée. Les espaces ou retours à la ligne collés avec la clé sont ignorés.
