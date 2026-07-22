// Service Worker — caches all app files for offline/PWA use
const CACHE = 'voice-translator-v5';

// CDN origins that host ML models (cache-first for offline use)
const MODEL_CDNS = [
  'cdn.jsdelivr.net',
  'huggingface.co',
];

const FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/translator.js',
  './js/cloud-stt.js',
  './js/offline-engine-v4.js',
  './js/app-v4.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
];

// Install — cache everything
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  // Note: we intentionally do NOT call clients.claim() here.
  // This ensures existing tabs continue using their cached version
  // without mismatch. New tabs will pick up the updated SW.
});

// Fetch — network-first for app files (always get latest), cache-first for models
self.addEventListener('fetch', (e) => {
  // Skip non-GET and API calls
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Don't cache API responses
  if (url.pathname.includes('/api/') || url.hostname.includes('googleapis') ||
      url.hostname.includes('mymemory') || url.hostname.includes('baidubce') ||
      url.hostname.includes('xfyun')) {
    return;
  }

  // Cache-first for ML model CDNs (large files, rarely change)
  const isModelCDN = MODEL_CDNS.some(cdn => url.hostname.includes(cdn));
  if (isModelCDN) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE).then((cache) => cache.put(e.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Network-first for app files (HTML/JS/CSS) — always get latest version
  e.respondWith(
    fetch(e.request).then((response) => {
      // Update cache with fresh version
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE).then((cache) => cache.put(e.request, clone));
      }
      return response;
    }).catch(() => {
      // Offline fallback: serve from cache
      return caches.match(e.request);
    })
  );
});
