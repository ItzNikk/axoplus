'use strict';

const CACHE_STATIC = 'vitalux-v3-static';
const CACHE_CDN    = 'vitalux-v3-cdn';

const STATIC_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/js/storage.js',
  '/js/motion.js',
  '/js/ai.js',
  '/js/charts.js',
  '/js/main.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

const CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// ── Install: pre-cache everything ────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const [staticCache, cdnCache] = await Promise.all([
        caches.open(CACHE_STATIC),
        caches.open(CACHE_CDN)
      ]);
      await staticCache.addAll(STATIC_FILES);
      await Promise.allSettled(CDN_URLS.map(url => cdnCache.add(url)));
      await self.skipWaiting();
    })()
  );
});

// ── Activate: purge old caches ───────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_CDN)
          .map(k => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// ── Fetch: tiered strategy ────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  const url = new URL(request.url);

  // 1. CDN resources → cache-first
  if (url.hostname.includes('jsdelivr') || url.hostname.includes('cdnjs')) {
    event.respondWith(cacheFirst(request, CACHE_CDN));
    return;
  }

  // 2. External API calls → network-only with 6s timeout
  if (url.hostname !== self.location.hostname) {
    event.respondWith(networkWithTimeout(request, 6000));
    return;
  }

  // 3. App shell → stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// ── Strategies ────────────────────────────────────────────────────
async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return offlineFallback();
  }
}

async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE_STATIC);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  // Return cached immediately, update in background
  return cached || (await fetchPromise) || offlineFallback();
}

async function networkWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    return response;
  } catch {
    clearTimeout(timer);
    return new Response(
      JSON.stringify({ error: 'Network unavailable', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

function offlineFallback() {
  return new Response(
    '<!DOCTYPE html><html><body style="background:#030306;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;text-align:center;"><div><div style="font-size:48px">⚡</div><h2 style="margin:16px 0 8px">Vitalux</h2><p style="color:rgba(255,255,255,0.5)">You are offline. Reconnect to continue.</p></div></body></html>',
    { status: 200, headers: { 'Content-Type': 'text/html' } }
  );
}
