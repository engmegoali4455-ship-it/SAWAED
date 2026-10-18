/* Service Worker — سواعد للإشراف الهندسي (يُولَّد بواسطة scripts/build-sw.mjs) */
const VERSION = '__VERSION__';
const CACHE = `sawaed-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('sawaed-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function withTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); }

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Supabase وغيره: مباشرة للشبكة

  // الملفات الثابتة ذات البصمة: من الذاكرة أولاً
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || /\.(woff2?|png|svg|webmanifest)$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })));
    return;
  }
  // الصفحات وحمولات RSC: الشبكة أولاً (بمهلة) ثم النسخة المخزنة متجاهلين ?id=...
  e.respondWith((async () => {
    try {
      const res = await withTimeout(fetch(req), 4000);
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    } catch {
      const cache = await caches.open(CACHE);
      const path = url.pathname.endsWith('/') || url.pathname.includes('.') ? url.pathname : url.pathname + '/';
      const hit = (await cache.match(req, { ignoreSearch: true })) || (await cache.match(path, { ignoreSearch: true }));
      if (hit) return hit;
      if (req.mode === 'navigate') return (await cache.match('/')) || Response.error();
      return Response.error();
    }
  })());
});

// الإشعارات
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'سواعد للإشراف الهندسي', {
    body: d.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', dir: 'rtl', lang: 'ar',
    tag: d.tag, data: { url: d.url || '/alerts/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
