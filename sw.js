// BCS Manager Service Worker
// Caches the app shell for offline use and fast loading.
// Version bump here forces cache refresh on next visit.
const CACHE_NAME = 'bcs-manager-v5';

// Core app shell files to cache on install
const PRECACHE_URLS = [
  '/bcs-manager/',
  '/bcs-manager/index.html',
  '/bcs-manager/manifest.json'
];

// Install — pre-cache the app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS).catch(err => {
        console.warn('Pre-cache failed (non-fatal):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate — clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first for API calls (Firebase), cache first for app shell
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go network-first for Firebase sync calls so data stays live
  if (url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('firebase') ||
      url.hostname.includes('openweathermap') ||
      url.hostname.includes('cdnjs') ||
      url.hostname.includes('jsdelivr')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Offline fallback — return cached version if available
        return caches.match(event.request);
      })
    );
    return;
  }

  // Cache-first for the app shell (HTML, manifest, icons)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // Return cached, but also update cache in background (stale-while-revalidate)
        const fetchPromise = fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => {});
        return cached;
      }
      // Not cached — fetch from network and cache it
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
