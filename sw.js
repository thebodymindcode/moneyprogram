/* Сервис-воркер: СЕТЬ В ПРИОРИТЕТЕ.
   Онлайн — всегда тянем свежие файлы (конец проблемам с кешем на телефоне и ноутбуке).
   Офлайн — отдаём последнюю сохранённую версию своих файлов.
   Трогаем только свои файлы; CDN (React, Supabase) и саму базу не перехватываем. */
const CACHE = 'mp-cache-v1';

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // чужие домены не трогаем
  e.respondWith((async function () {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      throw err;
    }
  })());
});
