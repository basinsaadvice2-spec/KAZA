// js/auth.js
// Remplace entièrement l'authentification localStorage de l'ancienne
// version par Firebase Authentication (Email/Password) + un profil
// Firestore users/{uid}. Aucune donnée d'identité n'est plus stockée
// côté client comme preuve : le seul état de vérité est le uid Firebase.

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  deleteUser,
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  limit,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";
import { state, resetStateOnSignOut } from "./state.js";

/**
 * Vérifie qu'un email de futur locataire a bien été autorisé par un
 * bailleur (collection `authorizations`, cf. 02-Firestore-architecture.md).
 * Doit être appelé UNE FOIS l'utilisateur authentifié (les règles
 * Firestore exigent request.auth != null et comparent au token email),
 * donc juste après createUserWithEmailAndPassword.
 */
async function isTenantEmailAuthorized(email) {
  const q = query(
    collection(db, "authorizations"),
    where("email", "==", email),
    where("status", "==", "active"),
    limit(1)
  );
  const snap = await getDocs(q);
  return !snap.empty;
}

/**
 * Inscription. `role` doit être 'owner' ou 'tenant'.
 * Pour un locataire, son email doit avoir été préalablement autorisé
 * par un bailleur — sinon le compte Firebase Auth qui vient d'être créé
 * est immédiatement supprimé (on ne laisse jamais un compte non autorisé
 * exister, même sans profil Firestore).
 */
// Le temps que registerUser() termine ses propres vérifications
// (autorisation locataire, création du profil), createUserWithEmailAnd
// Password() a déjà déclenché onAuthStateChanged en interne. Sans ce
// garde-fou, watchAuthState() tenterait de charger un profil Firestore
// qui n'existe pas encore et déconnecterait l'utilisateur en pleine
// inscription. Le flag fait patienter watchAuthState() pendant ce court
// intervalle au lieu de traiter l'absence de profil comme une erreur.
let registrationInFlight = false;

async function withRegistrationGuard(fn) {
  registrationInFlight = true;
  try {
    return await fn();
  } finally {
    registrationInFlight = false;
  }
}

export function isRegistrationInFlight() {
  return registrationInFlight;
}

export async function registerUser({ role, name, email, phone, password }) {
  return withRegistrationGuard(async () => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const user = cred.user;

    if (role === "tenant") {
      const authorized = await isTenantEmailAuthorized(email);
      if (!authorized) {
        await deleteUser(user).catch((e) =>
          console.error("Nettoyage du compte non autorisé impossible :", e)
        );
        throw new Error(
          "🛑 Accès refusé : votre adresse email n'est pas encore autorisée par un bailleur sur KAZA."
        );
      }
    }

    const profile = {
      name: name || (role === "owner" ? "Bailleur KAZA" : "Locataire KAZA"),
      email,
      phone: phone || "",
      role,
      createdAt: serverTimestamp(),
    };
    await setDoc(doc(db, "users", user.uid), profile);
    state.currentUser = { uid: user.uid, ...profile };
    return state.currentUser;
  });
}

export async function loginUser({ email, password }) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return loadUserProfile(cred.user.uid);
}

export async function loadUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) {
    throw new Error(
      "Profil introuvable pour ce compte. Contactez le support KAZA."
    );
  }
  return { uid, ...snap.data() };
}

export async function logoutUser() {
  await signOut(auth);
  resetStateOnSignOut();
}

/**
 * S'abonne aux changements de session Firebase Auth. `onReady` reçoit soit
 * un profil utilisateur complet (uid, name, email, phone, role), soit
 * `null` si personne n'est connecté. C'est la seule source fiable de
 * "qui est connecté" dans toute l'application.
 */
export function watchAuthState(onReady) {
  return onAuthStateChanged(auth, async (user) => {
    if (registrationInFlight) {
      // registerUser() est en train de vérifier l'autorisation et/ou de
      // créer le profil : on laisse faire, on ne réagit pas à cet
      // événement intermédiaire. registerUser() gère elle-même la suite
      // (navigation déclenchée depuis ui.js une fois la promesse résolue).
      return;
    }
    if (!user) {
      resetStateOnSignOut();
      onReady(null);
      return;
    }
    try {
      const profile = await loadUserProfile(user.uid);
      state.currentUser = profile;
      onReady(profile);
    } catch (err) {
      console.error("Erreur de chargement du profil KAZA :", err);
      await signOut(auth).catch(() => {});
      onReady(null);
    }
  });
}
