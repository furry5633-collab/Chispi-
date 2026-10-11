/* =====================================================================
   Chispi · Service Worker
   - Cachea el shell (index.html, manifest). Todo lo demás (modelos de
     visión, fuentes de IA) lo cachea el runtime on-the-fly.
   - /api/* NUNCA se cachea: sin internet el robot usa sus respuestas
     locales y sigue siendo adorable.
   - Offline: navegación -> index.html cacheado.
   ===================================================================== */
const VERSION = 'chispi-v1-0-3';   // súbela cuando cambies index.html: así el móvil no se queda con el viejo
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // addAll falla entero si un recurso falla: los añadimos uno a uno.
    await Promise.all(SHELL_ASSETS.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); } catch (e) { /* offline en install: seguimos */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k.startsWith('chispi-') && !k.startsWith(VERSION)) ? caches.delete(k) : null));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Estrategia: cache-first con relleno en segundo plano para estáticos;
// network-first para el documento si hay red (para recibir updates).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // La API de IA va siempre a la red (y si no hay red, el cliente se apaña).
  if (url.pathname.startsWith('/api/')) return;

  // Recursos externos (modelos de visión, CDNs): cache-first + runtime cache.
  if (url.origin !== self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(req, { ignoreVary: true, ignoreSearch: false });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch (e) {
        return hit || Response.error();
      }
    })());
    return;
  }

  // Documento: network-first (update fresco), con fallback a caché.
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      try {
        const fresh = await fetch(req);
        cache.put('./index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch (e) {
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Resto del mismo origen: cache-first.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) {
      fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); }).catch(() => {});
      return hit;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok && url.origin === self.location.origin) cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (e) {
      return Response.error();
    }
  })());
});
