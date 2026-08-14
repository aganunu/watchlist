const CACHE='watchlist-v5-2';
const CORE=['./manifest.webmanifest'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const req=e.request;if(req.method!=='GET')return; const url=new URL(req.url);
 if(url.origin===location.origin && (req.mode==='navigate'||url.pathname.endsWith('/index.html')||url.pathname.endsWith('/'))){
  e.respondWith(fetch(new Request(req,{cache:'no-store'})).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put('./index.html',copy));return res}).catch(()=>caches.match('./index.html')));return;
 }
 e.respondWith(caches.match(req).then(r=>r||fetch(req).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy));return res}).catch(()=>caches.match('./index.html'))));
});
