// BCS Manager Service Worker
// Caches the app shell for offline use and fast loading.
// Version bump here forces cache refresh on next visit.
const CACHE_NAME = 'bcs-manager-v114';

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

  // Only handle plain http(s) requests. Browser extensions (ad blockers,
  // password managers, etc.) sometimes make their own requests using
  // schemes like chrome-extension:// that can end up passing through this
  // handler — the Cache API can't store those and throws if we try, so just
  // let the browser handle them natively instead of touching them at all.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // Firebase requests: don't intercept these at all. They're dynamic data
  // calls the app's own JS already handles directly, with its own timeouts
  // and retries — there's nothing useful to cache here (the data changes on
  // every save), so intercepting just adds a second, redundant network
  // attempt with no working fallback. On a slow or flaky connection, that
  // extra attempt failing was reporting a false hard failure back to the
  // app even when the app's own request might have succeeded — which is
  // exactly the kind of thing that could make a delete silently not reach
  // Firebase, only to have the old data resurface on the next sync.
  if (url.hostname.includes('firebaseio.com') || url.hostname.includes('firebase')) {
    return;
  }

  // CDN assets and the weather API: network-first, but WITH a fallback that
  // always resolves to a real Response (never undefined) — returning
  // undefined here is exactly what used to crash with "Failed to convert
  // value to 'Response'" whenever nothing had been cached yet.
  if (url.hostname.includes('openweathermap') ||
      url.hostname.includes('cdnjs') ||
      url.hostname.includes('jsdelivr')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(event.request).then(cached =>
          cached || new Response(null, {status: 503, statusText: 'Offline'})
        )
      )
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
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)).catch(() => {});
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
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)).catch(() => {});
        return response;
      }).catch(() => new Response(null, {status: 503, statusText: 'Offline'}));
    })
  );
});
