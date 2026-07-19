/*
 * Samy School — Service Worker
 * ============================================================================
 * Purpose: makes the app installable ("Add to Home Screen" / standalone app
 * window) and speeds up loading by caching the app shell + static CDN
 * libraries. It deliberately does NOT cache Firebase/Firestore/Google API
 * calls — those must always hit the network so data stays real-time and
 * never goes stale or conflicts with the live sync the app depends on.
 *
 * Strategy:
 *   - index.html (the app itself): network-first, falls back to cache when
 *     offline, so everyone always gets your latest deployed changes the
 *     moment they're online, and something still opens when they're not.
 *   - Static libraries (React, fonts, QR libs, etc. from CDNs): cache-first,
 *     since those almost never change and caching them makes every load
 *     after the first noticeably faster.
 *   - Anything Firebase/Google (auth, firestore, calendar, oauth): always
 *     network, never cached, never intercepted.
 * ============================================================================
 */

const CACHE_NAME = 'samyschool-shell-v1';
const APP_SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

const NEVER_CACHE_HOSTS = [
  'firestore.googleapis.com',
  'firebaseapp.com',
  'googleapis.com',
  'google.com',
  'gstatic.com/firebasejs',
  'identitytoolkit.googleapis.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

function shouldBypass(url){
  return NEVER_CACHE_HOSTS.some((host) => url.includes(host));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return; // never intercept writes
  const url = req.url;
  if(shouldBypass(url)) return; // let Firebase/Google calls go straight to network, always

  const isNavigation = req.mode === 'navigate' || url.endsWith('/index.html') || url.endsWith('/');

  if(isNavigation){
    // Network-first for the app shell itself, so updates are picked up immediately.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first for static CDN libraries (React, fonts, QR libs, icons, etc.)
  event.respondWith(
    caches.match(req).then((cached) => {
      if(cached) return cached;
      return fetch(req).then((res) => {
        if(res && res.status === 200){
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
