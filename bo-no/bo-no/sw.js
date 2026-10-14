const CACHE_VERSION = "bojo-shell-v2";
const APP_SHELL = "./index.html";
const ESSENTIAL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png"
];

const OFFLINE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BoJo Offline</title>
    <style>
      body { margin: 0; min-height: 100svh; display: grid; place-items: center; padding: 24px; color: #f5f5f4; background: #181616; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { max-width: 360px; }
      h1 { margin: 0 0 8px; font-family: Georgia, serif; }
      p { color: #b8afa6; line-height: 1.45; }
    </style>
  </head>
  <body>
    <main>
      <h1>BoJo is offline</h1>
      <p>The saved app shell was not available on this device yet. Reopen BoJo once while online so the journal can prepare its offline copy.</p>
    </main>
  </body>
</html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(ESSENTIAL_ASSETS.map((asset) => new Request(asset, { cache: "reload" })))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirstShell(event.request));
    return;
  }

  event.respondWith(cacheFirstAsset(event.request));
});

async function networkFirstShell(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(APP_SHELL, response.clone());
    return response;
  } catch {
    return (await cache.match(APP_SHELL)) ||
      (await cache.match("./")) ||
      new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    if (request.destination === "document") {
      return (await cache.match(APP_SHELL)) ||
        new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return new Response("", { status: 504, statusText: "Offline asset unavailable" });
  }
}
