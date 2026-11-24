// Keeps the sign-in code (React, Privy) and the app files on the phone so repeat visits open fast.
const C = 'ajolabs-v24';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const cdn = u.host === 'esm.sh';
  const own = u.origin === location.origin && /\.(js|css|jpg|png|svg)$/.test(u.pathname) && u.pathname !== '/sw.js';
  if (!cdn && !own) return;
  e.respondWith(caches.open(C).then(async c => {
    const hit = await c.match(e.request);
    if (own) {   // our own files: newest version first, saved copy only if the network is slow or down
      const fresh = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; });
      return Promise.race([fresh, new Promise(res => setTimeout(() => res(hit), 8000))]).then(r => r || fresh).catch(() => hit);
    }
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;     // cached copy shows instantly, and is refreshed in the background
  }));
});
