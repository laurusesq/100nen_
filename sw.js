self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open('100nen').then(function(cache) {
            return cache.addAll([
                '/',
                '/index.html',
                '/script.js',
                '/style.css',
                '/manifest.json',
                '/icon.png'
            ]);
        })
    );
});

self.addEventListener('activate', function(event) {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function(event) {
    event.respondWith(
        caches.match(event.request).then(function(response) {
            return response || fetch(event.request);
        })
    );
});
