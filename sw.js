const CACHE = "nearby-planner-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./src/app.js",
  "./src/db.js",
  "./src/domain.js",
  "./src/geocode.js",
  "./src/ics.js",
  "./src/i18n.js",
  "./src/ui.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event)=>{
  event.waitUntil(
    caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate", (event)=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.map(k=>k===CACHE?null:caches.delete(k)))).then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch", (event)=>{
  const req = event.request;
  const url = new URL(req.url);

  // Only cache same-origin GET
  if(req.method !== "GET" || url.origin !== self.location.origin){
    return;
  }

  // Network-first for geocoding to avoid stale results
  if(url.pathname.includes("nominatim")){
    event.respondWith(fetch(req).catch(()=>caches.match(req)));
    return;
  }

  event.respondWith(
    caches.match(req).then(cached=>{
      return cached || fetch(req).then(res=>{
        const copy = res.clone();
        caches.open(CACHE).then(cache=>cache.put(req, copy));
        return res;
      }).catch(()=>cached);
    })
  );
});
