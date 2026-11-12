/* Service Worker：アプリ本体をキャッシュしてオフラインでも起動できるようにする。
 * - 取得は「ネットワーク優先、失敗したらキャッシュ」なので、更新は次回オンライン時に自動反映される
 * - 外部API（書誌情報・表紙画像）は対象外（同一オリジンのみ扱う）
 * - BUILD_ID と PRECACHE は scripts/build.mjs がビルド時に置き換える
 * - パスはすべて SW 自身の場所（scope）基準なので、GitHub Pages のサブパスでも動く
 */
const BUILD_ID = '__BUILD_ID__';
const PRECACHE = /*__PRECACHE__*/ [];
const CACHE = 'ehon-label-maker-' + BUILD_ID;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new URL(p, self.registration.scope).href)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ehon-label-maker-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then(
          (hit) => hit || (req.mode === 'navigate' ? caches.match(new URL('./index.html', self.registration.scope).href) : Response.error())
        )
      )
  );
});
