export const CONSENT_KEY = 'mycelium.consent'
export const CONSENT_VERSION = '1'

export type ConsentStore = Pick<Storage, 'getItem' | 'setItem'>

function defaultStore(): ConsentStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readConsent(store: ConsentStore | null = defaultStore()): boolean {
  if (!store) return false
  try {
    return store.getItem(CONSENT_KEY) === CONSENT_VERSION
  } catch {
    return false
  }
}

export function writeConsent(store: ConsentStore | null = defaultStore()): boolean {
  if (!store) return false
  try {
    store.setItem(CONSENT_KEY, CONSENT_VERSION)
    return true
  } catch {
    return false
  }
}

export const CONSENT_POINTS = [
  'Mycelium Backtest is a research tool. It is not speculative, it is not financial advice, and it can make mistakes.',
  'Past results do not predict future ones.',
  'We do not sell or share your strategies or your data.',
  'Imports are processed to produce your result and are not kept.',
  'Your history is stored only in this browser.',
]
