/* sw.js - Kirby's Hardware POS Service Worker */
const CACHE_VERSION = 'kirby-pos-v1';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/tailwind.css',
  '/script.js',
  '/firebase.js',
  '/inventory.js',
  '/audit.js',
  '/pos.js',
  '/manifest.json',
  '/assets/logo.png',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/icon-maskable-192.png',
  '/assets/icons/icon-maskable-512.png'
];

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

// ---------- ACTIVATE — remove old caches ----------
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
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
  
  // CDN assets (fonts, Chart.js, Font Awesome) — cache-first
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
  
  // Same-origin — network-first, fall back to cache, then to index.html
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