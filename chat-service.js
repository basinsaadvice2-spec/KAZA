import { db, doc, getDoc, setDoc, addDoc, updateDoc, collection, serverTimestamp } from './firebase.js';
import { state } from './state.js';
export async function postMessage(id, text, type = 'user') {
  await addDoc(collection(db, 'chats', id, 'messages'), { text, type, senderUid: state.user.uid, senderName: state.user.name, createdAt: serverTimestamp() });
  await updateDoc(doc(db, 'chats', id), { lastMessage: text, lastAt: serverTimestamp(), lastSender: type === 'system' ? '' : state.user.uid });
}
export async function ensureChat(apt, tenantUid, tenantName) {
  const id = `${apt.id}_${tenantUid}`, r = doc(db, 'chats', id), s = await getDoc(r);
  if (s.exists()) return { id, ...s.data() };
  const data = { id, aptId: apt.id, aptTitle: apt.title, commune: apt.commune || '', ownerUid: apt.ownerUid, ownerName: apt.ownerName || '', tenantUid, tenantName, participants: [apt.ownerUid, tenantUid], lastMessage: '', lastSender: '', lastAt: serverTimestamp() };
  await setDoc(r, data);
  await postMessage(id, `Conversation ouverte au sujet de « ${apt.title} » (réf. ${apt.id}).`, 'system');
  return data;
}
