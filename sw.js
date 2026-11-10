/* 業務研究室 v1.4.3 — 同じアプリの静的ファイルのみをオフライン保存。記録データは扱わない。 */
const APP_CACHE_PREFIX = 'gyomu-research-app-';
const APP_CACHE = APP_CACHE_PREFIX + 'v1.4.3';
const CORE = [
  './', './index.html', './styles.css?v=1.4.3', './app.js?v=1.4.3',
  './manifest.webmanifest', './icon.svg', './icon-192.png',
  './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'
];
const APP_SCOPE = new URL(self.registration.scope);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP_CACHE).then(cache => cache.addAll(CORE)));
  // A waiting worker is installed quietly. The user's edit is not reloaded mid-entry.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(APP_CACHE_PREFIX) && name !== APP_CACHE)
      .map(name => caches.delete(name)));
    // v1.3's generic legacy cache is deliberately left untouched: it might be shared
    // by a different project under the same github.io origin.
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== APP_SCOPE.origin || !url.pathname.startsWith(APP_SCOPE.pathname)) return;
  // Do not cache or proxy other sites or unrelated GitHub Pages repositories.
  event.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);
    // For app shell files, use the currently installed coherent version.
    const cached = await cache.match(req, {ignoreSearch: false});
    if (cached) return cached;
    // A GitHub Pages deep link navigates to the cached app entry when offline.
    if (req.mode === 'navigate') {
      try { const response = await fetch(req); if (response.ok) return response; } catch (_) {}
      return await cache.match('./index.html') || Response.error();
    }
    // Do not opportunistically cache arbitrary requests or private data.
    return fetch(req);
  })());
});
