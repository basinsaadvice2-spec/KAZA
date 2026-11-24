const CACHE_NAME = 'kaza-shell-v3';
const APP_SHELL = [
  '/', '/index.html', '/manifest.webmanifest', '/variables.css', '/style.css',
  '/main.js', '/firebase.js', '/state.js', '/bus.js', '/ui.js', '/views.js',
  '/theme.js', '/auth.js', '/data.js', '/format.js', '/catalog.js', '/booking.js',
  '/owner.js', '/publish.js', '/notifications.js', '/pwa.js', '/payments.js',
  '/chat.js', '/chat-service.js', '/broadcast.js', '/follow.js', '/push-config.js',
  '/icons/kaza-192.png', '/icons/kaza-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('kaza-shell-') && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', response.clone()));
      return response;
    }).catch(async () => (await caches.match('/index.html')) || Response.error()));
    return;
  }

  if (!APP_SHELL.includes(url.pathname)) return;
  event.respondWith(caches.match(request).then(async (cached) => {
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) (await caches.open(CACHE_NAME)).put(request, response.clone());
    return response;
  }));
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { data: { body: event.data.text() } }; }
  const data = payload.data || {};
  const title = data.title || payload.notification?.title || 'KAZA';
  const body = data.body || payload.notification?.body || 'Une activité importante vous attend.';
  const query = new URLSearchParams();
  if (data.notificationId) query.set('notification', data.notificationId);
  if (data.tab) query.set('tab', data.tab);
  if (data.chatId) query.set('chatId', data.chatId);
  const queryString = query.toString();
  const target = `/${queryString ? `?${queryString}` : ''}`;
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icons/kaza-192.png',
    badge: '/icons/kaza-192.png',
    tag: data.notificationId ? `kaza-${data.notificationId}` : `kaza-${data.type || 'activity'}`,
    data: { target }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.target || '/', self.location.origin);
  const safeTarget = target.origin === self.location.origin ? target.href : self.location.origin + '/';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if ('focus' in client) {
        await client.navigate(safeTarget);
        return client.focus();
      }
    }
    return self.clients.openWindow(safeTarget);
  })());
});
