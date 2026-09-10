// js/app.js
// Point d'entrée. Initialise les écouteurs d'UI puis laisse
// watchAuthState() décider quel écran afficher : c'est Firebase Auth qui
// fait autorité sur "qui est connecté", jamais une valeur lue en local.

import { watchAuthState } from "./auth.js";
import {
  initRoleSelection,
  initAuthScreen,
  initOwnerDashboard,
  initAddApartmentScreen,
  initTenantDashboard,
  initChatRoom,
  initPwaInstall,
  enterAppForUser,
  exitAppToRoleSelect,
  changeView,
} from "./ui.js";

initRoleSelection();
initAuthScreen();
initOwnerDashboard();
initAddApartmentScreen();
initTenantDashboard();
initChatRoom();
initPwaInstall();

let firstCheck = true;

watchAuthState((profile) => {
  if (profile) {
    enterAppForUser(profile);
  } else if (!firstCheck) {
    // Ne force le retour à l'écran de rôle que si l'utilisateur était
    // déjà connecté (déconnexion), pas au tout premier chargement où
    // l'écran de rôle est déjà l'écran par défaut.
    exitAppToRoleSelect();
  } else {
    changeView("scr-role-select");
  }
  firstCheck = false;
});
