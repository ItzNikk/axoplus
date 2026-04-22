'use strict';

const CACHE  = 'vitalux-v2.0';
const CDN    = 'vitalux-cdn-v2';

const STATIC = [
  '/', '/index.html', '/css/style.css',
  '/js/storage.js', '/js/motion.js', '/js/ai.js', '/js/charts.js', '/js/main.js',
  '/manifest.json',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'
];

const CDN_URLS = ['https://cdn.jsdelivr.net/npm/chart.js'];

self.addEventListener('install', e => {
  e.waitUntil((async()=>{
    const s = await caches.open(CACHE);
    await s.addAll(STATIC);
    const c = await caches.open(CDN);
    await Promise.allSettled(CDN_URLS.map(u=>c.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE&&k!==CDN).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  const url = new URL(request.url);

  // CDN — cache first
  if (url.hostname.includes('jsdelivr') || url.hostname.includes('cdn')) {
    e.respondWith((async()=>{
      const c = await caches.open(CDN);
      return (await c.match(request)) || fetch(request).then(r=>{ if(r.ok)c.put(request,r.clone()); return r; });
    })());
    return;
  }

  // External API calls — network only with timeout
  if (url.hostname !== self.location.hostname) {
    e.respondWith(fetchWithTimeout(request, 5000));
    return;
  }

  // App shell — stale-while-revalidate
  e.respondWith((async()=>{
    const cache  = await caches.open(CACHE);
    const cached = await cache.match(request);
    const net    = fetch(request).then(r=>{ if(r.ok)cache.put(request,r.clone()); return r; }).catch(()=>null);
    return cached || await net || new Response('Offline', {status:503});
  })());
});

async function fetchWithTimeout(req, ms) {
  const ctrl  = new AbortController();
  const timer = setTimeout(()=>ctrl.abort(), ms);
  try { const r=await fetch(req,{signal:ctrl.signal}); clearTimeout(timer); return r; }
  catch { clearTimeout(timer); return new Response(JSON.stringify({error:'offline'}),{status:503,headers:{'Content-Type':'application/json'}}); }
}
