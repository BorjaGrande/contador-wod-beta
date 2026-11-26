/* Contador WOD 2.2.5 — almacenamiento offline de la versión beta. */
// Aísla la caché por repositorio/ruta: dos apps Pages del mismo usuario comparten origen.
const SCOPE_ID = new URL(self.registration.scope).pathname.replace(/[^a-z0-9]/gi, '_');
const CACHE_PREFIX = `contador-wod-${SCOPE_ID}-`;
const CACHE_NAME = `${CACHE_PREFIX}v2.2.5`;
const OFFLINE_FILES = [
  './',
  './index.html',
  './modes.css',
  './modes.js',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(OFFLINE_FILES); // instalación atómica: no se activa con archivos incompletos
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const home = await cache.match(new URL('./index.html', self.registration.scope).href);
      return home || fetch(event.request);
    })());
  } else {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(event.request) || fetch(event.request);
    })());
  }
});
