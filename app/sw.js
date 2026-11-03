// Petfi service worker — makes the app installable + works offline.
// Strategy: network-first for our OWN files (so members always get the
// newest version — no stale-app trap), falling back to the cache when the
// network is down or slower than NETWORK_TIMEOUT_MS. Only good (2xx)
// responses are cached, so an error page can never replace the app shell.
// Third-party calls (Supabase, OpenStreetMap, Amazon, the Supabase CDN)
// are left entirely to the browser.
const CACHE = 'petfi-v14';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './petfi-icon.svg', './store.json',
  './brand/petfi-wordmark-sm.webp', './brand/petfi-wordmark-sm.png',
  './brand/petfi-wordmark-white-sm.webp', './brand/petfi-wordmark-white-sm.png',
  './icons/petfi-192.png', './icons/petfi-512.png',
];
// Sounds (337 KB of mp3) are cached the first time they play, not up front.
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', e => {
  self.skipWaiting();
  // One missing file must not sink the whole precache
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only handle our own origin — never touch Supabase/OSM/Amazon/CDN traffic.
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = async () => (await cache.match(req)) || (req.mode === 'navigate' ? cache.match('./index.html') : undefined);
    const net = fetch(req);
    let timer;
    const slow = new Promise(resolve => { timer = setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS); });
    try {
      const res = await Promise.race([net, slow]);
      clearTimeout(timer);
      if (res && res.ok) { cache.put(req, res.clone()).catch(() => {}); return res; }
      if (res) return (await cached()) || res; // 4xx/5xx: a cached good copy beats an error page
      // Slow network: serve the cached copy now and refresh it when the fetch lands
      const c = await cached();
      if (c) { net.then(r => { if (r.ok) cache.put(req, r.clone()).catch(() => {}); }).catch(() => {}); return c; }
      return await net;
    } catch (err) {
      clearTimeout(timer);
      const c = await cached();
      return c || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});

// Web Push from petfi-push: care reminders and calendar alerts, app open or not
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Petfi', body: e.data ? e.data.text() : '' }; }
  const title = String(d.title || 'Petfi').slice(0, 120);
  const tag = String(d.tag || 'petfi');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    // Messages, friend requests, likes… already pop up inside the open app:
    // while Petfi is on screen, don't ring the phone for them too
    if (tag.indexOf('srv:') === 0 && list.some(c => c.visibilityState === 'visible' && c.focused)) return;
    return self.registration.showNotification(title, {
      body: String(d.body || '').slice(0, 300),
      tag,
      icon: 'icons/petfi-192.png',
      badge: 'icons/petfi-192.png',
      data: { url: './' },
    });
  }));
});

// A tap on a notification brings the app forward
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => 'focus' in c);
    return open ? open.focus() : self.clients.openWindow('./');
  }));
});
