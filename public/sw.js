const CACHE_NAME = 'task-manager-pwa-v3'
const APP_SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/pwa-icon-192.png',
  '/pwa-icon-512.png',
  '/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(cacheNames.map((cacheName) => (cacheName === CACHE_NAME ? Promise.resolve() : caches.delete(cacheName)))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }

  const requestUrl = new URL(event.request.url)
  if (requestUrl.origin !== self.location.origin) {
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const responseClone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put('/', responseClone))
          return response
        })
        .catch(() => caches.match('/')),
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse
      }

      return fetch(event.request).then((response) => {
        const responseClone = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone))
        return response
      })
    }),
  )
})

// Web Push is a separate system from Supabase Realtime: this handler only
// ever fires for genuine push messages delivered by the browser's push
// service, never for Realtime events. Realtime continues to be handled
// entirely inside the page (see useFamilyTasks.ts) and must never trigger a
// synthetic showNotification call from here.
self.addEventListener('push', (event) => {
  let payload = {}

  if (event.data) {
    try {
      payload = event.data.json()
    } catch (error) {
      // Payload was not valid JSON; fall back to defaults below.
      payload = {}
    }
  }

  const title = payload.title || 'Family Tasks'
  const body = payload.body || 'יש לך התראה חדשה.'
  const url = payload.url || '/'
  const tag = payload.tag || payload.notificationId || undefined

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: '/pwa-icon-192.png',
      badge: '/pwa-icon-192.png',
      data: {
        url,
        notificationId: payload.notificationId,
        type: payload.type,
      },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const clientUrl = new URL(client.url)
        if (clientUrl.origin === self.location.origin && 'focus' in client) {
          client.focus()
          if ('navigate' in client && targetUrl !== clientUrl.pathname) {
            return client.navigate(targetUrl)
          }
          return client
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }

      return undefined
    }),
  )
})
