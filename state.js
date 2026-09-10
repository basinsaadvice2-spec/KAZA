// js/state.js
// État global de l'interface, en mémoire uniquement.
//
// IMPORTANT : contrairement à l'ancienne version, ce state ne contient
// plus aucune preuve d'identité, de rôle ou de propriété. Le rôle et
// l'utilisateur courant sont dérivés de Firebase Authentication +
// Firestore (users/{uid}), jamais de localStorage. Ce module ne stocke
// que des préférences d'affichage (filtres, onglet actif...) qui n'ont
// aucune conséquence de sécurité si elles sont manipulées.

export const state = {
  // Rempli par auth.js après une lecture Firestore fiable (users/{uid}).
  // Forme : { uid, name, email, phone, role, createdAt }
  currentUser: null,

  // Rôle actuellement affiché à l'écran (choisi sur l'écran d'accueil).
  // Ne sert qu'à savoir quel formulaire de connexion afficher ; le rôle
  // réel est toujours revérifié depuis Firestore après connexion.
  pendingRole: null,
  authMode: "login",

  // Caches locaux, alimentés par des écouteurs Firestore en temps réel
  // (onSnapshot). Ce sont des reflets du serveur, jamais une source de
  // vérité : on ne modifie jamais ces tableaux directement en écriture,
  // seulement via des appels Firestore qui redéclenchent l'écouteur.
  apartments: [],
  chats: [],
  activeChatId: null,
  messagesUnsubscribe: null,

  // Filtres de recherche côté locataire (purement cosmétiques).
  searchQuery: "",
  filterType: "Tous",
  filterCommune: "Toutes",
};

export function resetStateOnSignOut() {
  state.currentUser = null;
  state.pendingRole = null;
  state.authMode = "login";
  state.apartments = [];
  state.chats = [];
  state.activeChatId = null;
  if (typeof state.messagesUnsubscribe === "function") {
    state.messagesUnsubscribe();
  }
  state.messagesUnsubscribe = null;
  state.searchQuery = "";
  state.filterType = "Tous";
  state.filterCommune = "Toutes";
}
