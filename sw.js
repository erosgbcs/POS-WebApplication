/* sw.js — Kirby's POS Service Worker
 *
 * Offline-first design:
 *   1. APP SHELL is precached at install — index.html + every local
 *      JS/CSS/image the app needs. This is what lets the app boot
 *      from a cold offline reload.
 *   2. VERSIONED CDN ASSETS (Chart.js, Font Awesome, Google Fonts,
 *      Firebase SDK) are cached at runtime with cache-first semantics.
 *      Their URLs are pinned to specific versions, so they never
 *      change under us.
 *   3. LIVE API CALLS (Firestore, Firebase Auth) pass straight
 *      through to the network. The Firebase SDK has its own IndexedDB
 *      offline layer for those — we must not intercept them.
 *   4. VERSION SKEW is avoided by treating each release as a single
 *      atomic unit. New SW installs → precache everything → activate
 *      → delete old cache. Clients get the new version on next reload.
 */

// ---- Bump this string on every meaningful deploy ----
const CACHE_VERSION = 'kirby-pos-v17';

const APP_CACHE   = `${CACHE_VERSION}-app`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

// ---- App shell — precached at install. Must be same-origin. ----
// If any of these 404 at install, the whole precache fails. So this
// list must only include files we're certain exist.
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',

  // App code
  '/firebase.js',
  '/auth.js',
  '/inventory.js',
  '/audit.js',
  '/ai.js',
  '/script.js',
  '/pos.js',
  '/overview-enhancements.js',

  // Styles
  '/tailwind.css',
  '/style.css',

  // Brand assets
  '/assets/logo.png',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/icon-maskable-192.png',
  '/assets/icons/icon-maskable-512.png',
  '/assets/icons/favicon-32.png',
  '/assets/icons/favicon-16.png',
  '/assets/icons/icon-180.png',

  // Optional — if these exist, great; if not, install still succeeds
  // because we don't fail on 404s below.
  '/bg.jpg'
];

// ---- Versioned third-party assets — cache-first at runtime. ----
// Any URL starting with one of these prefixes gets cached on first use
// and served from cache thereafter. Bumping CACHE_VERSION clears them.
const VERSIONED_ASSET_ORIGINS = [
  'cdn.jsdelivr.net',           // Chart.js
  'cdnjs.cloudflare.com',       // Font Awesome
  'fonts.googleapis.com',       // Google Fonts CSS
  'fonts.gstatic.com',          // Google Fonts files
  'www.gstatic.com',            // Firebase SDK
];

// ---- Live data — never cache. Let the SDK handle offline. ----
const LIVE_DATA_ORIGINS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebaseio.com',
];

// ============================================================
// INSTALL — precache the app shell
// ============================================================
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);

    // Fetch each shell URL individually so one 404 doesn't kill install.
    // (addAll() is all-or-nothing — too brittle for real deploys.)
    await Promise.all(APP_SHELL.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) {
          await cache.put(url, res);
        } else {
          console.warn(`[SW] Shell asset ${url} responded ${res.status}`);
        }
      } catch (err) {
        console.warn(`[SW] Shell asset ${url} failed:`, err.message);
      }
    }));

    // Take over immediately — don't wait for old tabs to close.
    await self.skipWaiting();
  })());
});

// ============================================================
// ACTIVATE — clean old caches, claim clients, notify them
// ============================================================
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k !== APP_CACHE && k !== ASSET_CACHE)
        .map(k => caches.delete(k))
    );

    await self.clients.claim();

    // Tell every open tab a new version is live. script.js listens
    // for this and can show a "Reload to update" toast.
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => client.postMessage({
      type: 'SW_UPDATED',
      version: CACHE_VERSION
    }));
  })());
});

// ============================================================
// FETCH — routing
// ============================================================
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only GET requests are cacheable.
  if (request.method !== 'GET') return;

  // Never touch live data — Firebase SDK owns offline for those.
  if (LIVE_DATA_ORIGINS.some(h => url.hostname.includes(h))) return;

  // Versioned third-party assets — cache-first.
  if (VERSIONED_ASSET_ORIGINS.some(h => url.hostname.includes(h))) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // Cross-origin requests we don't recognize — let them through.
  if (url.origin !== location.origin) return;

  // Navigation requests (opening / or /index.html or any SPA route).
  // Serve the cached shell immediately, refresh it in the background.
  if (request.mode === 'navigate') {
    event.respondWith(staleWhileRevalidateShell(request));
    return;
  }

  // Same-origin static assets (JS, CSS, images) — cache-first.
  // Since the SW precaches the shell, everything here should be
  // available offline. Fall back to network for anything missed.
  event.respondWith(cacheFirst(request, APP_CACHE));
});

// ============================================================
// Strategies
// ============================================================

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    // Kick off a background refresh only for cross-origin assets.
    // Same-origin app code should NOT silently update mid-session —
    // version skew would break the running app.
    const isCrossOrigin = new URL(request.url).origin !== location.origin;
    if (isCrossOrigin) {
      refreshInBackground(request, cache);
    }
    return cached;
  }

  try {
    const res = await fetch(request);
    if (res.ok) {
      cache.put(request, res.clone());
    }
    return res;
  } catch (err) {
    // Nothing cached, no network — return a transparent 1x1 PNG
    // or a minimal 204 for images, a plain empty response otherwise.
    return offlineFallback(request);
  }
}

async function staleWhileRevalidateShell(request) {
  const cache = await caches.open(APP_CACHE);

  // Serve the cached shell if we have it. On a cold offline boot
  // this is the difference between "app loads" and "app is dead".
  const cached = await cache.match('/index.html') || await cache.match('/');

  // Always try to refresh in the background (even offline — the
  // fetch will just fail silently).
  const networkPromise = fetch(request)
    .then(res => {
      if (res.ok) cache.put('/index.html', res.clone());
      return res;
    })
    .catch(() => null);

  // Prefer cached — but if there's no cache, wait for network.
  if (cached) return cached;

  const fresh = await networkPromise;
  if (fresh) return fresh;

  return new Response(
    '<!doctype html><meta charset=utf-8><title>Offline</title>' +
    '<body style="font-family:system-ui;padding:2rem;text-align:center">' +
    '<h1>Offline</h1><p>The app could not be loaded offline. ' +
    'Please open it once while online to enable offline mode.</p>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

function refreshInBackground(request, cache) {
  // Fire-and-forget. If it fails, we keep the cached version.
  fetch(request)
    .then(res => { if (res.ok) cache.put(request, res.clone()); })
    .catch(() => {});
}

function offlineFallback(request) {
  const accept = request.headers.get('accept') || '';

  if (accept.includes('image/')) {
    // Transparent 1x1 PNG
    const bytes = Uint8Array.from(atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII='
    ), c => c.charCodeAt(0));
    return new Response(bytes, {
      headers: { 'Content-Type': 'image/png' }
    });
  }

  return new Response('', { status: 504, statusText: 'Offline' });
}

// ============================================================
// Message hook — allow the app to force-update
// ============================================================
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    );
  }
});