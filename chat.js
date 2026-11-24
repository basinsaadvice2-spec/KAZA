import { db, collection, doc, getDoc, query, where, orderBy, onSnapshot } from './firebase.js';
import { state } from './state.js';
import { bus } from './bus.js';
import { $, esc, onAction, bindActions, showScreen, requireRole } from './ui.js';
import { addView, show } from './views.js';
import { ensureChat, postMessage } from './chat-service.js';
let chats = [], unsubList = null, unsubMsgs = null, active = null;
const other = (c) => state.user.uid === c.ownerUid ? c.tenantName : c.ownerName;
const time = (ts) => ts && ts.toDate ? ts.toDate().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';

function renderList(box) {
  box.innerHTML = chats.length ? chats.map(c => `<div class="chat-list-item" data-action="open-chat" data-id="${esc(c.id)}"><div class="chat-avatar">${esc((other(c) || '?')[0].toUpperCase())}</div><div class="chat-info"><div class="chat-context">${esc(c.aptTitle)}</div><h4>${esc(other(c))}</h4><p>${esc(c.lastMessage || '')}</p></div></div>`).join('') : '<div class="blank-slate"><i class="fa-solid fa-comments"></i><p>Aucune discussion.</p></div>';
}
function renderMsgs(msgs) {
  const box = $('chat-messages-container');
  box.innerHTML = msgs.map(m => m.type === 'system' ? `<div class="system-message">${esc(m.text)}</div>` : `<div class="msg-bubble ${m.senderUid === state.user.uid ? 'outgoing' : 'incoming'}">${esc(m.text)}<span class="msg-meta">${time(m.createdAt)}</span></div>`).join('');
  box.scrollTop = box.scrollHeight;
}
function openRoom(c) {
  active = c; unsubMsgs?.();
  $('scr-chat-room').classList.toggle('tenant-theme', state.user.role === 'tenant');
  $('chat-room-title').innerText = other(c) || 'Discussion';
  $('chat-room-subtitle').innerText = `${c.aptTitle} • ${c.commune || ''}`;
  unsubMsgs = onSnapshot(query(collection(db, 'chats', c.id, 'messages'), orderBy('createdAt')), (s) => renderMsgs(s.docs.map(d => d.data({ serverTimestamps: 'estimate' }))), console.error);
  showScreen('scr-chat-room');
}

export default {
  name: 'chat',
  init() {
    bindActions({ '#btn-close-chat': 'chat-close', '#btn-send-message': 'chat-send' });
    addView('tenant', 'tenant-chats', renderList, ['chats:changed']);
    addView('owner', 'owner-chats', renderList, ['chats:changed']);
    $('chat-input-field').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-send-message').click(); });

    bus.on('session:start', (u) => {
      unsubList?.();
      unsubList = onSnapshot(query(collection(db, 'chats'), where('participants', 'array-contains', u.uid)), (s) => {
        chats = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.lastAt?.seconds || 0) - (a.lastAt?.seconds || 0));
        bus.emit('chats:changed');
      }, console.error);
    });
    bus.on('session:end', () => { unsubList?.(); unsubMsgs?.(); unsubList = unsubMsgs = active = null; chats = []; });
    bus.on('chat:open', async ({ id }) => {
      const c = chats.find(x => x.id === id) || { id, ...(await getDoc(doc(db, 'chats', id))).data() };
      openRoom(c);
    });

    onAction('open-chat', (el) => { const c = chats.find(x => x.id === el.dataset.id); if (c) openRoom(c); });
    onAction('open-chat-apt', async (el) => {
      requireRole('tenant');
      const a = state.apartments.find(x => x.id === el.dataset.id); if (!a) throw new Error('Logement introuvable.');
      openRoom(await ensureChat(a, state.user.uid, state.user.name));
    });
    onAction('chat-close', () => {
      unsubMsgs?.(); unsubMsgs = null; active = null;
      const role = state.user.role;
      showScreen(role === 'owner' ? 'scr-owner-dashboard' : 'scr-tenant-dashboard');
      show(role, role === 'owner' ? 'owner-chats' : 'tenant-chats');
    });
    onAction('chat-send', async () => {
      const input = $('chat-input-field'), text = input.value.trim();
      if (!text || !active) return;
      input.value = '';
      try { await postMessage(active.id, text); } catch (e) { input.value = text; throw e; }
    });
  }
};
