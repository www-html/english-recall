const CACHE_PREFIX = 'english-recall-'
const CACHE_REVISION = '__PWA_CACHE_VERSION__'
const SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_REVISION}`
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${CACHE_REVISION}`
const CURRENT_CACHES = new Set([SHELL_CACHE, RUNTIME_CACHE])
const SCOPE_URL = new URL(self.registration.scope)
const SHELL_PATHS = [
  '',
  'index.html',
  'manifest.webmanifest',
  'favicon.svg',
  'pwa-icon-192.png',
  'pwa-icon-512.png',
  'pwa-icon-maskable-192.png',
  'pwa-icon-maskable-512.png',
]

function scopedUrl(path) {
  return new URL(path, SCOPE_URL).href
}

function isWithinScope(url) {
  return url.origin === SCOPE_URL.origin && url.pathname.startsWith(SCOPE_URL.pathname)
}

async function fetchRequired(request) {
  const response = await fetch(request, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Could not cache ${request}: ${response.status}`)
  return response
}

async function installShell() {
  const cache = await caches.open(SHELL_CACHE)
  const shellUrls = SHELL_PATHS.map(scopedUrl)
  const responses = await Promise.all(shellUrls.map(fetchRequired))

  await Promise.all(
    responses.map((response, index) => cache.put(shellUrls[index], response)),
  )

  const indexResponse = responses[1]
  const indexHtml = await indexResponse.text()
  const assetUrls = Array.from(
    indexHtml.matchAll(/(?:src|href)=["']([^"']*assets\/[^"'?#]+)["']/g),
    (match) => new URL(match[1], scopedUrl('index.html')).href,
  )
  const uniqueAssetUrls = [...new Set(assetUrls)]
  const assetResponses = await Promise.all(uniqueAssetUrls.map(fetchRequired))
  await Promise.all(
    assetResponses.map((response, index) => cache.put(uniqueAssetUrls[index], response)),
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(installShell())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && !CURRENT_CACHES.has(key))
          .map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    }),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

async function navigationResponse(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE)
      await cache.put(scopedUrl('index.html'), response.clone())
      return response
    }
    return await offlineIndex() ?? response
  } catch {
    return await offlineIndex() ?? Response.error()
  }
}

async function offlineIndex() {
  const request = scopedUrl('index.html')
  const runtimeCache = await caches.open(RUNTIME_CACHE)
  return await runtimeCache.match(request) ?? caches.match(request)
}

async function immutableAssetResponse(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(SHELL_CACHE)
    await cache.put(request, response.clone())
  }
  return response
}

async function runtimeResponse(request) {
  try {
    const response = await fetch(request)
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(RUNTIME_CACHE)
      await cache.put(request, response.clone())
    }
    return response
  } catch {
    return await caches.match(request) ?? Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (!isWithinScope(url) || url.pathname.endsWith('/service-worker.js')) return

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request))
    return
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(immutableAssetResponse(request))
    return
  }

  event.respondWith(runtimeResponse(request))
})
