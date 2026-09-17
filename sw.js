// 오프라인 셸 캐시. 시세(data/*)는 항상 네트워크 우선.
const CACHE = 'proj210-v105';
const SHELL = ['.', 'index.html', 'style.css', 'favicon.svg', 'manifest.json',
  'icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'apple-touch-icon.png',
  'js/app.js', 'js/core.js', 'js/store.js', 'js/prices.js', 'js/engine.js',
  'js/util.js', 'js/chart.js', 'js/dropbox.js', 'js/sync.js', 'js/lock.js',
  'js/views-main.js', 'js/views-insight.js', 'js/views-write.js', 'js/views-funds.js',
  'js/views-virtual.js'];

// 새 버전을 심을 때는 반드시 **서버에서 새로** 받는다.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u =>
        fetch(new Request(u, { cache: 'reload' })).then(r => {
          if (!r.ok) throw new Error(`${u} ${r.status}`);
          return c.put(u, r);
        })
      )))
      .then(() => self.skipWaiting())
  );
});
// 옛 캐시 정리는 PROJ210 것(proj210-*)만. door9.github.io 주소를 메모앱과 함께 쓰므로
// 이름으로 가리지 않고 지우면 메모앱의 오프라인 사본까지 지운다(실제로 PC에서 메모앱이 오프라인에 안 열렸다).
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k.startsWith('proj210-') && k !== CACHE).map(k => caches.delete(k)))
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
