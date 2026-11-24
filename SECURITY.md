# Sécurité KAZA

## Identité et annonces

- Firebase Authentication fournit l'identité; `users/{uid}.role` fixe le rôle. Une personne ne peut pas modifier son rôle depuis le client.
- Les propriétaires ne modifient que les champs de leur annonce. Les transitions réservation/location/paiement/départ sont limitées aux champs attendus.
- Les locataires ne peuvent réserver qu'un bien disponible, annuler leur propre demande et signaler leur propre départ.
- Les profils dans `publicProfiles/{uid}` ne publient que le nom, le téléphone, le rôle et le type de compte. Les locataires peuvent lire le profil d'un annonceur propriétaire; les listes de profils sont interdites.
- Les photos sont limitées à JPEG, PNG et WebP, à 5 Mo par fichier et à l'espace du propriétaire.

## Notifications et appareils

- La création de documents `notifications` est refusée au client. Les fonctions Cloud écrivent les événements issus de Firestore avec l'Admin SDK.
- Un utilisateur ne peut lire, marquer comme lues ou supprimer que ses propres notifications.
- Les FID push sont stockés sous le compte de leur propriétaire. Les envois se font côté serveur; le contenu de l'écran verrouillé reste générique.
- `push-config.js` est réservé à la clé publique VAPID. Les secrets de signature et identifiants de service ne doivent jamais être commis.

## Déploiement

Avant tout déploiement Firebase, vérifiez le projet actif (`firebase use`), les règles et le compte utilisé. Déployez ensemble les règles, l'index et les fonctions :

```powershell
firebase deploy --only firestore:rules,firestore:indexes,storage,functions
```

Les règles locales n'affectent pas Firebase tant qu'elles ne sont pas déployées. Les fonctions Cloud nécessitent l'environnement de facturation et les API demandés par Firebase pour ce projet. Le push dépend également de la clé VAPID publique configurée dans Firebase et dans `push-config.js`.

Après mise à jour des règles, testez les parcours de bailleur et de locataire avec des comptes de test. Aucun compte de service ni secret Firebase n'est stocké dans ce dépôt.
