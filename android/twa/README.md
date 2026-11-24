# Préparation Android KAZA (TWA)

KAZA est une application web statique et Firebase. Une Trusted Web Activity (TWA) réutilise la PWA et garde une seule interface à maintenir; Capacitor ajouterait une couche native qui n'est pas nécessaire pour les fonctions actuelles.

## Configuration retenue

- URL web : `https://kaza-sigma.vercel.app/`
- Identifiant Android candidat : `com.basinsaadvice2.kaza`
- Manifeste PWA : `https://kaza-sigma.vercel.app/manifest.webmanifest`
- Nom affiché : `KAZA`

L'identifiant doit être vérifié et réservé dans le compte Play Console avant le premier build. Ne le changez plus après la publication.

## Génération du projet

Après la mise en production de la PWA et la confirmation de son domaine :

1. Installer Node.js, le JDK et Android SDK sur une machine de build Android.
2. Générer le projet TWA Bubblewrap à partir du manifeste publié et vérifier l'`applicationId` ci-dessus.
3. Construire un AAB signé avec une clé gardée hors du dépôt.
4. Ajouter le certificat SHA-256 de la clé Play App Signing au fichier `assetlinks.json`.
5. Publier le fichier final à `https://kaza-sigma.vercel.app/.well-known/assetlinks.json`.
6. Vérifier la TWA sur un appareil Android, puis envoyer l'AAB au canal de test interne de Play Console.

Le fichier `assetlinks.json.example` est un modèle, pas un fichier publiable : son empreinte est volontairement un espace réservé. Aucun keystore, mot de passe, AAB ni empreinte réelle n'est présent dans Git.

## État

Le manifeste, les icônes et la PWA sont préparés dans le dépôt. Le projet Android généré, l'AAB signé, l'empreinte Play App Signing et la vérification sur appareil restent à faire sur la machine disposant du JDK/SDK et du compte Play Console. La publication sur Play Store attend l'autorisation du propriétaire.
