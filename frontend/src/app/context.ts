import { createContext, useContext } from 'react'
import type { Health } from '../api/types'

export type EngineState = { status: 'checking' | 'up' | 'down'; health: Health | null; recheck: () => void }

export type ConsentState = {
  accepted: boolean
  storageFailed: boolean
  open: () => void
  request: () => boolean
}

export const EngineContext = createContext<EngineState>({ status: 'checking', health: null, recheck: () => {} })

export const ConsentContext = createContext<ConsentState>({
  accepted: false,
  storageFailed: false,
  open: () => {},
  request: () => false,
})

export const useEngine = () => useContext(EngineContext)
export const useConsent = () => useContext(ConsentContext)
