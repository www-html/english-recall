const CACHE_NAME = 'english-recall-v3'
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/pwa-icon.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const responses = await Promise.all(
        APP_SHELL.map(async (url) => [url, await fetch(url)]),
      )
      await Promise.all(
        responses.map(([url, response]) => cache.put(url, response.clone())),
      )

      const indexResponse = responses.find(([url]) => url === '/index.html')?.[1]
      if (!indexResponse) return
      const indexHtml = await indexResponse.text()
      const assetUrls = Array.from(
        indexHtml.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g),
        (match) => match[1],
      )
      await cache.addAll(assetUrls)
      await self.skipWaiting()
    }),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          const copy = response.clone()
          const cache = await caches.open(CACHE_NAME)
          await cache.put('/index.html', copy)
          return response
        })
        .catch(() => caches.match('/index.html')),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached

      return fetch(request).then(async (response) => {
        if (response.ok) {
          const copy = response.clone()
          const cache = await caches.open(CACHE_NAME)
          await cache.put(request, copy)
        }
        return response
      })
    }),
  )
})
