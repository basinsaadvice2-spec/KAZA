// js/notifications.js
// Enregistrement du token FCM (Firebase Cloud Messaging) pour recevoir
// des notifications push (nouveau message, nouvelle demande de location,
// paiement signalé...). L'envoi effectif des notifications doit se faire
// depuis un environnement de confiance (Cloud Function déclenchée par un
// nouvel écrit Firestore) — voir functions/index.js (fonction non
// déployée par défaut, fournie comme point de départ).
//
// IMPORTANT : il faut remplacer VAPID_KEY_A_CONFIGURER par la clé
// générée dans Firebase Console > Project Settings > Cloud Messaging >
// Web configuration > Web Push certificates, sinon getToken() échouera.

import { getToken } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-messaging.js";
import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { getMessagingIfSupported } from "./firebase-init.js";
import { state } from "./state.js";

const VAPID_KEY = "VAPID_KEY_A_CONFIGURER";

export async function requestNotificationPermission() {
  if (!("Notification" in window)) return null;
  const messaging = await getMessagingIfSupported();
  if (!messaging) return null;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  try {
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (!token) return null;
    await setDoc(
      doc(
        db,
        "users",
        state.currentUser.uid,
        "notificationTokens",
        token.slice(0, 100)
      ),
      {
        token,
        platform: navigator.platform || "web",
        createdAt: serverTimestamp(),
      }
    );
    return token;
  } catch (err) {
    console.error("Impossible d'obtenir le token FCM :", err);
    return null;
  }
}
