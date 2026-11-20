import { db, collection, addDoc, serverTimestamp } from './firebase.js';
import { state } from './state.js';
export const notify = (toUid, type, title, body, extra = {}) =>
  addDoc(collection(db, 'notifications'), { toUid, fromUid: state.user.uid, type, title, body, read: false, createdAt: serverTimestamp(), ...extra }).catch(console.error);
