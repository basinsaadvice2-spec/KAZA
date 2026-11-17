import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import { browserLocalPersistence, createUserWithEmailAndPassword, deleteUser, getAuth, onAuthStateChanged, sendEmailVerification, setPersistence, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { addDoc, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, getFirestore, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { deleteObject, getDownloadURL, getStorage, ref as storageRef, uploadBytes } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-storage.js";

// Public Firebase web configuration. Firebase client API keys identify the project;
// Firestore Rules and App Check (when configured) control access.
const firebaseConfig = {
  apiKey: "AIzaSyDIZPv2R6N2XfTPepTPSHk3WKVLqjkpy6g",
  authDomain: "kaza-bf0dc.firebaseapp.com",
  projectId: "kaza-bf0dc",
  storageBucket: "kaza-bf0dc.firebasestorage.app",
  messagingSenderId: "785266371417",
  appId: "1:785266371417:web:9dc8df1cfef4e12ec63a48",
  measurementId: "G-MTDDTVT839",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error("Impossible de configurer la persistance Auth :", err);
});

async function getMessagingIfSupported() {
  try {
    const { isSupported, getMessaging, getToken } = await import(
      "https://www.gstatic.com/firebasejs/10.14.0/firebase-messaging.js"
    );
    const supported = await isSupported();
    if (!supported) return null;
    return { messaging: getMessaging(app), getToken };
  } catch (err) {
    console.warn("FCM non disponible sur ce navigateur :", err);
    return null;
  }
}

console.log("KAZA : Firebase initialisé (projet kaza-bf0dc).");
// ===================== state.js =====================
const state = {
  currentUser: null,
  pendingRole: null,
  authMode: "login",
  apartments: [],
  chats: [],
  activeChatId: null,
  messagesUnsubscribe: null,
  searchQuery: "",
  filterType: "Tous",
  filterCommune: "Toutes",
};

function resetStateOnSignOut() {
  state.currentUser = null;
  state.pendingRole = null;
  state.authMode = "login";
  state.apartments = [];
  state.chats = [];
  state.activeChatId = null;
  if (typeof state.messagesUnsubscribe === "function") {
    state.messagesUnsubscribe();
  }
  state.messagesUnsubscribe = null;
  state.searchQuery = "";
  state.filterType = "Tous";
  state.filterCommune = "Toutes";
}


// ===================== dom-utils.js =====================
function el(tag, { className, attrs, text, children, on } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== null && value !== undefined) node.setAttribute(key, value);
    }
  }
  if (text !== undefined) node.textContent = text;
  if (children) {
    children.forEach((child) => { if (child) node.appendChild(child); });
  }
  if (on) {
    for (const [event, handler] of Object.entries(on)) {
      node.addEventListener(event, handler);
    }
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function iconEl(faClass, extraStyle) {
  const i = document.createElement("i");
  i.className = faClass;
  if (extraStyle) i.setAttribute("style", extraStyle);
  return i;
}

// ===================== auth.js =====================
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function isTenantEmailAuthorized(email) {
  const cleanEmail = normalizeEmail(email);
  const q = query(
    collection(db, "authorizations"),
    where("email", "==", cleanEmail),
    where("status", "==", "active"),
    limit(1)
  );
  const snap = await getDocs(q);
  return !snap.empty;
}

let authFlowInFlight = false;

async function withAuthFlow(fn) {
  authFlowInFlight = true;
  try { return await fn(); }
  finally { authFlowInFlight = false; }
}

function buildUserProfile(user, role, name = "", phone = "") {
  return {
    name: name || (role === "owner" ? "Bailleur KAZA" : "Locataire KAZA"),
    email: normalizeEmail(user.email),
    phone: phone || "",
    role,
    createdAt: serverTimestamp(),
  };
}

async function registerUser({ role, name, email, phone, password }) {
  return withAuthFlow(async () => {
    const cleanEmail = normalizeEmail(email);
    if (role !== "owner" && role !== "tenant") {
      throw new Error("Type de compte invalide.");
    }
    const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
    const user = cred.user;

    if (role === "tenant") {
      const authorized = await isTenantEmailAuthorized(cleanEmail);
      if (!authorized) {
        await deleteUser(user).catch((e) =>
          console.error("Nettoyage du compte non autorisé impossible :", e)
        );
        throw new Error(
          "🛑 Accès refusé : votre adresse email n'est pas encore autorisée par un bailleur sur KAZA."
        );
      }
    }

    const profile = buildUserProfile(user, role, name, phone);
    try {
      await setDoc(doc(db, "users", user.uid), profile);
    } catch (err) {
      await deleteUser(user).catch((cleanupError) =>
        console.error("Nettoyage du compte incomplet impossible :", cleanupError)
      );
      throw err;
    }

    try {
      await sendEmailVerification(user);
    } catch (err) {
      await signOut(auth).catch(() => {});
      resetStateOnSignOut();
      throw new Error("Le compte a été créé, mais l'envoi du lien de vérification a échoué. Connectez-vous pour réessayer.");
    }
    await signOut(auth);
    resetStateOnSignOut();
    return { requiresEmailVerification: true };
  });
}

async function loginUser({ role, email, password }) {
  return withAuthFlow(async () => {
    if (role !== "owner" && role !== "tenant") {
      throw new Error("Choisissez un espace bailleur ou locataire avant de vous connecter.");
    }
    const cleanEmail = normalizeEmail(email);
    const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
    const user = cred.user;
    try {
      if (!user.emailVerified) {
        await sendEmailVerification(user).catch(() => {});
        throw new Error("Votre adresse e-mail n'est pas encore vérifiée. Nous vous avons renvoyé le lien de vérification.");
      }

      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists()) {
        throw new Error("Aucun profil KAZA n'est associé à ce compte. Inscrivez-vous avec le bon type de compte ou contactez le support.");
      }

      const profile = { uid: user.uid, ...snap.data() };
      if (profile.role !== "owner" && profile.role !== "tenant") {
        throw new Error("Le profil de ce compte est invalide. Contactez le support KAZA.");
      }
      if (profile.role !== role) {
        throw new Error(`Ce compte est enregistré comme ${profile.role === "owner" ? "bailleur" : "locataire"}. Choisissez l'espace correspondant.`);
      }

      state.currentUser = profile;
      return profile;
    } catch (err) {
      await signOut(auth).catch(() => {});
      resetStateOnSignOut();
      throw err;
    }
  });
}

async function loadUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) {
    throw new Error("Profil introuvable pour ce compte. Contactez le support KAZA.");
  }
  return { uid, ...snap.data() };
}

async function logoutUser() {
  await signOut(auth);
  resetStateOnSignOut();
}

function watchAuthState(onReady) {
  return onAuthStateChanged(auth, async (user) => {
    if (authFlowInFlight) return;
    if (!user) { resetStateOnSignOut(); onReady(null); return; }
    if (!user.emailVerified) {
      await signOut(auth).catch(() => {});
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


// ===================== authorizations.js =====================
async function authorizeTenantEmail(email) {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) {
    throw new Error("Veuillez saisir un email valide.");
  }
  if (state.currentUser?.role !== "owner") {
    throw new Error("Seul un bailleur peut autoriser un locataire.");
  }
  const authorizationRef = doc(db, "authorizations", cleanEmail);
  const authorization = await getDoc(authorizationRef);
  if (authorization.exists()) {
    await updateDoc(authorizationRef, {
      ownerIds: arrayUnion(state.currentUser.uid),
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(authorizationRef, {
      email: cleanEmail,
      ownerIds: [state.currentUser.uid],
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  return cleanEmail;
}
// ===================== apartments.js =====================
const MAX_PHOTOS = 7;
const MAX_ORIGINAL_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_COMPRESSED_IMAGE_BYTES = 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1800;

function safeImageUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function buildApartmentPayload(form, images) {
  const title = form.title.trim();
  const price = Number(form.price);
  if (!title || !price || !form.avenue.trim() || !form.streetNumber.trim() || !form.reference.trim()) {
    throw new Error("Merci de remplir tous les détails obligatoires (Titre, Avenue, N°, Référence, Prix).");
  }
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Le prix du loyer doit être un nombre positif.");
  }
  if (images.length === 0) {
    throw new Error("Merci de sélectionner au moins une photo du logement.");
  }
  if (images.length > MAX_PHOTOS || images.some((url) => !safeImageUrl(url))) {
    throw new Error("Les photos sélectionnées ne sont pas valides. Choisissez jusqu'à 7 images.");
  }
  return {
    title, type: form.type, commune: form.commune,
    avenue: form.avenue.trim(),
    streetNumber: form.streetNumber.trim(),
    door: form.door ? form.door.trim() : null,
    reference: form.reference.trim(),
    price,
    specs: form.specs?.trim() || "Non spécifié",
    imageUrl: images[0], images,
    status: "Disponible",
    ownerId: state.currentUser.uid,
    ownerName: state.currentUser.name,
    tenantId: null, tenantName: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Le navigateur n'a pas pu réduire cette image."));
    }, type, quality);
  });
}

async function decodeImageFile(file) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() };
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw err;
  }
}

async function compressImageFile(file) {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} n'est pas une image valide.`);
  if (file.size > MAX_ORIGINAL_IMAGE_BYTES) {
    throw new Error(`${file.name} dépasse la limite de 20 Mo avant compression.`);
  }

  let decoded;
  try {
    decoded = await decodeImageFile(file);
    const firstScale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(decoded.width, decoded.height));
    let width = Math.max(1, Math.round(decoded.width * firstScale));
    let height = Math.max(1, Math.round(decoded.height * firstScale));
    const canvas = document.createElement("canvas");
    let bestBlob = null;

    for (let resizeAttempt = 0; resizeAttempt < 5; resizeAttempt += 1) {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("La compression d'image n'est pas disponible dans ce navigateur.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(decoded.source, 0, 0, width, height);

      for (const type of ["image/webp", "image/jpeg"]) {
        for (const quality of [0.82, 0.72, 0.62, 0.52]) {
          const blob = await canvasToBlob(canvas, type, quality);
          if (blob.type !== type) continue;
          if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
          if (blob.size <= MAX_COMPRESSED_IMAGE_BYTES) return blob;
        }
      }

      if (Math.max(width, height) <= 640) break;
      width = Math.max(1, Math.round(width * 0.78));
      height = Math.max(1, Math.round(height * 0.78));
    }

    if (!bestBlob || bestBlob.size > MAX_COMPRESSED_IMAGE_BYTES) {
      throw new Error(`Impossible de réduire ${file.name} sous 1 Mo. Choisissez une image plus petite.`);
    }
    return bestBlob;
  } catch (err) {
    throw new Error(`Compression impossible pour ${file.name} : ${err.message || "format non pris en charge"}`);
  } finally {
    decoded?.cleanup();
  }
}

async function createApartment(form, onProgress = () => {}) {
  if (state.currentUser?.role !== "owner") throw new Error("Seul un bailleur peut publier un bien.");
  const photos = Array.from(form.photos || []);
  if (photos.length < 1 || photos.length > MAX_PHOTOS) {
    throw new Error("Sélectionnez de 1 à 7 photos pour publier le logement.");
  }

  const apartmentRef = doc(collection(db, "apartments"));
  const uploadedFiles = [];
  try {
    const images = [];
    for (let index = 0; index < photos.length; index += 1) {
      onProgress(`Compression de la photo ${index + 1}/${photos.length}…`);
      const blob = await compressImageFile(photos[index]);
      const path = `apartments/${state.currentUser.uid}/${apartmentRef.id}/photo-${index + 1}`;
      const objectRef = storageRef(storage, path);
      onProgress(`Envoi de la photo ${index + 1}/${photos.length} (${(blob.size / 1024).toFixed(0)} Ko)…`);
      await uploadBytes(objectRef, blob, {
        contentType: blob.type || "image/jpeg",
        cacheControl: "public,max-age=31536000",
      });
      uploadedFiles.push(path);
      images.push(await getDownloadURL(objectRef));
    }

    onProgress("Enregistrement de l'annonce…");
    await setDoc(apartmentRef, buildApartmentPayload(form, images));
  } catch (err) {
    await Promise.allSettled(uploadedFiles.map((path) => deleteObject(storageRef(storage, path))));
    throw err;
  }
}

async function deleteApartment(apartmentId) {
  if (state.currentUser?.role !== "owner") throw new Error("Seul un bailleur peut supprimer un bien.");
  const apartmentRef = doc(db, "apartments", apartmentId);
  const snap = await getDoc(apartmentRef);
  if (!snap.exists()) return;
  const apartment = snap.data();
  if (apartment.ownerId !== state.currentUser.uid || apartment.tenantId) {
    throw new Error("Seul le bailleur peut supprimer son logement lorsqu'il n'est pas loué.");
  }
  await deleteDoc(apartmentRef);
  const imagePaths = Array.from({ length: MAX_PHOTOS }, (_, index) =>
    `apartments/${state.currentUser.uid}/${apartmentId}/photo-${index + 1}`
  );
  await Promise.allSettled(imagePaths.map((path) => deleteObject(storageRef(storage, path))));
}

function watchOwnerApartments(ownerId, callback) {
  const q = query(
    collection(db, "apartments"),
    where("ownerId", "==", ownerId),
    orderBy("createdAt", "desc")
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

function watchCatalog(callback) {
  let availableApartments = [];
  let tenantApartments = [];
  let availableReady = false;
  let tenantReady = state.currentUser.role !== "tenant";

  function publishCatalog() {
    if (!availableReady || !tenantReady) return;
    const combined = new Map();
    [...availableApartments, ...tenantApartments].forEach((apartment) => {
      combined.set(apartment.id, apartment);
    });
    const sorted = [...combined.values()].sort((left, right) =>
      (right.createdAt?.seconds || 0) - (left.createdAt?.seconds || 0)
    );
    callback(sorted);
  }

  const availableQuery = query(
    collection(db, "apartments"),
    where("status", "==", "Disponible")
  );
  const unsubscribeAvailable = onSnapshot(availableQuery, (snap) => {
    availableApartments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    availableReady = true;
    publishCatalog();
  }, (err) => console.error("Catalogue KAZA indisponible :", err));

  let unsubscribeTenant = () => {};
  if (state.currentUser.role === "tenant") {
    const tenantQuery = query(
      collection(db, "apartments"),
      where("tenantId", "==", state.currentUser.uid)
    );
    unsubscribeTenant = onSnapshot(tenantQuery, (snap) => {
      tenantApartments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      tenantReady = true;
      publishCatalog();
    }, (err) => console.error("Logements du locataire indisponibles :", err));
  }

  return () => {
    unsubscribeAvailable();
    unsubscribeTenant();
  };
}

function filterCatalog(apartments) {
  const normalizedSearch = String(state.searchQuery || "").trim().toLowerCase();
  const { filterType, filterCommune } = state;
  return apartments.filter((item) => {
    const matchesSearch = String(item.title || "").toLowerCase().includes(normalizedSearch);
    const matchesType = filterType === "Tous" || item.type === filterType;
    const matchesCommune = filterCommune === "Toutes" || item.commune === filterCommune;
    return matchesSearch && matchesType && matchesCommune;
  });
}


// ===================== leases.js =====================
async function rentApartment(apartmentId) {
  const apartmentRef = doc(db, "apartments", apartmentId);
  const leaseRef = doc(collection(db, "leases"));
  const tenant = state.currentUser;
  let ownerId;
  let ownerName;
  let apartmentTitle;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(apartmentRef);
    if (!snap.exists()) throw new Error("Ce logement n'existe plus.");
    const data = snap.data();
    if (data.status === "Occupé") {
      throw new Error("Trop tard : ce logement vient d'être loué par quelqu'un d'autre.");
    }
    ownerId = data.ownerId;
    ownerName = data.ownerName || "";
    apartmentTitle = data.title || "";
    tx.update(apartmentRef, {
      status: "Occupé",
      tenantId: tenant.uid, tenantName: tenant.name,
      paymentStatus: "en_attente",
      updatedAt: serverTimestamp(),
    });
    tx.set(leaseRef, {
      apartmentId, ownerId,
      tenantId: tenant.uid, tenantName: tenant.name,
      tenantPhone: tenant.phone || "",
      status: "active", paymentStatus: "en_attente",
      startDate: serverTimestamp(), endDate: null,
    });
  });

  const chatId = await getOrCreateChat({ ownerId, ownerName, apartmentId, apartmentTitle });
  await postSystemMessage(
    chatId,
    `🚨 NOTIFICATION : Le locataire ${tenant.name} (${tenant.phone || "pas de numéro"}) demande à louer votre résidence.`
  );
  return leaseRef.id;
}
async function leaveApartment(apartmentId) {
  const apartmentRef = doc(db, "apartments", apartmentId);
  const tenant = state.currentUser;
  const activeLease = await getActiveLease(apartmentId, tenant.uid);
  if (!activeLease) {
    throw new Error("Le contrat actif de ce logement est introuvable. Contactez le bailleur.");
  }
  const leaseRef = doc(db, "leases", activeLease.id);
  let ownerId; let ownerName; let apartmentTitle;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(apartmentRef);
    const leaseSnap = await tx.get(leaseRef);
    if (!snap.exists()) throw new Error("Ce logement n'existe plus.");
    if (!leaseSnap.exists() || leaseSnap.data().status !== "active") {
      throw new Error("Le contrat de location n'est plus actif.");
    }
    const data = snap.data();
    if (data.tenantId !== tenant.uid) {
      throw new Error("Vous n'êtes pas le locataire actuel de ce bien.");
    }
    if (leaseSnap.data().tenantId !== tenant.uid || leaseSnap.data().apartmentId !== apartmentId) {
      throw new Error("Le contrat ne correspond pas à ce logement.");
    }
    ownerId = data.ownerId;
    ownerName = data.ownerName || "";
    apartmentTitle = data.title || "";
    tx.update(apartmentRef, {
      status: "Disponible", tenantId: null, tenantName: null,
      paymentStatus: null, updatedAt: serverTimestamp(),
    });
    tx.update(leaseRef, {
      status: "ended", endDate: serverTimestamp(),
    });
  });

  const chatId = await getOrCreateChat({ ownerId, ownerName, apartmentId, apartmentTitle });
  await postSystemMessage(
    chatId,
    `📭 NOTIFICATION DE DÉPART : Le locataire ${tenant.name} a libéré votre résidence.`
  );
  return activeLease.id;
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


// ===================== payments.js =====================
async function findActiveLease(apartmentId) {
  const { role, uid } = state.currentUser;
  const partyField = role === "owner" ? "ownerId" : "tenantId";
  const q = query(
    collection(db, "leases"),
    where("apartmentId", "==", apartmentId),
    where(partyField, "==", uid),
    where("status", "==", "active")
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

async function notifyPayment(apartment, paymentDetails = {}) {
  if (state.currentUser?.role !== "tenant") throw new Error("Seul un locataire peut déclarer un paiement.");
  const lease = await findActiveLease(apartment.id);
  if (!lease) throw new Error("Aucun contrat actif trouvé pour ce logement.");
  let proofPath = null;
  if (paymentDetails.proofFile) {
    const proofBlob = await compressImageFile(paymentDetails.proofFile);
    proofPath = `payment-proofs/${lease.id}/${state.currentUser.uid}/proof-${Date.now()}`;
    await uploadBytes(storageRef(storage, proofPath), proofBlob, {
      contentType: proofBlob.type || "image/jpeg",
      cacheControl: "private,max-age=3600",
    });
  }
  const apartmentRef = doc(db, "apartments", apartment.id);
  const leaseRef = doc(db, "leases", lease.id);
  try {
    await runTransaction(db, async (tx) => {
      const apartmentSnap = await tx.get(apartmentRef);
      const leaseSnap = await tx.get(leaseRef);
      if (!apartmentSnap.exists() || !leaseSnap.exists()) {
        throw new Error("Le contrat ou le logement n'existe plus.");
      }
      if (apartmentSnap.data().status !== "Occupé"
        || apartmentSnap.data().tenantId !== state.currentUser.uid
        || leaseSnap.data().apartmentId !== apartment.id
        || leaseSnap.data().tenantId !== state.currentUser.uid
        || leaseSnap.data().status !== "active") {
        throw new Error("Ce contrat n'est pas associé à votre compte.");
      }
      tx.update(apartmentRef, { paymentStatus: "signale", updatedAt: serverTimestamp() });
      tx.update(leaseRef, { paymentStatus: "signale" });
    });
  } catch (err) {
    if (proofPath) await deleteObject(storageRef(storage, proofPath)).catch(() => {});
    throw err;
  }
  const chatId = await getOrCreateChat({
    ownerId: apartment.ownerId, ownerName: apartment.ownerName,
    apartmentId: apartment.id, apartmentTitle: apartment.title,
  });
  const paymentMessage = [
    `💰 PREUVE DE PAIEMENT — ${state.currentUser.name}`,
    `Logement : ${apartment.title || "Logement"}`,
    `Montant déclaré : ${apartment.price} $`,
    paymentDetails.method ? `Moyen : ${paymentDetails.method}` : "",
    paymentDetails.date ? `Date : ${paymentDetails.date}` : "",
    paymentDetails.reference ? `Référence / preuve : ${paymentDetails.reference}` : "",
    paymentDetails.details ? `Détails : ${paymentDetails.details}` : "",
    proofPath ? `Pièce jointe KAZA : ${proofPath}` : "",
    "Déclaration non vérifiée : le bailleur doit confirmer la réception des fonds.",
  ].filter(Boolean).join("\n").slice(0, 2000);
  await postSystemMessage(chatId, paymentMessage);
}

async function confirmTenantPayment(apartment) {
  const lease = await findActiveLease(apartment.id);
  if (!lease) throw new Error("Aucun contrat actif trouvé pour ce logement.");
  const apartmentRef = doc(db, "apartments", apartment.id);
  const leaseRef = doc(db, "leases", lease.id);
  await runTransaction(db, async (tx) => {
    const apartmentSnap = await tx.get(apartmentRef);
    const leaseSnap = await tx.get(leaseRef);
    if (!apartmentSnap.exists() || !leaseSnap.exists()) {
      throw new Error("Le contrat ou le logement n'existe plus.");
    }
    if (apartmentSnap.data().status !== "Occupé"
      || apartmentSnap.data().ownerId !== state.currentUser.uid
      || apartmentSnap.data().tenantId !== leaseSnap.data().tenantId
      || leaseSnap.data().apartmentId !== apartment.id
      || leaseSnap.data().ownerId !== state.currentUser.uid
      || leaseSnap.data().status !== "active") {
      throw new Error("Ce contrat n'est pas associé à votre compte.");
    }
    tx.update(apartmentRef, { paymentStatus: "confirme", updatedAt: serverTimestamp() });
    tx.update(leaseRef, { paymentStatus: "confirme" });
  });
  const tenantId = lease.tenantId;
  if (!tenantId) {
    throw new Error("Aucun locataire actif n'est associé à ce logement.");
  }
  const chatId = buildChatId(apartment.ownerId, tenantId);
  await postSystemMessage(
    chatId,
    "✅ PAIEMENT CONFIRMÉ : le bailleur a validé la réception du loyer pour ce mois."
  );
}


// ===================== ratings.js (NOUVEAU : /10) =====================
const RATING_MIN = 1;
const RATING_MAX = 10;

const RATING_CRITERIA = [
  { key: "capacitePaiement", label: "Capacité / régularité de paiement" },
  { key: "ponctualite", label: "Paiement des loyers à temps" },
  { key: "entretien", label: "Entretien et maintien du logement" },
  { key: "etatSortie", label: "État des lieux de sortie" },
  { key: "communication", label: "Communication avec le bailleur" },
  { key: "respectReglement", label: "Respect du règlement intérieur" },
  { key: "respectVoisinage", label: "Respect du voisinage" },
  { key: "fiabilite", label: "Fiabilité générale" },
];

async function getEndedLeasesToRate(ownerId) {
  const q = query(
    collection(db, "leases"),
    where("ownerId", "==", ownerId),
    where("status", "==", "ended")
  );
  const snap = await getDocs(q);
  const leases = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const ratedLeaseIds = new Set();
  for (let i = 0; i < leases.length; i += 30) {
    const ratingSnaps = await Promise.all(
      leases.slice(i, i + 30).map((lease) => getDoc(doc(db, "ratings", lease.id)))
    );
    ratingSnaps.forEach((rating) => {
      if (rating.exists()) ratedLeaseIds.add(rating.id);
    });
  }
  return leases.filter((lease) => !ratedLeaseIds.has(lease.id));
}
async function submitRating(lease, scores, comment) {
  const sanitized = {};
  RATING_CRITERIA.forEach((c) => {
    const v = Number(scores[c.key]);
    const safe = Number.isFinite(v) ? Math.min(RATING_MAX, Math.max(RATING_MIN, Math.round(v))) : RATING_MIN;
    sanitized[c.key] = safe;
  });
  const values = RATING_CRITERIA.map((c) => sanitized[c.key]);
  const average = values.reduce((s, v) => s + v, 0) / RATING_CRITERIA.length;

  await setDoc(doc(db, "ratings", lease.id), {
    leaseId: lease.id,
    ownerId: state.currentUser.uid,
    ownerName: state.currentUser.name || "Bailleur",
    tenantId: lease.tenantId,
    tenantName: lease.tenantName || "",
    apartmentId: lease.apartmentId,
    scores: sanitized,
    average: Math.round(average * 10) / 10,
    max: RATING_MAX,
    comment: (comment || "").trim().slice(0, 1000),
    status: "published",
    createdAt: serverTimestamp(),
  });
}

async function getTenantRatings(tenantId) {
  const q = query(
    collection(db, "ratings"),
    where("tenantId", "==", tenantId),
    where("status", "==", "published")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function getTenantRatingSummary(tenantId) {
  const ratings = await getTenantRatings(tenantId);
  if (ratings.length === 0) return { count: 0, average: null, criteria: {} };

  const total = ratings.reduce((s, r) => s + Number(r.average || 0), 0);
  const criteria = {};
  RATING_CRITERIA.forEach((c) => {
    const vals = ratings
      .map((r) => Number(r.scores?.[c.key] || 0))
      .filter((v) => v > 0);
    criteria[c.key] = vals.length
      ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10
      : 0;
  });
  return {
    count: ratings.length,
    average: Math.round((total / ratings.length) * 10) / 10,
    criteria,
  };
}

async function getRatingForLease(leaseId) {
  const snap = await getDoc(doc(db, "ratings", leaseId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}


// ===================== chat.js =====================
function buildChatId(ownerId, tenantId) {
  return `${tenantId}_${ownerId}`;
}

async function getOrCreateChat({ ownerId, apartmentId, ownerName, apartmentTitle }) {
  const tenant = state.currentUser;
  const chatId = buildChatId(ownerId, tenant.uid);
  const chatRef = doc(db, "chats", chatId);
  const snap = await getDoc(chatRef);

  if (!snap.exists()) {
    await setDoc(chatRef, {
      participantIds: [ownerId, tenant.uid],
      ownerId, ownerName: ownerName || "",
      tenantId: tenant.uid, tenantName: tenant.name,
      apartmentId: apartmentId || null,
      context: apartmentTitle || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  return chatId;
}

async function postSystemMessage(chatId, text) {
  await addDoc(collection(db, "chats", chatId, "messages"), {
    senderId: state.currentUser.uid, text, createdAt: serverTimestamp(),
  });
}

async function sendMessage(chatId, text) {
  const clean = text.trim();
  if (!clean) return;
  if (clean.length > 2000) throw new Error("Message trop long (2000 caractères maximum).");
  await addDoc(collection(db, "chats", chatId, "messages"), {
    senderId: state.currentUser.uid, text: clean, createdAt: serverTimestamp(),
  });
}

async function broadcastToAllTenants(text) {
  const owner = state.currentUser;
  const broadcastText = ("[Diffusion Groupée] : " + String(text).trim()).slice(0, 2000);
  const q = query(collection(db, "chats"), where("ownerId", "==", owner.uid));
  const snap = await getDocs(q);
  const chats = snap.docs;
  for (let i = 0; i < chats.length; i += 8) {
    const batch = writeBatch(db);
    chats.slice(i, i + 8).forEach((chatDoc) => {
      const messageRef = doc(collection(db, "chats", chatDoc.id, "messages"));
      batch.set(messageRef, {
        senderId: owner.uid,
        text: broadcastText,
        createdAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }
  return chats.length;
}

function watchMyChats(callback) {
  const { role, uid } = state.currentUser;
  const field = role === "owner" ? "ownerId" : "tenantId";
  const q = query(collection(db, "chats"), where(field, "==", uid));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

function watchMessages(chatId, callback) {
  const q = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("createdAt", "asc")
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}


// ===================== notifications.js =====================
const VAPID_KEY = "VAPID_KEY_A_CONFIGURER";

async function requestNotificationPermission() {
  if (!VAPID_KEY || VAPID_KEY === "VAPID_KEY_A_CONFIGURER") return null;
  if (!("Notification" in window)) return null;
  const messagingContext = await getMessagingIfSupported();
  if (!messagingContext) return null;
  const { messaging, getToken } = messagingContext;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  try {
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (!token) return null;
    await setDoc(
      doc(db, "users", state.currentUser.uid, "notificationTokens", token.slice(0, 100)),
      { token, platform: navigator.platform || "web", createdAt: serverTimestamp() }
    );
    return token;
  } catch (err) {
    console.error("Impossible d'obtenir le token FCM :", err);
    return null;
  }
}
// ===================== ui.js =====================
let unsubApartments = null;
let unsubChats = null;

function changeView(screenId) {
  document.querySelectorAll(".screen-view").forEach((v) => v.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
}

function showError(err) {
  const message = err?.message || "Une erreur est survenue.";
  alert(message);
  console.error(err);
}

function initRoleSelection() {
  document.getElementById("role-card-owner").addEventListener("click", () => openAuthScreen("owner"));
  document.getElementById("role-card-tenant").addEventListener("click", () => openAuthScreen("tenant"));
}

function openAuthScreen(role) {
  state.pendingRole = role;
  state.authMode = "login";
  document.getElementById("container-auth-name").style.display = "none";
  document.getElementById("container-auth-phone").style.display = "none";
  document.getElementById("auth-title").textContent = "Connexion " + (role === "owner" ? "Bailleur" : "Locataire");
  document.getElementById("auth-subtitle").textContent = "Entrez vos accès pour piloter votre espace KAZA.";
  document.getElementById("btn-auth-submit").className =
    "btn-submit-form " + (role === "owner" ? "owner-theme" : "tenant-theme");
  document.getElementById("auth-toggle-mode-link").textContent = "Pas encore de compte ? S'inscrire";
  document.getElementById("auth-name").value = "";
  document.getElementById("auth-email").value = "";
  document.getElementById("auth-phone").value = "";
  document.getElementById("auth-password").value = "";
  changeView("scr-auth");
}

function toggleAuthMode() {
  const isLogin = state.authMode === "login";
  state.authMode = isLogin ? "register" : "login";
  const roleLabel = state.pendingRole === "owner" ? "Bailleur" : "Locataire";
  document.getElementById("auth-title").textContent = (isLogin ? "Inscription " : "Connexion ") + roleLabel;
  document.getElementById("container-auth-name").style.display = isLogin ? "block" : "none";
  document.getElementById("container-auth-phone").style.display = isLogin ? "block" : "none";
  document.getElementById("auth-toggle-mode-link").textContent =
    isLogin ? "Déjà inscrit ? Se connecter" : "Pas encore de compte ? S'inscrire";
}

async function submitAuthForm() {
  const name = document.getElementById("auth-name").value.trim();
  const email = document.getElementById("auth-email").value.trim().toLowerCase();
  const phone = document.getElementById("auth-phone").value.trim();
  const password = document.getElementById("auth-password").value;

  if (!email || !password) { alert("Veuillez saisir votre email et votre mot de passe."); return; }
  if (password.length < 6) { alert("Le mot de passe doit contenir au moins 6 caractères."); return; }

  const submitBtn = document.getElementById("btn-auth-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = "Veuillez patienter…";

  try {
    if (state.authMode === "register") {
      const result = await registerUser({ role: state.pendingRole, name, email, phone, password });
      if (result?.requiresEmailVerification) {
        toggleAuthMode();
        alert("Compte créé. Vérifiez le lien envoyé par e-mail, puis connectez-vous avec le même profil.");
      }
    } else {
      const profile = await loginUser({ role: state.pendingRole, email, password });
      enterAppForUser(profile, state.pendingRole);
    }
  } catch (err) { showError(err); }
  finally { submitBtn.disabled = false; submitBtn.textContent = "Continuer"; }
}

function initAuthScreen() {
  document.getElementById("btn-back-role").addEventListener("click", () => changeView("scr-role-select"));
  document.getElementById("btn-auth-submit").addEventListener("click", submitAuthForm);
  document.getElementById("auth-toggle-mode-link").addEventListener("click", toggleAuthMode);
}

function enterAppForUser(profile, expectedRole = null) {
  if (unsubApartments) unsubApartments();
  if (unsubChats) unsubChats();

  if (!profile || (profile.role !== "owner" && profile.role !== "tenant")) {
    throw new Error("Profil KAZA invalide. Reconnectez-vous ou contactez le support.");
  }
  if (expectedRole && profile.role !== expectedRole) {
    signOut(auth).catch(() => {});
    resetStateOnSignOut();
    changeView("scr-role-select");
    showError(new Error("Le compte connecté ne correspond pas à l'espace choisi. Vous avez été déconnecté."));
    return;
  }

  if (profile.role === "owner") {
    document.getElementById("owner-profile-display").textContent = profile.name;
    changeView("scr-owner-dashboard");
    activateOwnerTab("home");
  } else {
    document.getElementById("tenant-profile-display").textContent = profile.name;
    changeView("scr-tenant-dashboard");
    activateTenantTab("discover");
  }
  requestNotificationPermission().catch(() => {});
}

function exitAppToRoleSelect() {
  if (unsubApartments) unsubApartments();
  if (unsubChats) unsubChats();
  changeView("scr-role-select");
}

function ratingColor(average) {
  if (average >= 8) return "#10b981";
  if (average >= 6.5) return "#f59e0b";
  if (average >= 4) return "#f97316";
  return "#e74c3c";
}

function ratingLabel(average) {
  if (average >= 9) return "Locataire d'exception";
  if (average >= 8) return "Très bon locataire";
  if (average >= 6.5) return "Bon locataire";
  if (average >= 5) return "Locataire correct";
  if (average >= 3) return "Locataire à surveiller";
  return "Locataire à risque";
}

function buildRatingSummaryCard(summary, title = "Ma réputation locative") {
  const card = el("div", { className: "rating-summary-card" });

  if (!summary || summary.count === 0) {
    card.appendChild(el("div", {
      className: "rating-summary-header",
      children: [
        el("div", {
          className: "rating-average-circle",
          attrs: { style: "background:#94a3b8;" },
          children: [
            el("span", { className: "rating-average-value", text: "—" }),
            el("span", { className: "rating-average-max", text: `/ ${RATING_MAX}` }),
          ],
        }),
        el("div", { children: [
          el("div", { className: "rating-label", text: title }),
          el("div", { className: "rating-label-sub", text: "Aucune évaluation reçue pour le moment." }),
        ]}),
      ],
    }));
    return card;
  }

  const avg = summary.average;
  const color = ratingColor(avg);

  card.appendChild(el("div", {
    className: "rating-summary-header",
    children: [
      el("div", {
        className: "rating-average-circle",
        attrs: { style: `background:${color};` },
        children: [
          el("span", { className: "rating-average-value", text: avg.toFixed(1) }),
          el("span", { className: "rating-average-max", text: `/ ${RATING_MAX}` }),
        ],
      }),
      el("div", { children: [
        el("div", { className: "rating-label", text: title }),
        el("div", { className: "rating-label-sub", text: ratingLabel(avg) }),
        el("div", { className: "rating-label-sub", text: `${summary.count} évaluation${summary.count > 1 ? "s" : ""} reçue${summary.count > 1 ? "s" : ""}` }),
      ]}),
    ],
  }));

  const list = el("div", { className: "rating-criteria-list" });
  RATING_CRITERIA.forEach((c) => {
    const v = summary.criteria[c.key] || 0;
    const pct = Math.max(0, Math.min(100, (v / RATING_MAX) * 100));
    list.appendChild(el("div", {
      className: "rating-criterion-row",
      children: [
        el("div", { className: "rating-criterion-head", children: [
          el("span", { text: c.label }),
          el("span", { className: "rating-criterion-score", text: `${v.toFixed(1)} / ${RATING_MAX}` }),
        ]}),
        el("div", { className: "rating-criterion-bar", children: [
          el("div", { className: "rating-criterion-bar-fill",
            attrs: { style: `width:${pct}%; background:${ratingColor(v)};` } }),
        ]}),
      ],
    }));
  });
  card.appendChild(list);
  return card;
}

function buildRatingBadgeMini(average) {
  if (average === null || average === undefined) return null;
  return el("span", {
    className: "rating-badge-mini",
    attrs: { style: `background:${ratingColor(average)};` },
    children: [
      iconEl("fa-solid fa-star"),
      document.createTextNode(` ${average.toFixed(1)}/${RATING_MAX}`),
    ],
  });
}

function initOwnerDashboard() {
  document.getElementById("nav-tab-owner-home").addEventListener("click", () => activateOwnerTab("home"));
  document.getElementById("nav-tab-owner-apparts").addEventListener("click", () => activateOwnerTab("apparts"));
  document.getElementById("nav-tab-owner-tenants").addEventListener("click", () => activateOwnerTab("tenants"));
  document.getElementById("nav-tab-owner-chats").addEventListener("click", () => activateOwnerTab("chats"));
  document.querySelectorAll('#scr-owner-dashboard [data-action="theme"]')
    .forEach((b) => b.addEventListener("click", toggleAppTheme));
  document.querySelectorAll('#scr-owner-dashboard [data-action="logout"]')
    .forEach((b) => b.addEventListener("click", () => logoutUser()));
}

function activateOwnerTab(tabName) {
  document.querySelectorAll("#scr-owner-dashboard .tab-navigation-item")
    .forEach((t) => t.classList.remove("active"));
  document.getElementById(`nav-tab-owner-${tabName}`).classList.add("active");

  const container = document.getElementById("owner-tab-injector");
  clear(container);

  if (unsubApartments) unsubApartments();
  unsubApartments = watchOwnerApartments(state.currentUser.uid, (apartments) => {
    state.apartments = apartments;
    if (tabName === "home") renderOwnerHome(container, apartments);
    if (tabName === "apparts") renderOwnerApartments(container, apartments);
    if (tabName === "tenants") renderOwnerTenants(container, apartments);
  });

  if (tabName === "chats") renderChatList(container);
}

async function renderOwnerHome(container, apartments) {
  clear(container);

  container.appendChild(el("button", {
    className: "btn-action-trigger owner-publish-cta",
    children: [iconEl("fa-solid fa-plus"), document.createTextNode(" Publier un bien")],
    on: { click: () => changeView("scr-add-appart") },
  }));

  const statsRow = el("div", { className: "stats-grid-row" });
  statsRow.appendChild(kpiCard("fa-solid fa-building", "Vos Biens", apartments.length, "blue-indicator"));
  statsRow.appendChild(kpiCard("fa-solid fa-user-check", "Actifs",
    apartments.filter((a) => a.status === "Occupé").length, "green-indicator"));
  container.appendChild(statsRow);

  const revenueTotal = apartments.reduce(
    (acc, curr) => acc + (curr.status === "Occupé" ? Number(curr.price || 0) : 0), 0
  );
  container.appendChild(el("div", {
    className: "revenue-box",
    children: [
      el("div", { children: [
        el("h4", { text: "Revenus Estimés" }),
        el("p", { text: "Cumul de vos loyers occupés" }),
      ]}),
      el("strong", { text: `${revenueTotal} $` }),
    ],
  }));

  const authBox = el("div", { className: "surface-box" });
  authBox.appendChild(el("h4", {
    children: [
      iconEl("fa-solid fa-user-shield", "color:var(--primary)"),
      document.createTextNode(" Autoriser un locataire"),
    ],
  }));
  authBox.appendChild(el("p", {
    className: "muted-text",
    text: "Inscrivez l'email de votre locataire pour lui permettre de s'inscrire sur KAZA.",
  }));
  const emailInput = el("input", { attrs: { type: "email", placeholder: "Ex: locataire@gmail.com" } });
  authBox.appendChild(el("div", {
    className: "inline-form-row",
    children: [
      emailInput,
      el("button", {
        className: "btn-action-trigger",
        children: [iconEl("fa-solid fa-plus")],
        on: { click: async () => {
          try {
            const email = await authorizeTenantEmail(emailInput.value);
            alert(`✅ Succès : le locataire [ ${email} ] peut désormais s'inscrire.`);
            emailInput.value = "";
          } catch (err) { showError(err); }
        }},
      }),
    ],
  }));
  container.appendChild(authBox);

  apartments.filter((ap) => ap.paymentStatus === "signale").forEach((ap) => {
    container.appendChild(el("div", {
      className: "pending-payment-box",
      children: [
        el("span", { children: [
          el("strong", { text: ap.tenantName || "Locataire" }),
          document.createTextNode(" signale avoir payé pour : "),
          el("br"),
          el("em", { text: ap.title }),
        ]}),
        el("button", {
          className: "btn-action-trigger confirm-btn",
          text: "Confirmer",
          on: { click: async (e) => {
            e.target.disabled = true;
            try {
              await confirmTenantPayment(ap);
              alert("Paiement validé. Reçu transmis au locataire.");
            } catch (err) { showError(err); }
            finally { e.target.disabled = false; }
          }},
        }),
      ],
    }));
  });

  const toRate = await getEndedLeasesToRate(state.currentUser.uid).catch(() => []);
  if (toRate.length > 0) {
    const ratingBox = el("div", { className: "surface-box" });
    ratingBox.appendChild(el("h4", {
      children: [
        iconEl("fa-solid fa-star", "color:var(--primary)"),
        document.createTextNode(" Locataires à évaluer"),
      ],
    }));
    ratingBox.appendChild(el("p", {
      className: "muted-text",
      text: "Ces locataires ont quitté vos biens. Notez-les sur 10 pour bâtir la confiance de la communauté KAZA.",
    }));
    toRate.forEach((lease) => {
      ratingBox.appendChild(el("div", {
        className: "inline-form-row",
        children: [
          el("span", { text: lease.tenantName || "Locataire" }),
          el("button", {
            className: "btn-action-trigger",
            children: [iconEl("fa-solid fa-star"), document.createTextNode(" Évaluer /10")],
            on: { click: () => openRatingModal(lease) },
          }),
        ],
      }));
    });
    container.appendChild(ratingBox);
  }
}

function kpiCard(iconClass, label, value, colorClass) {
  return el("div", {
    className: `stats-kpi-card ${colorClass}`,
    children: [
      el("div", { className: "stats-kpi-header",
        children: [iconEl(iconClass), document.createTextNode(" " + label)] }),
      el("div", { className: "stats-kpi-number", text: String(value) }),
    ],
  });
}

function renderOwnerApartments(container, apartments) {
  clear(container);
  container.appendChild(el("div", {
    className: "action-context-bar",
    children: [
      el("span", { className: "context-title", text: "Vos Annonces" }),
      el("button", {
        className: "btn-action-trigger",
        children: [iconEl("fa-solid fa-plus"), document.createTextNode(" Ajouter")],
        on: { click: () => changeView("scr-add-appart") },
      }),
    ],
  }));

  if (apartments.length === 0) {
    container.appendChild(blankSlate("fa-solid fa-folder-open", "Aucun bien publié."));
    return;
  }
  apartments.forEach((item) => container.appendChild(buildApartmentCard(item, { mode: "owner" })));
}

async function renderOwnerTenants(container, apartments) {
  clear(container);
  container.appendChild(el("div", {
    className: "action-context-bar",
    children: [
      el("span", { className: "context-title", text: "Locataires actifs" }),
      el("button", {
        className: "btn-action-trigger",
        children: [iconEl("fa-solid fa-comments"), document.createTextNode(" Messages")],
        on: { click: () => activateOwnerTab("chats") },
      }),
    ],
  }));

  const occupied = apartments.filter((apartment) =>
    apartment.status === "Occupé" && typeof apartment.tenantId === "string"
  );

  if (occupied.length === 0) {
    container.appendChild(blankSlate("fa-solid fa-users", "Aucun locataire actif pour le moment."));
    container.appendChild(el("p", {
      className: "muted-text",
      text: "Quand un locataire louera l'un de vos biens, ses informations et le suivi du loyer apparaîtront ici.",
    }));
  } else occupied.forEach((apartment) => {
    const paymentLabel = apartment.paymentStatus === "signale"
      ? "Paiement signalé : à confirmer"
      : apartment.paymentStatus === "confirme"
        ? "Dernier paiement confirmé"
        : "En attente de déclaration du loyer";
    const card = el("div", {
      className: "surface-box tenant-management-card",
      children: [
        el("h4", { text: apartment.tenantName || "Locataire" }),
        el("p", { text: apartment.title || "Logement" }),
        el("p", { text: `${fullAddress(apartment)} · ${apartment.price} $ / mois` }),
        el("p", { className: "muted-strong", text: paymentLabel }),
      ],
    });
    const actions = el("div", { className: "tenant-management-actions" });

    if (apartment.paymentStatus === "signale") {
      actions.appendChild(el("button", {
        className: "btn-action-trigger confirm-btn",
        text: "Confirmer le paiement",
        on: { click: async (event) => {
          event.currentTarget.disabled = true;
          try {
            await confirmTenantPayment(apartment);
            alert("Paiement confirmé.");
          } catch (err) {
            showError(err);
          } finally {
            event.currentTarget.disabled = false;
          }
        }},
      }));
    }

    actions.appendChild(el("button", {
      className: "btn-action-trigger",
      children: [iconEl("fa-solid fa-comments"), document.createTextNode(" Ouvrir les messages")],
      on: { click: () => activateOwnerTab("chats") },
    }));
    card.appendChild(actions);
    container.appendChild(card);
  });

  const endedLeases = await getEndedLeasesToRate(state.currentUser.uid).catch(() => []);
  if (state.currentUser?.role !== "owner"
    || !document.getElementById("nav-tab-owner-tenants").classList.contains("active")) return;
  const ratingBox = el("div", { className: "surface-box tenant-management-card" });
  ratingBox.appendChild(el("h4", { text: "Locataires partis — évaluations" }));
  ratingBox.appendChild(el("p", {
    text: "Après la fin d'un bail, attribuez une note générale et détaillez votre expérience.",
  }));
  if (endedLeases.length === 0) {
    ratingBox.appendChild(el("p", { className: "muted-text", text: "Aucun ancien locataire n'attend d'évaluation." }));
  } else {
    endedLeases.forEach((lease) => {
      ratingBox.appendChild(el("div", {
        className: "inline-form-row",
        children: [
          el("span", { text: lease.tenantName || "Ancien locataire" }),
          el("button", {
            className: "btn-action-trigger",
            children: [iconEl("fa-solid fa-star"), document.createTextNode(" Évaluer /10")],
            on: { click: () => openRatingModal(lease) },
          }),
        ],
      }));
    });
  }
  container.appendChild(ratingBox);
}

function blankSlate(iconClass, text) {
  return el("div", {
    className: "blank-slate",
    children: [iconEl(iconClass), el("span", { text })],
  });
}

function fullAddress(item) {
  let addr = `Av. ${item.avenue}, N° ${item.streetNumber}`;
  if (item.door) addr += `, Apt/Porte ${item.door}`;
  return addr;
}

function buildApartmentCard(item, { mode }) {
  const card = el("div", { className: "apartment-card-ui" });

  const imagePlaceholder = el("div", { className: "apartment-card-image-placeholder" });
  const imageUrl = safeImageUrl(item.imageUrl);
  const coverImg = imageUrl
    ? el("img", { attrs: { id: `cover-${item.id}`, src: imageUrl, alt: item.title } })
    : iconEl("fa-solid fa-image");
  imagePlaceholder.appendChild(coverImg);
  imagePlaceholder.appendChild(el("span", {
    className: "apartment-card-badge",
    attrs: { style: `background:${item.status === "Occupé" ? "#e74c3c" : "var(--primary)"}` },
    text: item.status || "Disponible",
  }));
  card.appendChild(imagePlaceholder);

  if (Array.isArray(item.images) && item.images.length > 0) {
    const gallery = el("div", { className: "gallery-miniatures" });
    item.images.forEach((imgUrl) => {
      const safeUrl = safeImageUrl(imgUrl);
      if (!safeUrl) return;
      gallery.appendChild(el("img", {
        attrs: { src: safeUrl, alt: "" },
        on: { click: (e) => {
          e.stopPropagation();
          if (coverImg.tagName === "IMG") coverImg.src = safeUrl;
        }},
      }));
    });
    card.appendChild(gallery);
  }

  const details = el("div", { className: "apartment-card-details" });
  details.appendChild(el("span", {
    className: "apartment-card-location",
    text: `${item.commune}, Kinshasa${mode === "tenant" ? " • Par " + item.ownerName : ""}`,
  }));
  details.appendChild(el("h4", {
    className: "apartment-card-title",
    text: mode === "owner" ? `${item.title} (${item.type})` : item.title,
  }));
  details.appendChild(el("p", {
    className: "apartment-card-address-detail",
    children: [
      iconEl("fa-solid fa-location-dot", "color:var(--primary)"),
      document.createTextNode(" " + fullAddress(item)),
      el("br"),
      el("small", { text: `Réf: ${item.reference}` }),
    ],
  }));

  if (mode === "owner") {
    details.appendChild(el("div", {
      className: "apartment-card-pricing-row",
      children: [
        el("span", { className: "apartment-card-price",
          children: [document.createTextNode(`${item.price} $ `), el("small", { text: "/mois" })] }),
        el("span", { className: "muted-strong", text: item.specs }),
      ],
    }));
    details.appendChild(el("button", {
      className: "btn-action-trigger danger-btn",
      children: [iconEl("fa-solid fa-trash-can"), document.createTextNode(" Supprimer ce bien définitivement")],
      on: { click: async (e) => {
        e.stopPropagation();
        if (!confirm("⚠️ Supprimer définitivement ce logement ?")) return;
        try { await deleteApartment(item.id); } catch (err) { showError(err); }
      }},
    }));
  } else {
    details.appendChild(buildTenantActionsRow(item));
    details.appendChild(el("div", {
      className: "apartment-card-pricing-row",
      children: [
        el("span", { className: "apartment-card-price",
          children: [document.createTextNode(`${item.price} $ `), el("small", { text: "/mois" })] }),
        el("span", { className: "chat-hint",
          children: [iconEl("fa-solid fa-comments"), document.createTextNode(" Chat Privé")] }),
      ],
    }));
    card.addEventListener("click", () =>
      startPrivateChat({ ownerId: item.ownerId, ownerName: item.ownerName, apartmentId: item.id, apartmentTitle: item.title })
    );
  }

  card.appendChild(details);
  return card;
}

function buildTenantActionsRow(item) {
  const row = el("div", { className: "tenant-actions-row" });
  const isMyLease = item.tenantId === state.currentUser.uid;
  const isOccupied = item.status === "Occupé";

  if (!isOccupied) {
    row.appendChild(el("button", {
      className: "btn-action-trigger tenant-cta",
      children: [iconEl("fa-solid fa-key"), document.createTextNode(" Louer la résidence")],
      on: { click: async (e) => {
        e.stopPropagation();
        try {
          await rentApartment(item.id);
          alert("Votre demande de location a été transmise au propriétaire.");
        } catch (err) { showError(err); }
      }},
    }));
  } else if (isMyLease) {
    row.appendChild(el("button", {
      className: "btn-action-trigger danger-btn small-btn",
      children: [iconEl("fa-solid fa-door-open"), document.createTextNode(" Partir de la résidence")],
      on: { click: async (e) => {
        e.stopPropagation();
        if (!confirm("Signaler votre départ de ce logement ?")) return;
        try {
          await leaveApartment(item.id);
          alert("Notification de départ envoyée avec succès.");
        } catch (err) { showError(err); }
      }},
    }));
    row.appendChild(el("button", {
      className: "btn-action-trigger small-btn",
      children: [iconEl("fa-solid fa-file-signature"), document.createTextNode(" Donner préavis")],
      on: { click: (e) => { e.stopPropagation(); openTenantRequestModal(item, "notice"); } },
    }));
    row.appendChild(el("button", {
      className: "btn-action-trigger warn-btn small-btn",
      children: [iconEl("fa-solid fa-screwdriver-wrench"), document.createTextNode(" Signaler un problème")],
      on: { click: (e) => { e.stopPropagation(); openTenantRequestModal(item, "issue"); } },
    }));
    if (item.paymentStatus === "signale") {
      row.appendChild(el("span", {
        className: "status-pill declared",
        children: [iconEl("fa-solid fa-circle-check"), document.createTextNode(" Paiement déclaré (non vérifié)")],
      }));
    } else if (item.paymentStatus === "confirme") {
      row.appendChild(el("span", {
        className: "status-pill confirmed",
        children: [iconEl("fa-solid fa-handshake"), document.createTextNode(" Loyer confirmé par le bailleur")],
      }));
    } else {
      row.appendChild(el("button", {
        className: "btn-action-trigger warn-btn small-btn",
        children: [iconEl("fa-solid fa-money-bill-wave"), document.createTextNode(" Signaler Loyer Payé")],
        on: { click: async (e) => {
          e.stopPropagation();
          openTenantRequestModal(item, "payment");
        }},
      }));
    }
  } else {
    row.appendChild(el("span", { className: "apartment-card-badge static-badge", text: "Occupé" }));
  }
  return row;
}

function openTenantRequestModal(apartment, requestType) {
  if (state.currentUser?.role !== "tenant" || apartment.tenantId !== state.currentUser.uid) {
    showError(new Error("Cette action est réservée au locataire associé au logement."));
    return;
  }

  const requestConfig = {
    payment: { title: "Envoyer une preuve de paiement", submit: "Envoyer au bailleur" },
    notice: { title: "Donner un préavis de départ", submit: "Envoyer le préavis" },
    issue: { title: "Signaler un problème au logement", submit: "Envoyer le signalement" },
  }[requestType];
  if (!requestConfig) return;

  const overlay = el("div", { className: "modal-overlay" });
  const modal = el("div", { className: "modal-box" });
  modal.appendChild(el("h3", { text: requestConfig.title }));
  modal.appendChild(el("p", {
    className: "rating-scale-hint",
    text: `${apartment.title || "Logement"} — votre bailleur recevra ces informations dans la messagerie KAZA.`,
  }));

  const addField = (label, input, help = "") => {
    const field = el("div", { className: "form-input-container" });
    field.appendChild(el("label", { text: label }));
    field.appendChild(input);
    if (help) field.appendChild(el("p", { className: "request-field-help", text: help }));
    modal.appendChild(field);
    return input;
  };

  let paymentMethod;
  let paymentDate;
  let paymentReference;
  let paymentDetails;
  let paymentProofFile;
  let expectedLeaveDate;
  let noticeDetails;
  let issueTitle;
  let issueDescription;

  if (requestType === "payment") {
    paymentMethod = addField("Moyen de paiement", el("select", { children: [
      el("option", { attrs: { value: "" }, text: "Choisir…" }),
      el("option", { attrs: { value: "Virement bancaire" }, text: "Virement bancaire" }),
      el("option", { attrs: { value: "Mobile Money" }, text: "Mobile Money" }),
      el("option", { attrs: { value: "Espèces" }, text: "Espèces" }),
      el("option", { attrs: { value: "Autre" }, text: "Autre" }),
    ] }));
    paymentDate = addField("Date du paiement", el("input", { attrs: { type: "date" } }));
    paymentReference = addField(
      "Référence ou preuve", el("input", { attrs: { type: "text", maxlength: "300", placeholder: "Référence de transaction ou preuve reçue" } }),
      "Les paiements ne sont pas traités par KAZA. Le bailleur doit confirmer la réception."
    );
    paymentDetails = addField("Précisions (facultatif)", el("textarea", {
      attrs: { rows: "3", maxlength: "500", placeholder: "Ex. paiement en espèces remis au bailleur" },
    }));
    paymentProofFile = addField(
      "Joindre une photo du reçu (facultatif)",
      el("input", { attrs: { type: "file", accept: "image/jpeg,image/png,image/webp" } }),
      "KAZA compresse la pièce jointe avant l'envoi. Elle reste accessible au bailleur et au locataire du bail."
    );
  } else if (requestType === "notice") {
    expectedLeaveDate = addField("Date de départ envisagée", el("input", { attrs: { type: "date" } }));
    noticeDetails = addField("Message au bailleur (facultatif)", el("textarea", {
      attrs: { rows: "4", maxlength: "1000", placeholder: "Ajoutez un détail utile concernant votre préavis" },
    }));
  } else {
    issueTitle = addField("Sujet", el("input", {
      attrs: { type: "text", maxlength: "120", placeholder: "Ex. fuite d'eau dans la cuisine" },
    }));
    issueDescription = addField("Description du problème", el("textarea", {
      attrs: { rows: "4", maxlength: "1500", placeholder: "Décrivez ce qui se passe et depuis quand" },
    }));
  }

  const actions = el("div", { className: "modal-actions" });
  actions.appendChild(el("button", {
    className: "btn-submit-form",
    attrs: { style: "background:var(--input-bg); color:var(--text-main);" },
    text: "Annuler",
    on: { click: () => overlay.remove() },
  }));
  const submit = el("button", {
    className: "btn-submit-form tenant-theme",
    text: requestConfig.submit,
    on: { click: async () => {
      submit.disabled = true;
      submit.textContent = "Envoi…";
      try {
        const lease = await getActiveLease(apartment.id, state.currentUser.uid);
        if (!lease) throw new Error("Aucun bail actif n'est associé à ce logement.");
        const chatId = await getOrCreateChat({
          ownerId: apartment.ownerId,
          ownerName: apartment.ownerName,
          apartmentId: apartment.id,
          apartmentTitle: apartment.title,
        });

        if (requestType === "payment") {
          const reference = paymentReference.value.trim();
          const details = paymentDetails.value.trim();
          if (!reference && !details && !paymentProofFile.files?.length) {
            throw new Error("Ajoutez une référence, une explication ou la photo d'un reçu.");
          }
          await notifyPayment(apartment, {
            method: paymentMethod.value,
            date: paymentDate.value,
            reference,
            details,
            proofFile: paymentProofFile.files?.[0] || null,
          });
          alert("Votre déclaration et sa référence ont été envoyées au bailleur. Le paiement reste à confirmer.");
        } else if (requestType === "notice") {
          if (!expectedLeaveDate.value) throw new Error("Indiquez la date de départ que vous envisagez.");
          const selectedDate = new Date(`${expectedLeaveDate.value}T00:00:00`);
          if (Number.isNaN(selectedDate.getTime()) || selectedDate <= new Date(new Date().toDateString())) {
            throw new Error("La date envisagée doit être postérieure à aujourd'hui.");
          }
          const message = [
            `📋 PRÉAVIS DE DÉPART — ${state.currentUser.name}`,
            `Logement : ${apartment.title || "Logement"}`,
            `Date de départ envisagée : ${expectedLeaveDate.value}`,
            noticeDetails.value.trim() ? `Message : ${noticeDetails.value.trim()}` : "",
            "Ce préavis informe le bailleur et ne clôture pas automatiquement le bail.",
          ].filter(Boolean).join("\n");
          await sendMessage(chatId, message);
          alert("Votre préavis a été envoyé au bailleur dans la messagerie KAZA.");
        } else {
          const title = issueTitle.value.trim();
          const description = issueDescription.value.trim();
          if (!title || !description) throw new Error("Indiquez le sujet et décrivez le problème.");
          await sendMessage(chatId, [
            `🛠️ SIGNALEMENT DE PROBLÈME — ${state.currentUser.name}`,
            `Logement : ${apartment.title || "Logement"}`,
            `Sujet : ${title}`,
            `Description : ${description}`,
          ].join("\n"));
          alert("Votre signalement a été envoyé au bailleur dans la messagerie KAZA.");
        }
        overlay.remove();
      } catch (err) {
        showError(err);
        submit.disabled = false;
        submit.textContent = requestConfig.submit;
      }
    } },
  });
  actions.appendChild(submit);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

let selectedApartmentPhotos = [];
let apartmentPhotoPreviewUrls = [];

function renderApartmentPhotoPreviews() {
  const previews = document.getElementById("app-photo-previews");
  const counter = document.getElementById("app-photo-count");
  if (!previews || !counter) return;
  apartmentPhotoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  apartmentPhotoPreviewUrls = [];
  clear(previews);
  counter.textContent = `${selectedApartmentPhotos.length} / ${MAX_PHOTOS} photo${selectedApartmentPhotos.length === 1 ? "" : "s"}`;
  selectedApartmentPhotos.forEach((file, index) => {
    const url = URL.createObjectURL(file);
    apartmentPhotoPreviewUrls.push(url);
    previews.appendChild(el("div", {
      className: "photo-upload-preview",
      children: [
        el("img", { attrs: { src: url, alt: `Aperçu de la photo ${index + 1}` } }),
        el("span", { text: `${index + 1}. ${(file.size / 1024 / 1024).toFixed(1)} Mo avant réduction` }),
      ],
    }));
  });
}

function initAddApartmentScreen() {
  document.getElementById("btn-back-add-appart").addEventListener("click", () => {
    changeView("scr-owner-dashboard");
    activateOwnerTab("apparts");
  });
  document.getElementById("app-type").addEventListener("change", (e) => {
    const doorField = document.getElementById("container-app-door");
    if (e.target.value === "Maison") {
      doorField.style.display = "none";
      document.getElementById("app-door").value = "";
    } else { doorField.style.display = "block"; }
  });
  document.getElementById("app-photos").addEventListener("change", (event) => {
    const files = Array.from(event.currentTarget.files || []);
    const status = document.getElementById("app-photo-status");
    if (files.length > MAX_PHOTOS) {
      selectedApartmentPhotos = [];
      event.currentTarget.value = "";
      status.textContent = "Choisissez au maximum 7 photos.";
      renderApartmentPhotoPreviews();
      return;
    }
    selectedApartmentPhotos = files;
    status.textContent = files.length ? "Les photos seront réduites automatiquement avant l'envoi." : "";
    renderApartmentPhotoPreviews();
  });
  document.getElementById("btn-save-apartment").addEventListener("click", async () => {
    const submitButton = document.getElementById("btn-save-apartment");
    const status = document.getElementById("app-photo-status");
    submitButton.disabled = true;
    submitButton.textContent = "Publication en cours…";
    const form = {
      title: document.getElementById("app-title").value,
      type: document.getElementById("app-type").value,
      commune: document.getElementById("app-commune").value,
      avenue: document.getElementById("app-avenue").value,
      streetNumber: document.getElementById("app-street-number").value,
      door: document.getElementById("app-door").value,
      reference: document.getElementById("app-reference").value,
      price: document.getElementById("app-price").value,
      specs: document.getElementById("app-specs").value,
      photos: selectedApartmentPhotos,
    };
    try {
      await createApartment(form, (message) => { status.textContent = message; });
      ["app-title","app-avenue","app-street-number","app-door","app-reference",
       "app-price","app-specs"
      ].forEach((id) => (document.getElementById(id).value = ""));
      selectedApartmentPhotos = [];
      document.getElementById("app-photos").value = "";
      status.textContent = "Annonce publiée avec succès.";
      renderApartmentPhotoPreviews();
      changeView("scr-owner-dashboard");
      activateOwnerTab("apparts");
    } catch (err) { showError(err); }
    finally {
      submitButton.disabled = false;
      submitButton.textContent = "Publier le logement";
    }
  });
}

function initTenantDashboard() {
  document.getElementById("nav-tab-tenant-discover").addEventListener("click", () => activateTenantTab("discover"));
  document.getElementById("nav-tab-tenant-chats").addEventListener("click", () => activateTenantTab("chats"));
  document.querySelectorAll('#scr-tenant-dashboard [data-action="theme"]')
    .forEach((b) => b.addEventListener("click", toggleAppTheme));
  document.querySelectorAll('#scr-tenant-dashboard [data-action="logout"]')
    .forEach((b) => b.addEventListener("click", () => logoutUser()));
}

function activateTenantTab(tabName) {
  document.querySelectorAll("#scr-tenant-dashboard .tab-navigation-item")
    .forEach((t) => t.classList.remove("active"));
  document.getElementById(`nav-tab-tenant-${tabName}`).classList.add("active");

  const container = document.getElementById("tenant-tab-injector");
  clear(container);

  if (tabName === "discover") {
    loadTenantReputation(container);
    renderTenantSearchBox(container);
    if (unsubApartments) unsubApartments();
    unsubApartments = watchCatalog((apartments) => {
      state.apartments = apartments;
      renderTenantCatalog();
    });
  } else if (tabName === "chats") {
    renderChatList(container);
  }
}

function loadTenantReputation(container) {
  getTenantRatingSummary(state.currentUser.uid)
    .then((summary) => {
      const card = buildRatingSummaryCard(summary, "Ma réputation locative");
      if (container.firstChild) container.insertBefore(card, container.firstChild);
      else container.appendChild(card);
    })
    .catch((err) => console.warn("Réputation indisponible :", err));
}

let tenantSearchRenderTimer;

function renderTenantSearchBox(container) {
  const box = el("div", { className: "search-filter-box" });

  const searchInput = el("input", {
    attrs: { type: "text", placeholder: "Rechercher par mot-clé (ex: Résidence...)" },
  });
  searchInput.value = state.searchQuery;
  searchInput.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    clearTimeout(tenantSearchRenderTimer);
    tenantSearchRenderTimer = setTimeout(renderTenantCatalog, 180);
  });
  box.appendChild(el("div", {
    className: "form-input-container",
    attrs: { style: "margin-bottom:0;" },
    children: [iconEl("fa-solid fa-magnifying-glass"), searchInput],
  }));

  const typeRow = el("div", { className: "filter-tags-scroll" });
  ["Tous", "Appartement", "Maison", "Studio"].forEach((type) => {
    typeRow.appendChild(filterTag(type, state.filterType === type, () => {
      state.filterType = type;
      activateTenantTab("discover");
    }));
  });
  box.appendChild(typeRow);

  const communeRow = el("div", { className: "filter-tags-scroll", attrs: { style: "margin-top:5px;" } });
  ["Toutes", "Gombe", "Ngaliema", "Limete"].forEach((commune) => {
    const label = commune === "Toutes" ? "Toutes Communes" : commune;
    communeRow.appendChild(filterTag(label, state.filterCommune === commune, () => {
      state.filterCommune = commune;
      activateTenantTab("discover");
    }));
  });
  box.appendChild(communeRow);

  container.appendChild(box);
  container.appendChild(el("div", { attrs: { id: "tenant-catalog-results" } }));
}

function filterTag(label, active, onClick) {
  return el("span", {
    className: "filter-tag" + (active ? " active" : ""),
    text: label, on: { click: onClick },
  });
}

function renderTenantCatalog() {
  const resultsBox = document.getElementById("tenant-catalog-results");
  if (!resultsBox) return;
  clear(resultsBox);

  const filtered = filterCatalog(state.apartments);
  if (filtered.length === 0) {
    resultsBox.appendChild(blankSlate("fa-solid fa-house-crack",
      "Aucun logement disponible ne correspond à vos critères."));
    return;
  }
  const fragment = document.createDocumentFragment();
  filtered.forEach((item) => fragment.appendChild(buildApartmentCard(item, { mode: "tenant" })));
  resultsBox.appendChild(fragment);
}

async function startPrivateChat({ ownerId, ownerName, apartmentId, apartmentTitle }) {
  try {
    const chatId = await getOrCreateChat({ ownerId, ownerName, apartmentId, apartmentTitle });
    openChatRoom(chatId, { ownerName, apartmentTitle });
  } catch (err) { showError(err); }
}

function renderChatList(container) {
  clear(container);
  if (unsubChats) unsubChats();
  unsubChats = watchMyChats((chats) => {
    state.chats = chats;
    clear(container);
    if (chats.length === 0) {
      container.appendChild(blankSlate("fa-solid fa-comments", "Aucune conversation."));
      return;
    }
    container.appendChild(el("div", {
      className: "action-context-bar",
      children: [el("span", { className: "context-title", text: "Vos Conversations" })],
    }));
    chats.forEach((c) => {
      const correspondent = state.currentUser.role === "owner" ? c.tenantName : c.ownerName;
      const item = el("div", {
        className: "chat-list-item",
        children: [
          el("div", { className: "chat-avatar", text: (correspondent || "?").charAt(0) }),
          el("div", {
            className: "chat-info",
            children: [
              el("h4", { text: correspondent || "Correspondant" }),
              el("p", { className: "chat-context", text: `Objet: ${c.context || ""}` }),
            ],
          }),
          iconEl("fa-solid fa-chevron-right"),
        ],
        on: { click: () => openChatRoom(c.id, { ownerName: c.ownerName, apartmentTitle: c.context }) },
      });
      container.appendChild(item);
    });
  });
}

let unsubMessages = null;

function openChatRoom(chatId, { apartmentTitle } = {}) {
  state.activeChatId = chatId;
  document.getElementById("scr-chat-room").className =
    state.currentUser.role === "tenant" ? "screen-view tenant-theme" : "screen-view";
  document.getElementById("chat-room-subtitle").textContent = "Bien ciblé : " + (apartmentTitle || "");
  changeView("scr-chat-room");

  if (unsubMessages) unsubMessages();
  const container = document.getElementById("chat-messages-container");
  unsubMessages = watchMessages(chatId, (messages) => renderMessages(container, messages));
}

function renderMessages(container, messages) {
  clear(container);
  messages.forEach((m) => {
    const isMyMsg = m.senderId === state.currentUser.uid;
    const proofPath = String(m.text || "").match(/Pièce jointe KAZA : (payment-proofs\/[A-Za-z0-9/_-]+)/)?.[1];
    const isPrivateRequest = /^(💰 PREUVE DE PAIEMENT|📋 PRÉAVIS DE DÉPART|🛠️ SIGNALEMENT DE PROBLÈME)/.test(String(m.text || ""));
    const visibleMessage = proofPath
      ? m.text.replace(`Pièce jointe KAZA : ${proofPath}`, "Pièce jointe KAZA : reçu sécurisé")
      : m.text;
    const bubble = el("div", { className: `msg-bubble ${isMyMsg ? "outgoing" : "incoming"}` });
    bubble.appendChild(el("span", { className: "msg-text", text: visibleMessage }));
    if (proofPath) {
      const attachmentLink = el("a", {
        className: "msg-attachment-link",
        attrs: { target: "_blank", rel: "noopener noreferrer", "aria-disabled": "true" },
        text: "Chargement du reçu sécurisé…",
      });
      bubble.appendChild(attachmentLink);
      getDownloadURL(storageRef(storage, proofPath)).then((url) => {
        attachmentLink.setAttribute("href", url);
        attachmentLink.removeAttribute("aria-disabled");
        attachmentLink.textContent = "Afficher la photo du reçu";
      }).catch(() => { attachmentLink.textContent = "Reçu indisponible pour ce compte"; });
    }
    if (state.currentUser.role === "owner" && !isMyMsg && !isPrivateRequest) {
      bubble.appendChild(el("span", {
        className: "msg-share-hint",
        children: [iconEl("fa-solid fa-share-nodes"), document.createTextNode(" Diffuser (Style WhatsApp)")],
      }));
      bubble.addEventListener("click", async () => {
        const confirmed = confirm(
          `Voulez-vous transférer ce message à la totalité de vos locataires ?\n\n"${m.text}"`
        );
        if (!confirmed) return;
        try {
          const count = await broadcastToAllTenants(m.text);
          alert(`Message transféré avec succès dans vos ${count} canaux.`);
        } catch (err) { showError(err); }
      });
    }
    const time = m.createdAt?.toDate
      ? m.createdAt.toDate().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
      : "";
    bubble.appendChild(el("span", { className: "msg-meta", text: time }));
    container.appendChild(bubble);
  });
  container.scrollTop = container.scrollHeight;
}

function initChatRoom() {
  document.getElementById("btn-back-from-chat").addEventListener("click", () => {
    if (unsubMessages) unsubMessages();
    if (state.currentUser.role === "owner") {
      changeView("scr-owner-dashboard");
      activateOwnerTab("chats");
    } else {
      changeView("scr-tenant-dashboard");
      activateTenantTab("chats");
    }
  });
  document.getElementById("btn-send-message").addEventListener("click", submitChatMessage);
  document.getElementById("chat-input-field").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitChatMessage();
  });
}

async function submitChatMessage() {
  const input = document.getElementById("chat-input-field");
  if (!input.value.trim() || !state.activeChatId) return;
  const text = input.value;
  input.value = "";
  try { await sendMessage(state.activeChatId, text); }
  catch (err) { showError(err); }
}

function openRatingModal(lease) {
  const overlay = el("div", { className: "modal-overlay" });
  const modal = el("div", { className: "modal-box" });
  modal.appendChild(el("h3", { text: `Évaluer ${lease.tenantName || "le locataire"}` }));
  modal.appendChild(el("p", {
    className: "rating-scale-hint",
    text: `Notez chaque critère de ${RATING_MIN} à ${RATING_MAX} (style /10). L'évaluation est définitive et visible par le locataire.`,
  }));

  const scoreInputs = {};
  RATING_CRITERIA.forEach((criterion) => {
    const valueSpan = el("span", { className: "rating-slider-value", text: `8 / ${RATING_MAX}` });
    const range = el("input", {
      className: "rating-range",
      attrs: { type: "range", min: String(RATING_MIN), max: String(RATING_MAX), step: "1", value: "8" },
    });
    range.addEventListener("input", () => {
      valueSpan.textContent = `${range.value} / ${RATING_MAX}`;
    });
    scoreInputs[criterion.key] = range;

    modal.appendChild(el("div", {
      className: "rating-slider-row",
      children: [
        el("label", { children: [el("span", { text: criterion.label }), valueSpan] }),
        range,
      ],
    }));
  });

  const commentInput = el("textarea", {
    attrs: { placeholder: "Commentaire (optionnel, 1000 caractères max)", rows: "3" },
  });
  modal.appendChild(el("div", {
    className: "form-input-container",
    children: [el("label", { text: "Commentaire" }), commentInput],
  }));

  const actionsRow = el("div", { className: "modal-actions" });
  actionsRow.appendChild(el("button", {
    className: "btn-submit-form",
    attrs: { style: "background:var(--input-bg); color:var(--text-main);" },
    text: "Annuler",
    on: { click: () => overlay.remove() },
  }));
  actionsRow.appendChild(el("button", {
    className: "btn-submit-form owner-theme",
    text: "Envoyer l'évaluation",
    on: { click: async () => {
      const scores = {};
      Object.entries(scoreInputs).forEach(([key, input]) => (scores[key] = input.value));
      try {
        await submitRating(lease, scores, commentInput.value);
        overlay.remove();
        alert("✅ Évaluation enregistrée. Merci de contribuer à la confiance KAZA !");
        if (state.currentUser?.role === "owner") {
          const activeTabId = document.querySelector("#scr-owner-dashboard .tab-navigation-item.active")?.id || "";
          const activeTabName = activeTabId.replace("nav-tab-owner-", "");
          if (activeTabName) activateOwnerTab(activeTabName);
        }
      } catch (err) { showError(err); }
    }},
  }));
  modal.appendChild(actionsRow);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function toggleAppTheme() { document.body.classList.toggle("dark-mode"); }

function initPwaInstall() {
  const pwaBtn = document.getElementById("pwa-install-btn");
  let pwaPrompt;
  const isIos = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);

  window.addEventListener("load", () => {
    if (isIos() && pwaBtn) pwaBtn.style.display = "block";
  });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    pwaPrompt = e;
    if (pwaBtn) pwaBtn.style.display = "block";
  });
  if (pwaBtn) {
    pwaBtn.addEventListener("click", async () => {
      if (isIos()) {
        alert("Pour installer KAZA sur iPhone :\n\n1. Cliquez sur le bouton 'Partager' en bas sur Safari.\n2. Sélectionnez 'Sur l'écran d'accueil'.");
      } else if (pwaPrompt) {
        pwaPrompt.prompt();
        const { outcome } = await pwaPrompt.userChoice;
        if (outcome === "accepted") pwaBtn.style.display = "none";
        pwaPrompt = null;
      }
    });
  }
}


// ===================== app.js =====================
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
    exitAppToRoleSelect();
  } else {
    changeView("scr-role-select");
  }
  firstCheck = false;
});
