const CACHE_NAME = 'gestao-moldes-v2';
const urlsToCache = [
  './index.html',
  './logo.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];

// Instalação do Service Worker (com tratamento para evitar falha total de cache)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Adiciona os ficheiros um a um para que uma falha isolada não quebre a instalação
        return Promise.allSettled(
          urlsToCache.map(url => cache.add(url).catch(err => console.log('Falha ao cachear:', url, err)))
        );
      })
      .then(() => self.skipWaiting())
  );
});

// Ativação e limpeza de caches antigas
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Interceção de pedidos (Modo Offline / Estratégia Stale-While-Revalidate ou Cache First)
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Retorna do cache se encontrar, senão busca na rede
        return response || fetch(event.request).then(networkResponse => {
          return caches.open(CACHE_NAME).then(cache => {
            // Opcional: guarda dinamicamente novos recursos na cache
            if (event.request.method === 'GET' && !event.request.url.includes('script.google.com')) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          });
        }).catch(() => {
          // Fallback caso esteja totalmente offline e o recurso não esteja em cache
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
