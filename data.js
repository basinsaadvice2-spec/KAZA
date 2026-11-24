import { db, collection, doc, onSnapshot } from './firebase.js';
import { state } from './state.js';
import { bus } from './bus.js';
import { toast } from './ui.js';
let unsub = null;
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

export default {
  name: 'data',
  init() {
    bus.on('session:start', () => {
      unsub?.();
      unsub = onSnapshot(collection(db, 'apartments'), (snap) => {
        state.apartments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        bus.emit('apartments:changed');
        syncOwnerProfiles();
      }, (err) => toast('Lecture des annonces refusée (' + err.code + '). Vérifiez les règles Firestore.', 'error'));
    });
    bus.on('session:end', () => {
      unsub?.(); unsub = null;
      for (const stop of ownerProfileUnsubs.values()) stop();
      ownerProfileUnsubs = new Map();
      state.ownerProfiles = Object.create(null);
      state.apartments = [];
      bus.emit('owner-profiles:changed');
    });
  }
};
