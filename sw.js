const CACHE_VERSION = Date.now(); // ビルドタイムで変わる
const CACHE_NAME = `100nen-${CACHE_VERSION}`;

// キャッシュの登録
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll([
        '/',
        '/index.html',
        '/style.css',
        '/manifest.json',
        '/icon.png'
      ]);
    })
  );
});

// 古いキャッシュ削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 通常のフェッチ処理
self.addEventListener('fetch', event => {
  // script.js は常にネットワークから取得
  if (event.request.url.includes('script.js')) {
    return event.respondWith(fetch(event.request));
  }

  // それ以外はキャッシュ優先
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
