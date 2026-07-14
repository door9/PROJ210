// 오프라인 셸 캐시. 시세(data/*)는 항상 네트워크 우선.
const CACHE = 'onefund-v6';
const SHELL = ['.', 'index.html', 'style.css', 'favicon.svg', 'manifest.json',
  'js/app.js', 'js/core.js', 'js/store.js', 'js/prices.js', 'js/engine.js',
  'js/util.js', 'js/chart.js', 'js/dropbox.js', 'js/sync.js',
  'js/views-main.js', 'js/views-insight.js', 'js/views-write.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/data/')) {
    // 시세: 네트워크 우선, 실패 시 캐시
    e.respondWith(
      fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return r;
      }).catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request))
    );
  }
});
