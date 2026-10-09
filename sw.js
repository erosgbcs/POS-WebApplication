/* sw.js - Kirby's Hardware POS Service Worker */
const CACHE_VERSION = 'kirby-pos-v2';

// Only truly static assets are precached. JS files are intentionally
// excluded — they change on every deploy and precaching them caused
// stale-code delivery. The fetch handler below still caches them
// opportunistically with strict revalidation.
const PRECACHE_URLS = [
  '/index.html',
  '/manifest.json',
  '/assets/logo.png',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/icon-maskable-192.png',
  '/assets/icons/icon-maskable-512.png'
];

// Same-origin application code that must never be served stale.
const NEVER_STALE_EXTENSIONS = /\.(js|css|html)$/i;

// ---------- INSTALL — precache app shell ----------
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE_URLS).catch(err => {
        console.warn('[SW] Some precache URLs failed:', err);
      }))
      .then(() => self.skipWaiting())
  );
});

// ---------- ACTIVATE — remove old caches, notify clients ----------
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(c =>
        c.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION })
      ))
  );
});

// ---------- FETCH — smart routing ----------
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // Never touch Firebase SDK / Firestore / Auth — they manage their own offline.
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com')
  ) {
    return;
  }

  // Same-origin app code (.js / .css / .html): always hit the network,
  // force the browser to bypass its own HTTP cache with 'no-cache',
  // fall back to the last cached copy only if the network fails.
  if (url.hostname === location.hostname && NEVER_STALE_EXTENSIONS.test(url.pathname)) {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cross-origin CDN assets (fonts, Chart.js, Font Awesome) — cache-first.
  if (url.hostname !== location.hostname) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(request, clone));
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Everything else same-origin (images, manifest) — network-first with cache fallback.
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(cached => {
          if (cached) return cached;
          if (request.mode === 'navigate') return caches.match('/index.html');
        })
      )
  );
});

// ---------- Manual update hook ----------
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});