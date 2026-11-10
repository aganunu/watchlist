const CACHE = 'watchlist-beta15-pwa-1';
const CACHE_PREFIX = 'watchlist-';
const BUILD_MARKER = 'beta15-pwa-1';
const BUILD_META_PATTERN = /<meta\b(?=[^>]*\bname\s*=\s*["']watchlist-build["'])(?=[^>]*\bcontent\s*=\s*["']beta15-pwa-1["'])[^>]*>/i;
const ROOT_URL = new URL('./', self.location.href).href;
const INDEX_URL = new URL('./index.html', self.location.href).href;
const ROOT_PATH = new URL(ROOT_URL).pathname;
const INDEX_PATH = new URL(INDEX_URL).pathname;
const CORE_URLS = [
  INDEX_URL,
  new URL('./manifest.webmanifest', self.location.href).href,
  new URL('./icon-180.png', self.location.href).href,
  new URL('./icon-512.png', self.location.href).href,
];
const STATIC_PATHS = new Set(CORE_URLS.map(url => new URL(url).pathname));
const BASE_URLS = new Set([
  'https://raw.githubusercontent.com/aganunu/watchlist/60a72abc567dd3b95c4cbd21d5b960a78e2b6c5f/index.html',
  'https://cdn.jsdelivr.net/gh/aganunu/watchlist@60a72abc567dd3b95c4cbd21d5b960a78e2b6c5f/index.html',
]);

async function fetchFresh(url) {
  const response = await fetch(new Request(url, {cache: 'reload'}));
  if (!response.ok) throw new Error(`Failed to cache ${new URL(url).pathname}: ${response.status}`);
  return response;
}

async function responseHasCurrentBuild(response) {
  try {
    return BUILD_META_PATTERN.test(await response.clone().text());
  } catch (error) {
    return false;
  }
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const canonical = await fetchFresh(INDEX_URL);
    if (!(await responseHasCurrentBuild(canonical))) {
      throw new Error(`Canonical shell is missing build marker ${BUILD_MARKER}`);
    }
    const cache = await caches.open(CACHE);
    await cache.put(INDEX_URL, canonical);
    await Promise.all(CORE_URLS
      .filter(url => url !== INDEX_URL)
      .map(async url => cache.put(url, await fetchFresh(url))));
    await Promise.allSettled([...BASE_URLS].map(async url => {
      const response = await fetchFresh(url);
      await cache.put(url, response);
    }));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, {cache: 'no-store'});
        const isCanonical = url.pathname === ROOT_PATH || url.pathname === INDEX_PATH;
        if (response.ok && isCanonical && await responseHasCurrentBuild(response)) {
          const cache = await caches.open(CACHE);
          await cache.put(INDEX_URL, response.clone());
        }
        return response;
      } catch (error) {
        return (await caches.match(INDEX_URL)) || Response.error();
      }
    })());
    return;
  }

  if (BASE_URLS.has(url.href)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })());
    return;
  }

  if (url.origin !== self.location.origin || !STATIC_PATHS.has(url.pathname)) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request, {cache: 'no-store'});
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      return (await caches.match(request)) || Response.error();
    }
  })());
});
