const CACHE='watchlist-v5-6-1';
const PATCH='./watchlist-v5.6.1-patch.js?v=561';
const ASSETS=[
  './',
  './index.html',
  './watchlist-v5.6.1-patch.js',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-512.png'
];

function injectPatch(html){
  // This makes v5.6.1 work even if index.html itself was not manually edited.
  html = html.replace(/<title>[\s\S]*?<\/title>/i, '<title>Мой ватчлист · v5.6.1</title>');
  html = html.replace(/ВАШ ВАТЧЛИСТ\s*·\s*v\d+(?:\.\d+)?/i, 'ВАШ ВАТЧЛИСТ · v5.6.1');
  html = html.replace(/Версия\s+v\d+(?:\.\d+)?/i, 'Версия v5.6.1');
  html = html.replace(/\s*<script\s+src=["']\.\/watchlist-v5\.6(?:\.1)?-patch\.js[^>]*><\/script>\s*/ig, '\n');
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, `<script src="${PATCH}"></script>\n</body>`);
  } else {
    html += `<script src="${PATCH}"></script>`;
  }
  return html;
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{})));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const req = event.request;
  const url = new URL(req.url);

  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith((async()=>{
      try {
        // Always revalidate the HTML, then inject v5.6.1 before returning it.
        const resp = await fetch(req, {cache:'no-store'});
        const text = await resp.text();
        const transformed = injectPatch(text);
        const headers = new Headers(resp.headers);
        headers.set('content-type','text/html; charset=utf-8');
        headers.set('cache-control','no-store');
        const out = new Response(transformed, {status:resp.status, statusText:resp.statusText, headers});
        const cache = await caches.open(CACHE);
        cache.put('./index-v561.html', out.clone()).catch(()=>{});
        return out;
      } catch(e) {
        const cached = await caches.match('./index-v561.html');
        if (cached) return cached;
        return caches.match('./index.html');
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    try {
      const resp = await fetch(req, {cache:'no-store'});
      if (resp.ok && url.origin === self.location.origin) {
        const cache = await caches.open(CACHE);
        cache.put(req, resp.clone()).catch(()=>{});
      }
      return resp;
    } catch(e) {
      return (await caches.match(req)) || Response.error();
    }
  })());
});
