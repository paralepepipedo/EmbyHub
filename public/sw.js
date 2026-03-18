// ============================================================
// EmbyHub — Service Worker
// Permite instalación como PWA
// Cache básico para assets estáticos
// ============================================================

const CACHE_NAME = 'embyhub-v1';
const ASSETS = [
  '/',
  '/portal',
  '/css/styles.css',
  '/css/mobile.css',
  '/js/auth.js',
  '/js/peliculas.js',
  '/js/series.js',
  '/js/buscar.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Instalar — cachear assets estáticos
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
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

// Fetch — network first, cache como fallback para assets
self.addEventListener('fetch', e => {
  // Solo interceptar GET
  if (e.request.method !== 'GET') return;

  // Las llamadas a la API siempre van a la red
  if (e.request.url.includes('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Actualizar caché con respuesta fresca
        const resClone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, resClone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
