import { INTRO_MS } from '../crawler/intro'

export const INTRO_KEY = 'mycelium.intro'

export type IntroDecision = { show: boolean; frozenAt: number | null; seed: number; forced: boolean }

let shownThisLoad = false
let decided: { search: string; decision: IntroDecision } | null = null

export function resetIntroGate(): void {
  shownThisLoad = false
  decided = null
}

type SessionStore = Pick<Storage, 'getItem' | 'setItem'>

export function decideIntro(search: string, storage: () => SessionStore | null): IntroDecision {
  if (decided?.search === search) return decided.decision
  const decision = decideOnce(search, storage)
  decided = { search, decision }
  return decision
}

function decideOnce(search: string, storage: () => SessionStore | null): IntroDecision {
  const params = new URLSearchParams(search)
  const seedParam = Number(params.get('seed'))
  const seed = Number.isInteger(seedParam) && seedParam > 0 ? seedParam : 1
  const timeParam = params.get('introTime')
  const frozenAt = timeParam !== null && Number.isFinite(Number(timeParam)) ? Math.min(INTRO_MS, Math.max(0, Number(timeParam) * 1000)) : null
  const mode = params.get('intro')
  if (mode === '0') return { show: false, frozenAt, seed, forced: false }
  if (mode === '1') return { show: true, frozenAt, seed, forced: true }
  try {
    const store = storage()
    if (!store) throw new Error('no session storage')
    if (store.getItem(INTRO_KEY) === '1') return { show: false, frozenAt, seed, forced: false }
    store.setItem(INTRO_KEY, '1')
    return { show: true, frozenAt, seed, forced: false }
  } catch {
    if (shownThisLoad) return { show: false, frozenAt, seed, forced: false }
    shownThisLoad = true
    return { show: true, frozenAt, seed, forced: false }
  }
}

export function browserSession(): SessionStore | null {
  return typeof window === 'undefined' ? null : window.sessionStorage
}
