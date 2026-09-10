// js/ratings.js
// Évaluation du locataire par le bailleur après la fin d'un bail
// (paiement, ponctualité, entretien, état de sortie, communication,
// respect du règlement, respect du voisinage, fiabilité — voir plan).
//
// Pour garantir "une seule évaluation par bail" sans dépendre de la
// discipline du code appelant, on utilise le leaseId COMME identifiant
// du document rating. Firestore refuse alors nativement une seconde
// création sur le même ID (une "create" ne peut réussir qu'une fois),
// et les Security Rules interdisent toute mise à jour par le bailleur
// ensuite — donc pas de double notation possible, pas de triche.

import {
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { state } from "./state.js";

export const RATING_CRITERIA = [
  { key: "paiement", label: "Paiement du loyer" },
  { key: "ponctualite", label: "Ponctualité" },
  { key: "entretien", label: "Entretien du logement" },
  { key: "etatSortie", label: "État des lieux de sortie" },
  { key: "communication", label: "Communication" },
  { key: "respectReglement", label: "Respect du règlement" },
  { key: "respectVoisinage", label: "Respect du voisinage" },
  { key: "fiabilite", label: "Fiabilité générale" },
];

export async function getEndedLeasesToRate(ownerId) {
  const q = query(
    collection(db, "leases"),
    where("ownerId", "==", ownerId),
    where("status", "==", "ended")
  );
  const snap = await getDocs(q);
  const leases = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const withoutRating = [];
  for (const lease of leases) {
    const ratingSnap = await getDoc(doc(db, "ratings", lease.id));
    if (!ratingSnap.exists()) withoutRating.push(lease);
  }
  return withoutRating;
}

export async function submitRating(lease, scores, comment) {
  const values = RATING_CRITERIA.map((c) => Number(scores[c.key]) || 0);
  const average =
    values.reduce((sum, v) => sum + v, 0) / RATING_CRITERIA.length;

  await setDoc(doc(db, "ratings", lease.id), {
    leaseId: lease.id,
    ownerId: state.currentUser.uid,
    tenantId: lease.tenantId,
    apartmentId: lease.apartmentId,
    scores,
    average: Math.round(average * 10) / 10,
    comment: (comment || "").trim().slice(0, 1000),
    status: "published",
    createdAt: serverTimestamp(),
  });
}

export async function getTenantRatings(tenantId) {
  const q = query(
    collection(db, "ratings"),
    where("tenantId", "==", tenantId),
    where("status", "==", "published")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
