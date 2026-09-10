// js/firebase-init.js
// Point d'entrée unique pour Firebase. Tous les autres modules importent
// leurs instances (app, auth, db, storage, messaging) depuis ce fichier.
// Aucun secret sensible ici : la clé API Firebase Web est publique par
// construction (elle identifie le projet, elle n'autorise rien à elle
// seule) — la vraie sécurité vient des Firestore/Storage Security Rules.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDIZPv2R6N2XfTPepTPSHk3WKVLqjkpy6g",
  authDomain: "kaza-bf0dc.firebaseapp.com",
  projectId: "kaza-bf0dc",
  storageBucket: "kaza-bf0dc.firebasestorage.app",
  messagingSenderId: "785266371417",
  appId: "1:785266371417:web:9dc8df1cfef4e12ec63a48",
  measurementId: "G-MTDDTVT839",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Session persistante sur l'appareil (équivalent de ce que localStorage
// tentait de faire, mais gérée nativement et de façon sûre par Firebase
// Authentication : le token est vérifié côté serveur, jamais fabriqué
// côté client).
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error("Impossible de configurer la persistance Auth :", err);
});

// Messagerie (FCM) : le SDK complet ne s'importe que si le navigateur le
// supporte, pour éviter des erreurs sur les navigateurs/iOS en mode non
// installé (PWA) qui ne supportent pas encore les notifications push.
export async function getMessagingIfSupported() {
  try {
    const { isSupported, getMessaging } = await import(
      "https://www.gstatic.com/firebasejs/10.14.0/firebase-messaging.js"
    );
    const supported = await isSupported();
    if (!supported) return null;
    return getMessaging(app);
  } catch (err) {
    console.warn("FCM non disponible sur ce navigateur :", err);
    return null;
  }
}

console.log("KAZA : Firebase initialisé (projet kaza-bf0dc).");
