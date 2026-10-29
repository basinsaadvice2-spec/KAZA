# Sécurité KAZA

## Configuration Firebase côté navigateur

KAZA est actuellement une application statique. La configuration Firebase Web, y compris `apiKey`, doit être livrée au navigateur pour qu'il se connecte au projet. Cette clé n'est pas un mot de passe. La déplacer dans une variable Vercel ne la rendrait pas secrète : le navigateur recevrait toujours sa valeur.

Ne publiez jamais de clé de compte de service, de secret Firebase Admin, de mot de passe ni d'autre identifiant serveur dans ce dépôt ou dans le code du navigateur. L'application n'utilise pas le SDK Firebase Admin.

## Règles Firestore

`firestore.rules` est la source versionnée des règles et `firebase.json` la référence. Les règles vérifient l'adresse e-mail, le rôle du profil, l'autorisation d'un locataire et les liens UID/propriétaire/locataire sur les logements, contrats, évaluations et conversations. Le navigateur ne peut modifier ni son rôle ni ses autorisations de bailleur.

Pour publier après validation :

```powershell
firebase deploy --only firestore:rules --project kaza-bf0dc
```

Les règles de ce dépôt ne changent pas Firebase tant que cette commande n'est pas exécutée ou qu'elles ne sont pas publiées dans la console.

## Réglages Firebase restants

- La clé Web possède des restrictions d'API, mais aucune restriction d'application HTTP. Configurez les référents après avoir confirmé les domaines Vercel de production et de prévisualisation; n'utilisez pas `*.vercel.app`, qui autoriserait les sites d'autres comptes.
- App Check n'est pas configuré. Ne l'activez pas en mode application forcée avant d'avoir intégré et testé son fournisseur sur le site.
- Firebase Storage n'est pas utilisé par le code actuel; les images sont des URL HTTPS enregistrées dans Firestore.
