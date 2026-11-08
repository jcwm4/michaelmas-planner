/* Service worker: only shows push notifications (no offline caching here — the app handles that). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Planner', {
    body: d.body || '', tag: d.tag || 'planner', icon: 'icon-192.png', badge: 'icon-192.png',
    data: { hash: d.hash || 'dashboard' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.hash) || 'dashboard';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) { await w.focus(); w.postMessage({ type: 'open', hash }); return; }
    }
    await self.clients.openWindow(new URL(`./#${hash}`, self.registration.scope).href);
  })());
});
