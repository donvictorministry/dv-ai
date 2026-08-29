// DV Ai — Service Worker
// Caches the app shell for offline load. API calls (network-dependent
// AI/chat sync) always go to network — offline mode is shell-only.

const DV_CACHE_NAME = "dv-ai-shell-v1";

const DV_SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./scripts/app.js",
  "./scripts/api.js",
  "./scripts/storage.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(DV_CACHE_NAME).then((cache) => cache.addAll(DV_SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== DV_CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls — always network, so auth/chat/AI stay live.
  if (url.pathname.startsWith("/api/") || url.hostname.includes("workers.dev") || url.pathname.includes("/api/")) {
    return;
  }

  // Only handle same-origin GET requests for the app shell.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(DV_CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});