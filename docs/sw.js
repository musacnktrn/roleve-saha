const rev="cd1781292964bfac", assets=["./index.html", "./app.js", "./manifest.webmanifest", "./geometry/actions.js", "./geometry/ceiling.js", "./geometry/core.js", "./geometry/measure.js", "./storage/actions.js", "./storage/github/bundle.js", "./storage/github/classic.js", "./storage/local.js", "./storage/media.js", "./storage/merge.js", "./storage/store.js", "./views/actions.js", "./views/drawing.js", "./views/dxf-base.js", "./views/export.js", "./views/ifc.js", "./views/model.js", "./views/render.js", "./views/section.js", "./ui/base.js", "./ui/corner-drag.js", "./ui/demo.js", "./ui/dialog.js", "./ui/gestures.js", "./ui/github-card.js", "./ui/github-workspace.js", "./ui/layout.js", "./ui/orbit.js", "./ui/pdf-image.js", "./ui/photo-import.js", "./ui/photo-placement.js", "./ui/plan.js", "./ui/sections.js", "./ui/sketch.js", "./ui/style.css", "./ui/survey.js", "./ui/vertical-tools.js", "./photo/annotations.js", "./photo/codec/format.js", "./photo/codec/heic-worker.js", "./photo/editor.css", "./photo/editor.js", "./photo/gestures.js", "./openings/drawing.js", "./openings/editor.css", "./openings/editor.js", "./assets/dm-sans.woff2", "./assets/heic/libheif.js", "./assets/heic/libheif.wasm", "./assets/icon-192.png", "./assets/icon-512.png", "./assets/mark.svg", "./assets/pdfjs/pdf.min.mjs", "./assets/pdfjs/pdf.worker.min.mjs"];
const scope=new URL(self.registration.scope).pathname;
const prefix='roleve-saha:'+scope+':', cacheName=prefix+rev;
const allowed=new Set(assets.map(a=>new URL(a,self.registration.scope).href));
self.addEventListener('install',e=>{
  e.waitUntil((async()=>{const cache=await caches.open(cacheName);try{await cache.addAll(assets.map(a=>new Request(a,{cache:'reload'})));}catch(err){await caches.delete(cacheName);throw err;}})());
});
self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith(prefix)&&name!==cacheName)await caches.delete(name);await self.clients.claim();})());
});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||!u.pathname.startsWith(scope))return;
  const home=u.pathname===scope||u.pathname===scope+'index.html';
  if(e.request.mode==='navigate'&&home){e.respondWith((async()=>{const cache=await caches.open(cacheName);return await cache.match(new URL('index.html',self.registration.scope).href)||fetch(e.request);})());return;}
  if(!allowed.has(u.href))return;
  e.respondWith((async()=>{const cache=await caches.open(cacheName);return await cache.match(e.request)||fetch(e.request);})());
});

