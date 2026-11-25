# KAZA

KAZA relie les bailleurs, les agences immobilières et les locataires à Kinshasa. Le site est une application web statique en HTML, CSS et JavaScript natif. Firebase fournit l'authentification, Firestore et les fonctions serveur. Les photos des annonces sont compressées dans le navigateur puis enregistrées dans le document Firestore du bien.

## Fonctionnalités

- Comptes bailleur, agence et locataire.
- Catalogue avec recherche et filtres par commune, type, tarif, SNEL et eau.
- Publication, modification et suppression contrôlée des annonces avec photos.
- Numéro de maison ou parcelle, appartement et immeuble.
- Réservation, messagerie, diffusion aux locataires, suivi des paiements et quittances.
- Profil public de l'annonceur et moyens de contact issus de son compte.
- Centre de notifications, préférences et alertes sur les recherches et logements suivis.
- PWA installable, mise à jour de l'interface et indication de l'état réseau.

## Déploiement Web

Vercel sert les fichiers à la racine du dépôt. Le rattachement du dépôt à Vercel doit pointer vers la branche `main`. Le fichier `vercel.json` définit les en-têtes du service worker et du manifeste.

## Configuration et déploiement Firebase

Le projet Firebase par défaut est `kaza-bf0dc` (`.firebaserc`). La configuration Web dans `firebase.js` est destinée au client et n'est pas une clé d'administration. Aucune clé privée ou aucun compte de service ne doit être ajouté au dépôt.

Les fonctions Cloud s'exécutent avec l'identité de service Firebase. Pour déployer les règles, l'index et les fonctions depuis une machine authentifiée avec le Firebase CLI :

```powershell
firebase deploy --only firestore:rules,firestore:indexes,functions
```

Pour activer le push Web, ajoutez la **clé publique Web Push (VAPID)** générée dans les paramètres Cloud Messaging du projet dans `push-config.js`. Elle est publique par conception. Ne placez jamais de clé privée VAPID, de clé Admin ou de compte de service dans le JavaScript client. Le centre est intégré à l'interface, mais les nouvelles notifications d'événement nécessitent que les fonctions et les règles Firebase soient déployées. Les push nécessitent en plus la clé VAPID.

Les fonctions utilisent Node.js 22. Installation locale et vérification :

```powershell
npm --prefix functions install
npm run check
npm --prefix functions run check
npm test
```

## Installation PWA

Ouvrez le domaine Vercel dans un navigateur compatible puis utilisez « Installer KAZA ». Si le navigateur ne fournit pas cette commande, le bouton affiche les étapes pour Android, iOS et ordinateur. Les recherches, messages, paiements et publications nécessitent une connexion; aucune donnée privée Firestore n'est mise dans le cache hors ligne.

## Préparation Android

La préparation TWA et l'identifiant candidat se trouvent sous `android/twa/`. Le fichier `assetlinks.json.example` n'est qu'un modèle. Il doit être remplacé par le véritable lien d'association et le certificat de signature avant de générer et tester un AAB. Aucun AAB signé ni aucune publication Play Store n'est inclus dans ce dépôt.

## Références

- [Inventaire et audit technique](AUDIT.md)
- [Modèle de sécurité et opérations Firebase](SECURITY.md)
- [Préparation TWA Android](android/twa/README.md)
