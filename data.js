import { db, collection, doc, onSnapshot, query, where } from './firebase.js';
import { state } from './state.js';
import { bus } from './bus.js';
import { toast } from './ui.js';
let apartmentUnsubs = [];
let apartmentSnapshots = new Map();
let ownerProfileUnsubs = new Map();

function syncOwnerProfiles() {
  const ownerIds = new Set(state.apartments.map((a) => a.ownerUid).filter(Boolean));
  for (const [uid, stop] of ownerProfileUnsubs) {
    if (!ownerIds.has(uid)) {
      stop();
      ownerProfileUnsubs.delete(uid);
      delete state.ownerProfiles[uid];
    }
  }
  for (const uid of ownerIds) {
    if (ownerProfileUnsubs.has(uid)) continue;
    const stop = onSnapshot(doc(db, 'publicProfiles', uid), (snap) => {
      state.ownerProfiles[uid] = snap.exists() ? snap.data() : null;
      bus.emit('owner-profiles:changed');
    }, (error) => {
      state.ownerProfiles[uid] = null;
      console.warn('[KAZA] Profil annonceur indisponible', error.code || error);
      bus.emit('owner-profiles:changed');
    });
    ownerProfileUnsubs.set(uid, stop);
  }
}

function stopApartmentListeners() {
  apartmentUnsubs.forEach((stop) => stop());
  apartmentUnsubs = [];
  apartmentSnapshots = new Map();
}

function startApartmentListeners(user) {
  stopApartmentListeners();
  state.apartments = [];

  const apartments = collection(db, 'apartments');
  const sources = user.role === 'owner'
    ? [['owner', query(apartments, where('ownerUid', '==', user.uid))]]
    : [
      ['published', query(apartments, where('status', '==', 'publie'), where('availabilityStatus', '==', 'Disponible'))],
      ['rental', query(apartments, where('tenantUid', '==', user.uid))]
    ];

  sources.forEach(([key, apartmentsQuery]) => {
    const stop = onSnapshot(apartmentsQuery, (snap) => {
      apartmentSnapshots.set(key, snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      const merged = new Map();
      apartmentSnapshots.forEach((items) => items.forEach((item) => merged.set(item.id, item)));
      state.apartments = [...merged.values()];
      bus.emit('apartments:changed');
      syncOwnerProfiles();
    }, (error) => {
      apartmentSnapshots.set(key, []);
      const merged = new Map();
      apartmentSnapshots.forEach((items) => items.forEach((item) => merged.set(item.id, item)));
      state.apartments = [...merged.values()];
      console.error('[KAZA] Lecture des annonces refusée', error);
      toast(`Impossible de charger les annonces (${error.code || 'erreur'}). Vérifiez votre rôle et les règles Firestore.`, 'error');
    });
    apartmentUnsubs.push(stop);
  });
}

export default {
  name: 'data',
  init() {
    bus.on('session:start', (user) => {
      startApartmentListeners(user);
    });
    bus.on('session:end', () => {
      stopApartmentListeners();
      state.apartments = [];
      for (const stop of ownerProfileUnsubs.values()) stop();
      ownerProfileUnsubs = new Map();
      state.ownerProfiles = Object.create(null);
      state.apartments = [];
      bus.emit('owner-profiles:changed');
    });
  }
};
