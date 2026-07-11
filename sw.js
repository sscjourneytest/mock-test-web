const CACHE_NAME = 'mock-matrix-v3';

// Install event
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// Activate event — clean up old cache versions and take control of
// any already-open pages immediately (previously missing entirely,
// meaning a freshly-installed SW wouldn't control open tabs until a
// full reload).
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) =>
            Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
        ).then(() => self.clients.claim())
    );
});

// Fetch event — network-first, falls back to cache when offline.
// FIX: the previous version only ever READ from cache
// (caches.match) but never WROTE anything into it — meaning the
// cache was permanently empty and offline fallback could never
// actually serve anything. This version caches every successful
// response as it comes in, so there's something real to fall back to.
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return; // don't try to cache POSTs etc.

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Only cache valid, same-origin-ish responses.
                if (response && response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});

// ============================================================
// PUSH NOTIFICATIONS
// Fires even when the site/app is fully closed, as long as the
// service worker is registered and the OS delivers the push.
// ============================================================
self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { title: 'Mock Matrix Hub', body: event.data ? event.data.text() : 'New update available' };
    }

    const title = data.title || 'Mock Matrix Hub';
    const options = {
        body: data.body || '',
        icon: data.icon || '/icons/icon-192.png',
        badge: '/icons/icon-192.png', // small monochrome icon shown in status bar (Android)
        data: {
            url: data.url || '/',
            notificationId: data.notificationId || null
        },
        vibrate: [200, 100, 200]
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// ============================================================
// NOTIFICATION CLICK
// Opens the specific url from the payload. If a tab is already
// open on this site, it focuses & navigates that tab instead of
// opening a duplicate one.
// ============================================================
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (const client of windowClients) {
                // If any open tab belongs to our origin, reuse it.
                const clientUrl = new URL(client.url);
                const targetOrigin = new URL(targetUrl, self.location.origin).origin;
                if (clientUrl.origin === targetOrigin && 'focus' in client) {
                    client.navigate(targetUrl);
                    return client.focus();
                }
            }
            // No existing tab — open a new one.
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});

