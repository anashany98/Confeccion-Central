const CACHE = "confeccion-central-v2.1.0";
const STATIC = [
  "/",
  "/static/central.css",
  "/static/central.js",
  "/static/logic.js",
  "/static/vendor/xlsx.full.min.js",
  "/static/manifest.webmanifest",
  "/static/icon-192.png",
  "/static/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(STATIC))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Las llamadas a la API siempre van a la red, sin cache.
  if (url.pathname.startsWith("/api/") || event.request.method !== "GET")
    return;
  // Estrategia network-first para assets estáticos:
  // - Si la red funciona, sirve la versión actual y actualiza el cache.
  // - Si la red falla (offline), usa el cache como fallback.
  // Esto evita el problema de "JS cacheado apunta a endpoints nuevos".
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          caches
            .open(CACHE)
            .then((cache) => cache.put(event.request, copy))
            .catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
