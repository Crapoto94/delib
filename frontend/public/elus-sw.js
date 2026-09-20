/* Coque de l'espace des élus : l'application s'ouvre hors ligne. L'API n'est JAMAIS mise en cache ici (jetons, documents nominatifs) :
 * les documents sont conservés par l'application elle-même, dans un stockage propre à l'élu et purgé à la déconnexion. */
const COQUE = 'elus-coque-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(COQUE).then((c) => c.addAll(['./elus.html']).catch(() => undefined))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('elus-coque-') && k !== COQUE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request; const u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return; // réseau seul pour l'API
  e.respondWith(fetch(r).then((res) => { if (res.ok && (u.pathname.includes('/assets/') || u.pathname.endsWith('elus.html'))) { const copie = res.clone(); caches.open(COQUE).then((c) => c.put(r, copie)); } return res; })
    .catch(() => caches.match(r).then((c) => c || caches.match('./elus.html'))));
});
