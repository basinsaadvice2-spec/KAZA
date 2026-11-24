import {
  db, collection, doc, query, where, orderBy, limit, onSnapshot, updateDoc, writeBatch,
  setDoc, deleteDoc, serverTimestamp, getMessaging, isSupported, register,
  unregister, onRegistered, onUnregistered, onMessage
} from './firebase.js';
import { state } from './state.js';
import { bus } from './bus.js';
import { $, esc, toast, onAction, openModal, closeModal } from './ui.js';
import { show } from './views.js';
import { FCM_VAPID_KEY } from './push-config.js';

const CATEGORIES = {
  listings: 'Nouvelles annonces',
  followedListings: 'Logements suivis',
  booking: 'Demandes et locations',
  chat: 'Messages',
  payment: 'Paiements',
  activity: 'Autres activités'
};
const DEFAULT_CATEGORIES = Object.fromEntries(Object.keys(CATEGORIES).map((key) => [key, true]));
const BELL = '<button class="circle-action-btn" data-action="open-notifs" aria-label="Ouvrir les notifications" style="position:relative"><i class="fa-solid fa-bell" aria-hidden="true"></i><span class="notif-badge" style="display:none;position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:9px;background:#ef4444;color:#fff;font-size:10px;font-weight:700;align-items:center;justify-content:center"></span></button>';
const MODAL = `<div id="notif-modal" class="modal-overlay" style="display:none"><div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="notif-title">
  <h3 id="notif-title">Notifications</h3>
  <section class="surface-box notification-settings">
    <h4>Notifications sur ce téléphone</h4><p id="push-status" class="muted-text"></p>
    <button id="push-enable" class="btn-action-trigger tenant-btn" type="button">Activer les notifications</button>
    <button id="push-disable" class="btn-action-trigger outline-btn" type="button" hidden>Désactiver sur cet appareil</button>
  </section>
  <section class="surface-box notification-settings"><h4>Préférences dans KAZA</h4><div id="notif-preferences"></div></section>
  <div id="notif-list"></div>
  <div class="modal-actions"><button class="btn-submit-form" style="background:var(--text-muted)" data-action="notif-close">Fermer</button><button class="btn-submit-form owner-theme" data-action="notif-readall">Tout marquer lu</button></div>
</div></div>`;
let list = [];
let unsub = null;
let pushContext = null;

function preferences() {
  const saved = state.user?.notificationPrefs || {};
  return { ...saved, categories: { ...DEFAULT_CATEGORIES, ...(saved.categories || {}) } };
}

function formatDate(timestamp) {
  const date = timestamp?.toDate?.();
  return date ? date.toLocaleString('fr-CD', { dateStyle: 'short', timeStyle: 'short' }) : '';
}

function paintPushStatus() {
  const status = $('push-status');
  const enable = $('push-enable');
  const disable = $('push-disable');
  if (!status) return;
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    status.textContent = 'Les notifications push ne sont pas prises en charge par ce navigateur.';
    enable.hidden = true;
    disable.hidden = true;
    return;
  }
  if (!FCM_VAPID_KEY) {
    status.textContent = 'Le service push attend la clé Web Push publique de Firebase. Le centre de notifications reste disponible.';
    enable.hidden = true;
    disable.hidden = true;
    return;
  }
  const localId = localStorage.getItem(`kaza.push.${state.user?.uid}`);
  if (Notification.permission === 'denied') {
    status.textContent = 'Les notifications sont bloquées dans les réglages du navigateur. Autorisez-les pour KAZA puis réessayez.';
    enable.hidden = false;
    disable.hidden = true;
  } else if (Notification.permission === 'granted' && localId) {
    status.textContent = 'Les notifications push sont activées sur cet appareil.';
    enable.hidden = true;
    disable.hidden = false;
  } else {
    status.textContent = 'Les notifications push sont désactivées sur cet appareil. Vous pouvez les activer quand vous le souhaitez.';
    enable.hidden = false;
    disable.hidden = true;
  }
}

function paintPreferences() {
  const box = $('notif-preferences');
  if (!box || !state.user) return;
  const prefs = preferences();
  box.innerHTML = Object.entries(CATEGORIES).map(([key, label]) => {
    const enabled = prefs.categories[key] !== false;
    return `<button class="notification-pref" type="button" data-action="notif-toggle-pref" data-pref="${key}" aria-pressed="${enabled}"><span>${esc(label)}</span><strong>${enabled ? 'Activé' : 'Désactivé'}</strong></button>`;
  }).join('');
}

function paint() {
  const unread = list.filter((item) => !item.read).length;
  document.querySelectorAll('.notif-badge').forEach((badge) => {
    badge.textContent = unread > 99 ? '99+' : unread;
    badge.style.display = unread ? 'flex' : 'none';
  });
  const box = $('notif-list');
  if (!box) return;
  box.innerHTML = list.length ? list.map((item) => `<button class="chat-list-item notification-item" type="button" data-action="notif-click" data-id="${esc(item.id)}" style="opacity:${item.read ? .58 : 1}">
    <span class="notification-unread" aria-hidden="true">${item.read ? '' : '●'}</span><span class="chat-info"><strong>${esc(item.title || 'Notification KAZA')}</strong><span>${esc(item.body || '')}</span><small>${esc(formatDate(item.createdAt))}</small></span>
  </button>`).join('') : '<div class="blank-slate"><i class="fa-solid fa-bell-slash"></i><p>Aucune notification.</p></div>';
  paintPushStatus();
  paintPreferences();
}

async function hashId(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function removeStoredFid(uid, id) {
  if (!uid || !id) return;
  await deleteDoc(doc(db, 'users', uid, 'pushTokens', id)).catch((error) => {
    if (error.code !== 'not-found') console.warn('[KAZA] Suppression du FID impossible', error.code || error);
  });
}

async function startPush(uid) {
  if (!FCM_VAPID_KEY || !navigator.onLine || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (!await isSupported()) return;
  if (pushContext?.uid === uid) return;
  if (pushContext) await stopPush();

  const messaging = getMessaging();
  const previousUid = localStorage.getItem('kaza.push.activeUid');
  if (previousUid && previousUid !== uid) {
    await removeStoredFid(previousUid, localStorage.getItem(`kaza.push.${previousUid}`));
    await unregister(messaging).catch(() => {});
    localStorage.removeItem(`kaza.push.${previousUid}`);
  }
  localStorage.setItem('kaza.push.activeUid', uid);
  const context = { uid, messaging, stops: [] };
  pushContext = context;
  const serviceWorkerRegistration = await navigator.serviceWorker.ready;
  if (pushContext !== context || state.user?.uid !== uid) return;

  context.stops.push(onRegistered(messaging, async (fid) => {
    const id = await hashId(fid);
    if (pushContext !== context || state.user?.uid !== uid) return;
    const oldId = localStorage.getItem(`kaza.push.${uid}`);
    if (oldId && oldId !== id) await removeStoredFid(uid, oldId);
    await setDoc(doc(db, 'users', uid, 'pushTokens', id), {
      fid,
      enabled: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    localStorage.setItem(`kaza.push.${uid}`, id);
    paintPushStatus();
  }));
  context.stops.push(onUnregistered(messaging, async (fid) => {
    const id = await hashId(fid);
    await removeStoredFid(uid, id);
    if (localStorage.getItem(`kaza.push.${uid}`) === id) localStorage.removeItem(`kaza.push.${uid}`);
    paintPushStatus();
  }));
  context.stops.push(onMessage(messaging, (payload) => {
    const title = payload.data?.title || 'KAZA';
    const body = payload.data?.body || '';
    toast(body ? `${title} — ${body}` : title, 'info');
  }));
  await register(messaging, { vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration });
}

async function stopPush() {
  const context = pushContext;
  if (!context) return;
  pushContext = null;
  const id = localStorage.getItem(`kaza.push.${context.uid}`);
  await unregister(context.messaging).catch((error) => console.warn('[KAZA] Désinscription push impossible', error.code || error));
  await removeStoredFid(context.uid, id);
  context.stops.forEach((stop) => stop());
  localStorage.removeItem(`kaza.push.${context.uid}`);
  if (localStorage.getItem('kaza.push.activeUid') === context.uid) localStorage.removeItem('kaza.push.activeUid');
}

function openLinkedNotification(notification) {
  const allowed = state.user.role === 'owner'
    ? ['owner-apparts', 'owner-payments', 'owner-broadcast', 'owner-chats']
    : ['catalog', 'my-rental', 'tenant-chats'];
  const tab = allowed.includes(notification.tab) ? notification.tab : null;
  closeModal('notif-modal');
  if (notification.chatId) {
    bus.emit('chat:open', { id: notification.chatId });
    return;
  }
  if (tab) {
    show(state.user.role, tab);
    if (notification.aptId) requestAnimationFrame(() => document.getElementById(`apartment-${notification.aptId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }
}

async function openNotification(notification) {
  if (!notification) return;
  if (!notification.read) await updateDoc(doc(db, 'notifications', notification.id), { read: true });
  openLinkedNotification(notification);
}

function handlePushRoute() {
  if (!state.user) return;
  const params = new URLSearchParams(location.search);
  const requestedId = params.get('notification');
  const requestedTab = params.get('tab');
  const chatId = params.get('chatId');
  if (!requestedId && !requestedTab && !chatId) return;
  const notification = requestedId && list.find((item) => item.id === requestedId);
  if (notification) {
    openNotification(notification).catch((error) => console.warn('[KAZA] Ouverture de la notification impossible', error));
  } else if (chatId) {
    bus.emit('chat:open', { id: chatId });
  } else if (requestedTab) {
    openLinkedNotification({ tab: requestedTab });
  }
  history.replaceState({}, '', `${location.pathname}${location.hash}`);
}

function activeFilters() {
  return {
    q: $('filter-search').value.trim().toLowerCase(),
    commune: $('filter-commune').value,
    maxPrice: Number($('filter-max-price').value) || 0,
    rateType: $('filter-rate-type').value,
    snel: $('filter-snel').value,
    water: $('filter-water').value,
    type: state.selectedTypeTag
  };
}

function hasSearchCriteria(search) {
  return Boolean(search.q || search.commune || search.maxPrice || search.rateType || search.snel || search.water || search.type);
}

export default {
  name: 'notifications',
  init() {
    document.querySelectorAll('#scr-owner-dashboard .header-utility-actions, #scr-tenant-dashboard .header-utility-actions').forEach((header) => header.insertAdjacentHTML('afterbegin', BELL));
    document.body.insertAdjacentHTML('beforeend', MODAL);
    onAction('open-notifs', () => { paint(); openModal('notif-modal'); });
    onAction('notif-close', () => closeModal('notif-modal'));
    onAction('notif-click', async (element) => openNotification(list.find((item) => item.id === element.dataset.id)));
    onAction('notif-readall', async () => {
      const unread = list.filter((item) => !item.read);
      for (let offset = 0; offset < unread.length; offset += 450) {
        const batch = writeBatch(db);
        unread.slice(offset, offset + 450).forEach((item) => batch.update(doc(db, 'notifications', item.id), { read: true }));
        await batch.commit();
      }
    });
    onAction('notif-toggle-pref', async (element) => {
      const key = element.dataset.pref;
      if (!(key in CATEGORIES)) return;
      const next = preferences();
      next.categories[key] = next.categories[key] === false;
      await updateDoc(doc(db, 'users', state.user.uid), { notificationPrefs: next });
      state.user.notificationPrefs = next;
      paintPreferences();
    });

    $('push-enable').addEventListener('click', async () => {
      if (!FCM_VAPID_KEY) return paintPushStatus();
      if (!('Notification' in window) || !('serviceWorker' in navigator)) return paintPushStatus();
      if (!navigator.onLine) return toast('Connectez-vous à Internet pour activer les notifications.', 'error');
      try {
        const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
        if (permission !== 'granted') return paintPushStatus();
        await startPush(state.user.uid);
        toast('Demande d’activation envoyée à Firebase.', 'ok');
      } catch (error) {
        console.error('[KAZA] Activation des notifications push impossible', error);
        toast('Impossible d’activer les notifications push. Vérifiez la configuration Firebase et la connexion.', 'error');
      }
      paintPushStatus();
    });
    $('push-disable').addEventListener('click', async () => {
      await stopPush();
      toast('Les notifications push sont désactivées sur cet appareil.', 'ok');
      paintPushStatus();
    });

    onAction('save-search', async () => {
      const search = activeFilters();
      if (!hasSearchCriteria(search)) throw new Error('Choisissez au moins un critère avant d’enregistrer une recherche.');
      await updateDoc(doc(db, 'users', state.user.uid), { savedSearch: search });
      state.user.savedSearch = search;
      toast('Recherche enregistrée. KAZA vous avertira des annonces correspondantes.', 'ok');
    });

    bus.on('session:start', (user) => {
      unsub?.();
      list = [];
      unsub = onSnapshot(query(collection(db, 'notifications'), where('toUid', '==', user.uid), orderBy('createdAt', 'desc'), limit(50)), (snapshot) => {
        list = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        paint();
        handlePushRoute();
      }, (error) => { console.error(error); toast(`Lecture des notifications refusée (${error.code}).`, 'error'); });
      if (FCM_VAPID_KEY && 'Notification' in window && Notification.permission === 'granted') {
        startPush(user.uid).catch((error) => console.warn('[KAZA] Synchronisation push impossible', error.code || error));
      }
    });
    bus.on('session:end', () => {
      unsub?.();
      unsub = null;
      list = [];
      paint();
      stopPush().catch((error) => console.warn('[KAZA] Nettoyage push impossible', error.code || error));
    });
  }
};
