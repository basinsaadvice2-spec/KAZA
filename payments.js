// js/payments.js
// ATTENTION (voir README-SECURITE.md) : comme dans l'ancienne version,
// "Signaler Loyer Payé" est une DÉCLARATION du locataire, pas une preuve
// de paiement réel — KAZA n'est connecté à aucune passerelle de paiement
// (Mobile Money, virement...). Le bailleur doit vérifier la réception
// réelle des fonds avant de cliquer "Confirmer". Cette limite est
// affichée explicitement dans l'interface (voir ui.js) et ne doit pas
// être présentée comme une transaction financière sécurisée tant qu'une
// vraie intégration de paiement n'est pas branchée.

import {
  doc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { state } from "./state.js";
import { getOrCreateChat, postSystemMessage } from "./chat.js";

async function findActiveLease(apartmentId) {
  const q = query(
    collection(db, "leases"),
    where("apartmentId", "==", apartmentId),
    where("status", "==", "active")
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function notifyPayment(apartment) {
  await updateDoc(doc(db, "apartments", apartment.id), {
    paymentStatus: "signale",
    updatedAt: serverTimestamp(),
  });
  const lease = await findActiveLease(apartment.id);
  if (lease) {
    await updateDoc(doc(db, "leases", lease.id), { paymentStatus: "signale" });
  }
  const chatId = await getOrCreateChat({
    ownerId: apartment.ownerId,
    apartmentId: apartment.id,
    apartmentTitle: apartment.title,
  });
  await postSystemMessage(
    chatId,
    `💰 LOGISTIQUE PAIEMENT : Le locataire ${state.currentUser.name} déclare avoir réglé le loyer de ${apartment.price} $ (déclaration non vérifiée, en attente de confirmation du bailleur).`
  );
}

export async function confirmTenantPayment(apartment) {
  await updateDoc(doc(db, "apartments", apartment.id), {
    paymentStatus: "confirme",
    updatedAt: serverTimestamp(),
  });
  const lease = await findActiveLease(apartment.id);
  if (lease) {
    await updateDoc(doc(db, "leases", lease.id), { paymentStatus: "confirme" });
  }
  const chatId = await getOrCreateChat({
    ownerId: state.currentUser.uid,
    apartmentId: apartment.id,
    apartmentTitle: apartment.title,
  });
  await postSystemMessage(
    chatId,
    "✅ PAIEMENT CONFIRMÉ : le bailleur a validé la réception du loyer pour ce mois."
  );
}
