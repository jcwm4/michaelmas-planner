/* Service worker: keeps the app itself available offline, and shows push notifications.
   App files: network first (so updates arrive straight away), falling back to the saved copy
   when there's no signal. PDFs and your data are saved separately by the app. */
const SHELL = 'planner-shell-v1';
const PRECACHE = ['./', 'index.html', 'app.js', 'style.css', 'manifest.json', 'selwyn-arms.svg', 'icon-180.png', 'icon-192.png',
  'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then(c => Promise.all(PRECACHE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))));
});
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('planner-shell-') && k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));

// one saved copy per file, whatever ?v= version it was loaded with
const keyFor = req => {
  if (req.mode === 'navigate') return new URL('index.html', self.registration.scope).href;
  const u = new URL(req.url); u.search = ''; return u.href;
};
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/api/') || url.pathname.endsWith('/slow')) return;   // GitHub API, CamCribs etc. go straight through
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const saved = await cache.match(keyFor(req));
    const net = fetch(req).then(res => {
      if (res.ok && res.type === 'basic') cache.put(keyFor(req), res.clone()).catch(() => {});
      return res;
    });
    if (!saved) return net;
    // slow or no connection: use the saved copy after a few seconds
    const timeout = new Promise(r => setTimeout(() => r(saved), 4000));
    return Promise.race([net.catch(() => saved), timeout]);
  })());
});

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
