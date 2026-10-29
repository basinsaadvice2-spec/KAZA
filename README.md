# KAZA
KAZA de casa est un logiciel qui permet le suivi de ses résidences mises en logement
qui fait le lien entre propriétaires et locataires.

## Sécurité

Les règles Firestore sont versionnées dans `firestore.rules` et configurées dans `firebase.json`.
Elles limitent les opérations à l’utilisateur connecté et aux logements, contrats et conversations
qui le concernent. Les locataires doivent avoir une autorisation du bailleur et une adresse e-mail
vérifiée. Consultez [SECURITY.md](SECURITY.md) avant de publier des changements de sécurité Firebase.

La configuration Firebase du navigateur est publique par conception. Ne mettez jamais de clé
Firebase Admin, de compte de service, de mot de passe ou de secret serveur dans le navigateur ou GitHub.
