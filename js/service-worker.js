// ============================================================
//  MacroFit — service-worker.js
//  Mise en cache des fichiers essentiels pour l'installation PWA
//  et un minimum de fonctionnement hors ligne.
// ============================================================

const CACHE_NAME = 'macrofit-v1';

const FICHIERS_ESSENTIELS = [
  './',
  'index.html',
  'css/style.css',
  'js/storage.js',
  'js/macros.js',
  'js/drive-sync.js',
  'js/coach-sync.js',
  'manifest.json',
  'data/seed.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FICHIERS_ESSENTIELS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((noms) =>
      Promise.all(noms.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Cache d'abord, réseau ensuite (et met en cache ce qui est récupéré),
// avec repli sur index.html si totalement hors ligne. Ne touche qu'aux
// requêtes GET de même origine — les appels vers les API Google (Drive,
// Sheets, Identity) passent sans interception.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then((reponseCache) => {
      if (reponseCache) return reponseCache;
      return fetch(event.request)
        .then((reponseReseau) => {
          if (reponseReseau && reponseReseau.ok) {
            const clone = reponseReseau.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return reponseReseau;
        })
        .catch(() => caches.match('index.html'));
    })
  );
});
