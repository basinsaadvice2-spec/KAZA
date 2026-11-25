# Audit KAZA et inventaire fonctionnel

## Périmètre et version de départ

- Dépôt audité : `basinsaadvice2-spec/KAZA`.
- Branche de référence au début du travail : `main`, commit `578465e34e6784877ffa4e2b73acda0e44fa28e4`.
- Sauvegarde récupérable créée avant modification : branche `backup/pre-mission-2026-11-24` et bundle Git local.
- Le site Vercel `kaza-sigma.vercel.app` a été ouvert en lecture seule. Il affichait l'écran initial KAZA; son commit de déploiement et ses parcours authentifiés n'ont pas pu être vérifiés depuis le navigateur utilisé.
- Après l'intégration, Vercel a affiché le bouton PWA « Installer KAZA ». Les parcours authentifiés n'ont pas été soumis et le déploiement Firebase n'a pas été exécuté depuis cet environnement.
- Le dépôt de départ était une application statique modulaire sans manifeste PWA, service worker, fonctions Cloud versionnées ni tests automatisés. Le README renvoyait à un `SECURITY.md` et à un `firebase.json` absents.

## Inventaire fonctionnel

| Fonctionnalité et rôle | Modules principaux | État de départ | Évolution dans cette branche |
|---|---|---|---|
| Connexion, inscription et rôles bailleur/locataire | `auth.js`, `firebase.js`, `state.js` | Firebase Auth et profil Firestore; type agence absent | Ajout du type agence, profil annonceur public limité et compatibilité des comptes anciens |
| Catalogue et recherche locataire | `catalog.js`, `data.js`, `format.js`, `views.js` | Annonces chargées puis filtrées dans le navigateur; champs de recherche existants | Recherche élargie aux numéros de logement et immeuble; filtre Parcelle; affichage du contact et de l'annonceur |
| Publication de biens et photos | `publish.js`, `owner.js`, `firestore.rules` | Publication avec images intégrées au document Firestore; édition de fiche et contrôle de taille | Compression locale WebP/JPEG, images data URL, limite de taille du document et contrôle bailleur |
| Réservation, annulation et départ | `booking.js`, `owner.js`, règles Firestore | Transitions côté client; pas de notifications serveur | Notifications réelles via triggers; transitions Firestore limitées par rôle et état |
| Paiements et quittances | `payments.js`, `format.js`, règles Firestore | Déclaration, validation/refus, reçu imprimable | Notification serveur à la déclaration et décision; validation renforcée des écritures |
| Messagerie et diffusion bailleur | `chat.js`, `chat-service.js`, `broadcast.js` | Conversations et messages; notifications créées côté client | Push + centre créés depuis le backend pour les nouveaux messages |
| Centre de notifications | `notifications.js`, `notify.js`, règles Firestore | Liste en direct et notifications client insuffisamment protégées | Préférences, lecture/non-lu, ouverture liée, recherches enregistrées, création réservée au serveur |
| Notifications push | Aucun module au départ | Absentes | FCM Web avec FID, service worker et fonctions serveur; attend la clé VAPID et le déploiement Firebase |
| Thème et navigation | `theme.js`, `views.js`, `ui.js`, `variables.css`, `style.css` | Interface et thèmes existants | Conservés; ajout des styles PWA et de l'état réseau |
| Administration | Aucun rôle ou écran admin repéré | Non présent dans le dépôt | Aucun rôle administratif inventé |
| Installation/offline | `index.html`, configuration Vercel | Pas de manifeste/service worker | Manifeste, icônes, cache limité à l'interface, mise à jour et instructions d'installation |
| Android / Play Store | Aucun projet Android au départ | Non préparé | Métadonnées candidates TWA; génération AAB, association signée et tests appareil restent requis |

## Modifications importantes

- Les photos sont encodées en data URL dans le document de l'annonce; elles sont recompressées plus fortement si le document approche 900 Ko.
- Les numéros de maison/parcelle, d'appartement et d'immeuble sont enregistrés et consultables dans le catalogue.
- Les profils annonceurs sont associés aux `ownerUid` réels, sans inventer d'identité.
- Les alertes sont créées depuis les changements réels de réservation, paiement, messagerie, annonce et logement suivi. Les IDs stables et transactions protègent contre les doublons des triggers.
- Les ressources d'application sont mises en cache; Firestore, messages, recherches et publication ne sont pas mis en cache ni annoncés comme disponibles hors ligne.
- Les règles Firestore interdisent les notifications écrites par le client. Elles doivent être déployées avec les fonctions qui les remplacent.

## Validation à effectuer

Les vérifications locales comprennent les tests Node de `tests/logic.test.mjs`, la syntaxe JavaScript et `git diff --check`. Le contrôle du site après intégration a confirmé l'affichage du bouton d'installation PWA sur Vercel. Les tests Firebase Emulator, l'authentification sur un vrai compte, l'envoi FCM sur appareil et la compilation Android nécessitent respectivement le Firebase CLI/émulateur, un projet Firebase actif, la clé VAPID et un environnement Android signé. Ils ne sont pas remplacés par les tests unitaires.
