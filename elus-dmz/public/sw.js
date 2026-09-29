/* Coque de l'espace des élus : l'application s'ouvre hors ligne. L'API n'est JAMAIS mise en cache ici (jetons, documents nominatifs) :
 * les documents sont conservés par l'application elle-même, dans un stockage propre à l'élu et purgé à la déconnexion. */
const COQUE = 'elus-coque-v2'; // v2 : purge les entrées de la v1, où un index.html servi à la place d'un script avait pu être mis en cache
const estHtml = (res) => (res.headers.get('content-type') || '').includes('text/html');
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(COQUE).then((c) => c.addAll(['./index.html']).catch(() => undefined))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('elus-coque-') && k !== COQUE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request; const u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return; // réseau seul pour l'API
  e.respondWith(fetch(r).then((res) => {
    // On ne met en cache que ce qui est cohérent avec ce qu'on a demandé : une page HTML sous le nom d'un script
    // (repli SPA d'un serveur mal configuré) empoisonnerait la coque et rejouerait la page blanche hors ligne.
    const page = u.pathname.endsWith('/') || u.pathname.endsWith('/index.html');
    const util = res.ok && (page ? estHtml(res) : !estHtml(res));
    if (util) { const copie = res.clone(); caches.open(COQUE).then((c) => c.put(r, copie)); }
    return res;
  }).catch(() => caches.match(r).then((c) => c || caches.match('./index.html'))));
});
