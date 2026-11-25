import { db, collection, doc, onSnapshot, writeBatch, serverTimestamp } from './firebase.js';
import { state } from './state.js';
import { bus } from './bus.js';
import { toast, onAction, requireRole } from './ui.js';
import { availabilityStatusOf } from './format.js';

let unsub = null;

export default {
  name: 'follow',
  init() {
    bus.on('session:start', (user) => {
      unsub?.();
      state.followedApartmentIds = new Set();
      if (user.role !== 'tenant') return;
      unsub = onSnapshot(collection(db, 'users', user.uid, 'followedApartments'), (snapshot) => {
        state.followedApartmentIds = new Set(snapshot.docs.map((item) => item.id));
        bus.emit('followed:changed');
      }, (error) => toast(`Lecture des logements suivis refusée (${error.code}).`, 'error'));
    });
    bus.on('session:end', () => {
      unsub?.();
      unsub = null;
      state.followedApartmentIds = new Set();
      bus.emit('followed:changed');
    });

    onAction('toggle-follow', async (element) => {
      requireRole('tenant');
      const apartment = state.apartments.find((item) => item.id === element.dataset.id);
      if (!apartment || availabilityStatusOf(apartment) !== 'Disponible') throw new Error('Ce logement n’est plus disponible.');
      const followerRef = doc(db, 'apartments', apartment.id, 'followers', state.user.uid);
      const userFollowRef = doc(db, 'users', state.user.uid, 'followedApartments', apartment.id);
      const batch = writeBatch(db);
      if (state.followedApartmentIds.has(apartment.id)) {
        batch.delete(followerRef);
        batch.delete(userFollowRef);
      } else {
        const value = { uid: state.user.uid, apartmentId: apartment.id, ownerUid: apartment.ownerUid, title: apartment.title, createdAt: serverTimestamp() };
        batch.set(followerRef, value);
        batch.set(userFollowRef, value);
      }
      await batch.commit();
      toast(state.followedApartmentIds.has(apartment.id) ? 'Ce logement ne sera plus suivi.' : 'Vous suivez ce logement.', 'ok');
    });
  }
};
