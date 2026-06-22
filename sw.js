const CACHE_NAME = 'mock-matrix-v2';

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


