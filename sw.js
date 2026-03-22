const CACHE_NAME = 'mock-matrix-v1';

// Install event
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// Fetch event (Always gets latest from web - Auto-Update)
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).catch(() => {
            return caches.match(event.request);
        })
    );
});
