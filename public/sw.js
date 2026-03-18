// ============================================================
// EmbyHub — Service Worker v1.1
// Solo cachea iconos — HTML y JS siempre desde la red
// ============================================================

const CACHE_NAME = 'embyhub-v2';
const ASSETS_ESTATICOS = [
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/favicon.ico',
];

// Instalar — solo cachear iconos
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_ESTATICOS))
  );
  self.skipWaiting();
});

// Activar — limpiar caches viejos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — solo servir desde caché los iconos, todo lo demás siempre desde la red
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Iconos desde caché
  if (url.pathname.startsWith('/icons/') || url.pathname === '/favicon.ico') {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
    return;
  }

  // Todo lo demás — siempre red, sin caché
});