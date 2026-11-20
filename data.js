import { db, collection, onSnapshot } from '../core/firebase.js';
import { state } from '../core/state.js';
import { bus } from '../core/bus.js';
import { toast } from '../core/ui.js';
let unsub = null;
export default {
  name: 'data',
  init() {
    bus.on('session:start', () => {
      unsub?.();
      unsub = onSnapshot(collection(db, 'apartments'), (snap) => {
        state.apartments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        bus.emit('apartments:changed');
      }, (err) => toast('Lecture des annonces refusée (' + err.code + '). Vérifiez les règles Firestore.', 'error'));
    });
    bus.on('session:end', () => { unsub?.(); unsub = null; state.apartments = []; });
  }
};
