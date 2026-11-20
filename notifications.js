import { db, collection, doc, query, where, onSnapshot, updateDoc, writeBatch } from './firebase.js';
import { state } from './state.js';
import { bus } from './bus.js';
import { $, esc, onAction, openModal, closeModal } from './ui.js';
import { show } from './views.js';
let list = [], unsub = null;
const BELL = '<button class="circle-action-btn" data-action="open-notifs" style="position:relative"><i class="fa-solid fa-bell"></i><span class="notif-badge" style="display:none;position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:9px;background:#ef4444;color:#fff;font-size:10px;font-weight:700;align-items:center;justify-content:center"></span></button>';
const MODAL = '<div id="notif-modal" class="modal-overlay" style="display:none"><div class="modal-box"><h3>Notifications</h3><div id="notif-list"></div><div class="modal-actions"><button class="btn-submit-form" style="background:var(--text-muted)" data-action="notif-close">Fermer</button><button class="btn-submit-form owner-theme" data-action="notif-readall">Tout marquer lu</button></div></div></div>';

function paint() {
  const n = list.filter(x => !x.read).length;
  document.querySelectorAll('.notif-badge').forEach(b => { b.textContent = n; b.style.display = n ? 'flex' : 'none'; });
  const box = $('notif-list'); if (!box) return;
  box.innerHTML = list.length ? list.map(x => `<div class="chat-list-item" data-action="notif-click" data-id="${esc(x.id)}" style="opacity:${x.read ? .55 : 1}"><div class="chat-info"><h4>${esc(x.title)}</h4><p style="white-space:normal">${esc(x.body)}</p></div></div>`).join('') : '<div class="blank-slate"><i class="fa-solid fa-bell-slash"></i><p>Aucune notification.</p></div>';
}
export default {
  name: 'notifications',
  init() {
    document.querySelectorAll('#scr-owner-dashboard .header-utility-actions, #scr-tenant-dashboard .header-utility-actions').forEach(h => h.insertAdjacentHTML('afterbegin', BELL));
    document.body.insertAdjacentHTML('beforeend', MODAL);
    bus.on('session:start', (u) => {
      unsub?.();
      unsub = onSnapshot(query(collection(db, 'notifications'), where('toUid', '==', u.uid)), (s) => {
        list = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        paint();
      }, console.error);
    });
    bus.on('session:end', () => { unsub?.(); unsub = null; list = []; paint(); });
    onAction('open-notifs', () => { paint(); openModal('notif-modal'); });
    onAction('notif-close', () => closeModal('notif-modal'));
    onAction('notif-readall', async () => {
      const b = writeBatch(db); list.filter(x => !x.read).forEach(x => b.update(doc(db, 'notifications', x.id), { read: true }));
      await b.commit();
    });
    onAction('notif-click', async (el) => {
      const n = list.find(x => x.id === el.dataset.id); if (!n) return;
      if (!n.read) await updateDoc(doc(db, 'notifications', n.id), { read: true });
      closeModal('notif-modal');
      if (n.chatId) bus.emit('chat:open', { id: n.chatId });
      else if (n.tab) show(state.user.role, n.tab);
    });
  }
};
