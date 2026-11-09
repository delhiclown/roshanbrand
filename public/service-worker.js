const CACHE_NAME = 'roshanbrand-v1';
const PRECACHE_URLS = [
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/favicon-192.png',
];
const STATIC_ASSET_PATTERN = /\.(?:avif|css|eot|gif|ico|jpe?g|js|mjs|png|svg|webp|woff2?)$/i;
const NEVER_CACHE_PATH_PART = /(?:^|\/|[-_.])(?:admin|api|auth|checkout|login|order|orders|payment|payments|server-time|utr|wallet)(?=$|\/|[-_.])/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('roshanbrand-') && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

function isNeverCache(url) {
  return NEVER_CACHE_PATH_PART.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    isNeverCache(url) ||
    url.pathname === '/service-worker.js' ||
    url.pathname === '/site.webmanifest'
  ) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const offlinePage = await cache.match('/offline.html');
        return offlinePage || Response.error();
      })
    );
    return;
  }

  if (!STATIC_ASSET_PATTERN.test(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(request);
      if (cachedResponse) return cachedResponse;

      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        await cache.put(request, response.clone());
      }
      return response;
    })
  );
});
