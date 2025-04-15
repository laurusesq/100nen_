
self.addEventListener('install', function(event) {
    console.log('[ServiceWorker] Installed');
    event.waitUntil(
        caches.open('100nen').then(function(cache) {
            return cache.addAll([
                '/',
                '/index.html',
                '/manifest.json',
                '/icon.png',
                '/style.css'
            ]);
        })
    );
});

self.addEventListener('activate', function(event) {
    console.log('[ServiceWorker] Activated');
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function(event) {
    console.log('[ServiceWorker] Fetch', event.request.url);
    event.respondWith(
        caches.match(event.request).then(function(response) {
            return response || fetch(event.request);
        })
    );
});
