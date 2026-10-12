// Lantern service worker: everything the visitor needs is served from the phone's cache.
// App files and maps use "stale-while-revalidate": instant from cache (works offline),
// quietly refreshed when there is internet, so redeploys reach phones without a version bump.
// Bump this on every deploy that changes app files: phones then fetch the new version on their next visit.
const SHELL = "lantern-shell-v3";
const FILES = ["./", "index.html", "app.js", "styles.css", "manifest.json", "icon.svg", "vendor/jsQR.js", "venues/index.json", "config.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("lantern-shell-") && k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  // Any page load (including QR links like /#/venue/x/here/y) gets the app shell.
  const key = req.mode === "navigate" ? new URL("index.html", self.registration.scope).href : req;
  const map = url.pathname.match(/\/venues\/([^/]+)\/map\.json$/);
  const isImage = /\/venues\/[^/]+\/images\//.test(url.pathname);

  if (isImage) {
    // Photos never change name for a published pack; the page stores them in the pack cache.
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
    return;
  }

  const cacheName = map ? `lantern-pack-${decodeURIComponent(map[1])}` : SHELL;
  e.respondWith(caches.match(key, { ignoreSearch: true }).then((hit) => {
    const fresh = fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(cacheName).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(() => hit || Response.error());
    if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
    return fresh;
  }));
});
