// Network-first service worker: always tries for the latest version, falls
// back to cache so solo play still works offline.
const CACHE = 'byterush-v1';
const CORE = [
  '/', '/index.html', '/style.css', '/manifest.webmanifest', '/icons/icon.svg',
  '/js/main.js', '/js/render.js', '/js/input.js', '/js/audio.js', '/js/store.js', '/js/net.js',
  '/shared/constants.js', '/shared/rng.js', '/shared/maze.js', '/shared/sim.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
