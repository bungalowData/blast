// ─────────────────────────────────────────
//  BLAST — service worker
// ─────────────────────────────────────────
//
// Trois rôles, dans l'ordre d'importance :
//  1. Recevoir les notifications push et les afficher, même page fermée.
//  2. Rendre la web-app installable (Chrome exige un service worker).
//  3. Garder une copie des pages pour un réseau de salle capricieux.
//
// Réseau d'abord, cache ensuite : pendant un spectacle on veut toujours la
// dernière version des pages, la copie ne sert que hors ligne. Seules les
// pages de ce site sont concernées ; le serveur (socket, votes), les polices
// et les images R2 passent sans détour.

importScripts('./js/blast-config.js');

const CACHE = 'blast-v1';
const SHELL = [
    './index_new.html',
    './chat.html',
    './tweet.html',
    './js/blast-config.js',
    './js/blast-phone.js',
    './manifest.webmanifest',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './favicon.ico',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.addAll(SHELL))
            .catch(e => console.warn('[sw] Pré-cache incomplet :', e))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

    event.respondWith(
        fetch(req)
            .then((res) => {
                if (res && res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE).then(cache => cache.put(req, copy));
                }
                return res;
            })
            .catch(() => caches.match(req, { ignoreSearch: true }))
    );
});

// ── Notifications push ──
self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; }
    catch (e) { data = { body: event.data ? event.data.text() : '' }; }

    event.waitUntil(self.registration.showNotification(data.title || 'BLAST', {
        body: data.body || '',
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        tag: data.tag || 'blast',
        renotify: true,
        vibrate: [300, 100, 300],
        data: { url: data.url || './index_new.html' },
    }));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = new URL((event.notification.data && event.notification.data.url) || './index_new.html',
        self.registration.scope).href;

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            // Une fenêtre BLAST déjà ouverte : on la ramène devant plutôt que d'en ouvrir une autre
            for (const c of clients) {
                if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
            }
            return self.clients.openWindow(target);
        })
    );
});

// Le navigateur a renouvelé l'abonnement de lui-même : on redéclare le nouveau.
self.addEventListener('pushsubscriptionchange', (event) => {
    const server = self.BLAST_SERVER;
    const post = (path, body) => fetch(server + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    event.waitUntil(
        fetch(server + '/push/public-key')
            .then(r => r.json())
            .then(({ publicKey }) => self.registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: b64ToBytes(publicKey),
            }))
            .then(sub => post('/push/subscribe', { subscription: sub.toJSON() }))
            .then(() => event.oldSubscription && post('/push/unsubscribe', { endpoint: event.oldSubscription.endpoint }))
            .catch(e => console.warn('[sw] Réabonnement impossible :', e))
    );
});

function b64ToBytes(b64) {
    let s = b64.replace(/-/g, '+').replace(/_/g, '/');
    s += '='.repeat((4 - s.length % 4) % 4);
    const raw = atob(s);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}
