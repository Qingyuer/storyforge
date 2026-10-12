import { isShowcaseAssetRequest, scopedStorage, SHOWCASE_NOTICE } from './policy'

/** Runs before importing any stores, router or application module. */
export function installShowcaseBoundary(): void {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(window, key, { configurable: true, value: scopedStorage(window[key]) })
  }
  const reject = (): never => { throw new Error(SHOWCASE_NOTICE) }
  const originalFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(new URL(String(input), location.href), init)
    if (!isShowcaseAssetRequest(request.url, (init?.method ?? request.method).toUpperCase(), location.origin)) reject()
    return originalFetch(input, { ...init, credentials: 'omit', redirect: 'error' })
  }
  // No alternate transport may reach a model, localhost bridge, or an upload service.
  window.XMLHttpRequest = class extends XMLHttpRequest { open(): never { return reject() } }
  window.WebSocket = class extends WebSocket { constructor() { reject(); super('') } }
  window.EventSource = class extends EventSource { constructor() { reject(); super('') } }
  navigator.sendBeacon = () => false
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => reject()
}
