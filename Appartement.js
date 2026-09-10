// js/apartments.js
// Firestore devient la source de vérité pour les logements (fin du
// tableau state.apartments alimenté depuis localStorage). ownerId est
// TOUJOURS pris depuis l'utilisateur authentifié, jamais depuis un champ
// de formulaire — les Security Rules le revérifient de toute façon
// côté serveur (request.resource.data.ownerId == request.auth.uid).

import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { state } from "./state.js";

const MAX_PHOTOS = 4;

export function buildApartmentPayload(form) {
  const title = form.title.trim();
  const price = Number(form.price);
  if (!title || !price || !form.avenue.trim() || !form.streetNumber.trim() || !form.reference.trim()) {
    throw new Error(
      "Merci de remplir tous les détails obligatoires (Titre, Avenue, N°, Référence, Prix)."
    );
  }
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Le prix du loyer doit être un nombre positif.");
  }
  const images = [form.photo1, form.photo2, form.photo3, form.photo4]
    .map((u) => (u || "").trim())
    .filter(Boolean)
    .slice(0, MAX_PHOTOS);
  if (images.length === 0) {
    throw new Error("Merci de fournir au moins une photo de couverture (URL).");
  }
  return {
    title,
    type: form.type,
    commune: form.commune,
    avenue: form.avenue.trim(),
    streetNumber: form.streetNumber.trim(),
    door: form.door ? form.door.trim() : null,
    reference: form.reference.trim(),
    price,
    specs: form.specs?.trim() || "Non spécifié",
    imageUrl: images[0],
    images,
    status: "Disponible",
    ownerId: state.currentUser.uid,
    ownerName: state.currentUser.name,
    tenantId: null,
    tenantName: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

export async function createApartment(form) {
  const payload = buildApartmentPayload(form);
  await addDoc(collection(db, "apartments"), payload);
}

export async function deleteApartment(apartmentId) {
  await deleteDoc(doc(db, "apartments", apartmentId));
}

/**
 * Écoute en temps réel les biens d'un bailleur donné. Retourne une
 * fonction de désabonnement.
 */
export function watchOwnerApartments(ownerId, callback) {
  const q = query(
    collection(db, "apartments"),
    where("ownerId", "==", ownerId),
    orderBy("createdAt", "desc")
  );
  return onSnapshot(q, (snap) => {
    const apartments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(apartments);
  });
}

/**
 * Écoute en temps réel le catalogue complet (vue locataire). Les filtres
 * (type, commune, recherche texte) restent appliqués côté client car ce
 * sont de simples préférences d'affichage, pas des contrôles d'accès.
 */
export function watchCatalog(callback) {
  const q = query(collection(db, "apartments"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    const apartments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(apartments);
  });
}

export function filterCatalog(apartments) {
  const { searchQuery, filterType, filterCommune } = state;
  return apartments.filter((item) => {
    const matchesSearch = item.title
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesType = filterType === "Tous" || item.type === filterType;
    const matchesCommune =
      filterCommune === "Toutes" || item.commune === filterCommune;
    return matchesSearch && matchesType && matchesCommune;
  });
}
