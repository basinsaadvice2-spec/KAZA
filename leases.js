// js/leases.js
// Corrige une faille fonctionnelle de l'ancienne version : rentApartment()
// modifiait l'objet en mémoire sans aucune garantie d'atomicité — deux
// locataires cliquant "Louer" à quelques millisecondes d'intervalle
// pouvaient tous les deux "gagner" le même logement (race condition).
// Ici, tout passe par une transaction Firestore : la lecture et
// l'écriture du statut du bien sont atomiques, donc un seul locataire
// peut réussir à louer un bien donné.

import {
  doc,
  runTransaction,
  collection,
  addDoc,
  updateDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { state } from "./state.js";
import { getOrCreateChat, postSystemMessage } from "./chat.js";

export async function rentApartment(apartmentId) {
  const apartmentRef = doc(db, "apartments", apartmentId);
  const tenant = state.currentUser;
  let ownerId;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(apartmentRef);
    if (!snap.exists()) throw new Error("Ce logement n'existe plus.");
    const data = snap.data();
    if (data.status === "Occupé") {
      throw new Error(
        "Trop tard : ce logement vient d'être loué par quelqu'un d'autre."
      );
    }
    ownerId = data.ownerId;
    tx.update(apartmentRef, {
      status: "Occupé",
      tenantId: tenant.uid,
      tenantName: tenant.name,
      paymentStatus: "en_attente",
      updatedAt: serverTimestamp(),
    });
  });

  // La transaction a réussi : on crée le bail (leases) et on prévient
  // le bailleur par chat. Ces deux opérations ne sont pas critiques pour
  // l'intégrité du "qui a loué quoi" (déjà garantie ci-dessus), donc
  // elles n'ont pas besoin d'être dans la même transaction.
  const leaseRef = await addDoc(collection(db, "leases"), {
    apartmentId,
    ownerId,
    tenantId: tenant.uid,
    tenantName: tenant.name,
    tenantPhone: tenant.phone || "",
    status: "active",
    paymentStatus: "en_attente",
    startDate: serverTimestamp(),
    endDate: null,
  });

  const chatId = await getOrCreateChat({ ownerId, apartmentId });
  await postSystemMessage(
    chatId,
    `🚨 NOTIFICATION : Le locataire ${tenant.name} (${tenant.phone || "pas de numéro"}) demande à louer votre résidence.`
  );

  return leaseRef.id;
}

export async function leaveApartment(apartmentId) {
  const apartmentRef = doc(db, "apartments", apartmentId);
  const tenant = state.currentUser;
  let ownerId;
  let leaseId = null;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(apartmentRef);
    if (!snap.exists()) throw new Error("Ce logement n'existe plus.");
    const data = snap.data();
    if (data.tenantId !== tenant.uid) {
      throw new Error("Vous n'êtes pas le locataire actuel de ce bien.");
    }
    ownerId = data.ownerId;
    tx.update(apartmentRef, {
      status: "Disponible",
      tenantId: null,
      tenantName: null,
      paymentStatus: null,
      updatedAt: serverTimestamp(),
    });
  });

  const activeLease = await getActiveLease(apartmentId, tenant.uid);
  if (activeLease) {
    leaseId = activeLease.id;
    // Le locataire est autorisé (Security Rules) à faire passer SON
    // propre bail actif à 'ended' — et seulement cette transition
    // précise. Toute autre modification du bail reste réservée au
    // bailleur ou à un compte admin.
    await updateDoc(doc(db, "leases", leaseId), {
      status: "ended",
      endDate: serverTimestamp(),
    });
  }

  const chatId = await getOrCreateChat({ ownerId, apartmentId });
  await postSystemMessage(
    chatId,
    `📭 NOTIFICATION DE DÉPART : Le locataire ${tenant.name} a libéré votre résidence.`
  );

  return leaseId;
}

async function getActiveLease(apartmentId, tenantId) {
  const q = query(
    collection(db, "leases"),
    where("apartmentId", "==", apartmentId),
    where("tenantId", "==", tenantId),
    where("status", "==", "active")
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}
