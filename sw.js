// オフラインでも開けるように、アプリの部品を保存しておく。
// 通信できるときは最新を取りにいき、できないときは保存しておいたものを使う。
const CACHE = 'memo-v8';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'img/main.webp', 'img/angel.webp', 'img/devil.webp',
  'img/spine.webp', 'img/shelf-top.webp', 'img/shelf-mid.webp', 'img/shelf-base.webp',
  'img/vine-tl.webp', 'img/vine-tr.webp', 'img/vine-bl.webp', 'img/vine-br.webp',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
