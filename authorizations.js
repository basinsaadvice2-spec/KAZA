// js/authorizations.js
// Un bailleur autorise un email de locataire à s'inscrire sur KAZA.
// Collection `authorizations` (voir 02-Firestore-architecture.md et
// 03-firestore.rules) : seul le bailleur propriétaire de l'autorisation
// peut la créer/modifier/supprimer ; le futur locataire peut seulement
// LIRE les autorisations qui correspondent à son propre email (règle
// dédiée côté Firestore), pour la vérification au moment de l'inscription.

import {
  collection,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { state } from "./state.js";

export async function authorizeTenantEmail(email) {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) {
    throw new Error("Veuillez saisir un email valide.");
  }
  await addDoc(collection(db, "authorizations"), {
    ownerId: state.currentUser.uid,
    email: cleanEmail,
    status: "active",
    createdAt: serverTimestamp(),
  });
  return cleanEmail;
}
