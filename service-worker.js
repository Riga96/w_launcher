/**
 * service-worker.js — Network-first caching for fresh GitHub Pages updates.
 *
 * Offline mode is not required. Critical app files always prefer the network.
 * Old caches are cleared on activate.
 */

const CACHE_NAME = 'webtoon-launcher-v4';

/** Paths that must always try the network first. */
function isNetworkFirst(url) {
  const path = url.pathname.toLowerCase();
  return (
    path.endsWith('/index.html')
    || path.endsWith('/webtoon-launcher.html')
    || path.endsWith('/service-worker.js')
    || path.endsWith('/version.json')
    || path.endsWith('/manifest.json')
    || path.includes('/js/app.js')
    || path.includes('/js/ui.js')
    || path.includes('/js/storage.js')
    || path.includes('/js/parser.js')
    || path.includes('/js/launcher.js')
    || path.includes('/js/site-finder.js')
    || path.includes('/js/updater.js')
    || path.includes('/js/version.js')
    || path.includes('/css/style.css')
  );
}

/**
 * Network-first fetch with optional cache fallback for critical files only.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error('Network unavailable');
  }
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http')) return;

  if (isNetworkFirst(url)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
