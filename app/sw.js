// Petfi service worker — makes the app installable + works offline.
// Strategy: network-first for our OWN files (so testers always get the
// newest version — no stale-app trap), falling back to cache when offline.
// Third-party calls (Supabase, OpenStreetMap, Amazon, the Supabase CDN)
// are left entirely to the browser.
const CACHE = 'petfi-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './petfi-icon.svg',
  './sounds/bark1.mp3', './sounds/bark2.mp3',
  './sounds/meow1.mp3', './sounds/meow2.mp3', './sounds/meow3.mp3',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})));
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
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(m => m || caches.match('./index.html')))
  );
});
