/// <reference lib="webworker" />
import { createSandbox } from './sandbox'

declare const self: ServiceWorkerGlobalScope

// State lives in memory: it resets when the browser stops an idle worker.
const sandbox = createSandbox()

self.addEventListener('install', () => void self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', event => {
  if (new URL(event.request.url).origin !== 'https://api.sandbox.orbit.dev') return
  event.respondWith(sandbox.handle(event.request).then(response => response ?? Response.error()))
})
