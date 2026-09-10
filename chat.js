// js/chat.js
// Chat privé bailleur/locataire. Les messages sont stockés dans une
// sous-collection chats/{chatId}/messages pour respecter les Security
// Rules (participantIds vérifié à chaque lecture/écriture) et pour ne
// jamais charger des messages qui ne concernent pas l'utilisateur.
//
// Sécurité : plus aucun message n'est injecté via innerHTML — voir
// ui.js / dom-utils.js pour le rendu, qui utilise systématiquement
// textContent pour tout ce qui vient d'un utilisateur.

import {
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { state } from "./state.js";

function buildChatId(ownerId, tenantId) {
  return `${tenantId}_${ownerId}`;
}

/**
 * Récupère (ou crée) le fil de discussion unique entre le bailleur et le
 * locataire courant. `apartmentId` sert seulement de contexte affiché,
 * il n'a pas d'incidence sur les droits d'accès.
 */
export async function getOrCreateChat({ ownerId, apartmentId, ownerName, apartmentTitle }) {
  const tenant = state.currentUser;
  const chatId = buildChatId(ownerId, tenant.uid);
  const chatRef = doc(db, "chats", chatId);
  const snap = await getDoc(chatRef);

  if (!snap.exists()) {
    await setDoc(chatRef, {
      participantIds: [ownerId, tenant.uid],
      ownerId,
      ownerName: ownerName || "",
      tenantId: tenant.uid,
      tenantName: tenant.name,
      apartmentId: apartmentId || null,
      context: apartmentTitle || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  return chatId;
}

export async function postSystemMessage(chatId, text) {
  await addDoc(collection(db, "chats", chatId, "messages"), {
    senderId: "system",
    text,
    createdAt: serverTimestamp(),
  });
}

export async function sendMessage(chatId, text) {
  const clean = text.trim();
  if (!clean) return;
  if (clean.length > 2000) {
    throw new Error("Message trop long (2000 caractères maximum).");
  }
  await addDoc(collection(db, "chats", chatId, "messages"), {
    senderId: state.currentUser.uid,
    text: clean,
    createdAt: serverTimestamp(),
  });
}

/** Diffusion façon WhatsApp : renvoie un message donné à tous les
 * locataires du bailleur connecté. Chaque envoi passe par les mêmes
 * Security Rules qu'un message normal (senderId doit être l'utilisateur
 * courant, il doit être participant du chat cible). */
export async function broadcastToAllTenants(text) {
  const owner = state.currentUser;
  const q = query(collection(db, "chats"), where("ownerId", "==", owner.uid));
  const { getDocs } = await import(
    "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js"
  );
  const snap = await getDocs(q);
  let count = 0;
  for (const chatDoc of snap.docs) {
    await addDoc(collection(db, "chats", chatDoc.id, "messages"), {
      senderId: owner.uid,
      text: `[Diffusion Groupée] : ${text}`,
      createdAt: serverTimestamp(),
    });
    count += 1;
  }
  return count;
}

export function watchMyChats(callback) {
  const { role, uid } = state.currentUser;
  const field = role === "owner" ? "ownerId" : "tenantId";
  const q = query(collection(db, "chats"), where(field, "==", uid));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function watchMessages(chatId, callback) {
  const q = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("createdAt", "asc")
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
