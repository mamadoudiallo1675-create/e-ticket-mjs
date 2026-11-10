# Accessibilité d'E-Ticket — état, outils et recommandations de test et d'audit

Cible : **WCAG 2.1 niveau AA** (critères 2.2 pertinents inclus : 2.2.2 pause, 2.5.8 taille des cibles).

## 1. Ce qui a été contrôlé (et avec quoi)
| Contrôle | Outil | Résultat |
|---|---|---|
| Page d'accueil (structure, noms, libellés, ARIA, contraste) | **WebAbility** `scan_html` (moteur axe-core, navigateur) | 0 violation, 27 règles réussies |
| Couples de couleurs clés (texte gris, pied de page, étiquettes jaunes, bouton survolé) | WebAbility `check_color_contrast` | 5,5:1 · 11,1:1 · 14,3:1 · 7,1:1 — tous ≥ 4,5:1 |
| Bouton principal (blanc sur vert) | calcul + test automatisé | 5,47:1 (avant correction : 4,19:1) |
| Pause du défilement, cibles ≥ 24 px, focus visible au clavier, lien d'évitement, libellés, h1 unique | `npm run test:publication` (30 contrôles) | réussi |

**Limites à connaître (honnêteté) :**
- Le serveur WebAbility hébergé ne peut pas joindre `localhost` : j'ai donc scanné une **copie allégée de la page d'accueil** (HTML + CSS réels, images remplacées) et non le site en ligne. Les pages Conditions, Confidentialité, Mes billets, paiement, Admin et Contrôle ne sont pas passées dans ce scanner ; elles ont seulement eu les tests maison ci-dessus.
- Les outils **Axe MCP** (`analyze`, `igt` clavier, `remediate`) ne sont pas exposés dans cette session (seul le guide d'usage l'est) : **ils n'ont pas été exécutés**.
- Le contraste du texte posé **sur des images** (étiquettes des affiches) ne se mesure pas automatiquement ; il est assuré par un dégradé sombre sous le texte, à vérifier visuellement.
- Aucun test avec lecteur d'écran réel n'a été fait.

## 2. Corrections faites à cette occasion
- Bouton de **pause du défilement** des images (WCAG 2.2.2) ; défilement arrêté d'office pour qui a réglé « réduire les animations » ; images des carrousels **décoratives** (alt vide, masquées aux lecteurs d'écran) car le nom du sport est déjà écrit en texte.
- Liens du pied de page : zone cliquable ≥ 24 px.
- Déjà fait : contraste du vert, lien « Aller au contenu », libellés des champs, annonces `aria-live`, focus visible.

## 3. À lancer vous-même avant l'ouverture
1. **Scan du site réel (hors ligne ou en ligne)**
   - Local : `npx -y @webability/mcp` puis demander `scan_page` sur `http://localhost:3000/` (ou `webability-tunnel --port 3000`).
   - Axe : installer le serveur Axe MCP (`/axe-accessibility:mcp-setup`), puis `/axe-accessibility:mcp-audit` sur chaque page ; lancer aussi le test **clavier** (`igt`) qui détecte pièges au clavier et focus manquant.
   - Alternative sans compte : extension *axe DevTools* ou Lighthouse (Chrome) page par page.
2. Pages et parcours à couvrir : accueil, filtres, réservation (dialogue de commande), paiement Mobile Money, Mes billets (QR), Historique, Support, Conditions, Confidentialité, puis **Contrôle** et **Admin** (réservés au personnel mais utilisés par des agents).
3. **Test clavier seul** : Tab/Maj+Tab, Entrée/Espace, Échap dans les dialogues, aucun piège, ordre logique, focus visible.
4. **Lecteurs d'écran** : NVDA + Firefox/Chrome (Windows), TalkBack (Android — le plus utilisé au Mali), VoiceOver (iOS). Vérifier surtout la réservation, l'annonce des erreurs et la page du billet.
5. **Zoom et affichage** : 200 % et 400 % sans perte de contenu, texte agrandi, mode contraste élevé, orientation portrait/paysage, petit écran (320 px).
6. **Mobile réel** : cibles tactiles, lecture du QR en plein soleil, écran en luminosité maximale, connexion lente.
7. **Langue et lisibilité** : textes en français simple ; envisager une version en **bambara** ou au moins des pictogrammes pour le parcours d'achat (public peu francophone / peu lettré).
8. **Audit externe** : faire valider par un auditeur d'accessibilité ; publier une **déclaration d'accessibilité** (niveau de conformité, limites connues, contact pour signaler un problème).
9. **Intégration continue** : relancer `npm run test:publication` + un scan axe à chaque modification ; refuser une mise en ligne si une violation « critique » ou « sérieuse » apparaît.

## 4. Points d'attention connus
- Le défilement automatique reste une animation : le bouton de pause doit rester visible et fonctionnel.
- Les couleurs du drapeau (jaune/rouge) ne doivent jamais porter seules une information (ajouter un texte ou une icône).
- Les illustrations n'ont pas d'alternative textuelle détaillée (volontairement décoratives) ; si de vraies photos informatives sont ajoutées, leur donner un `alt` descriptif.
