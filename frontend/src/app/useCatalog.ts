import { useCallback, useEffect, useState } from 'react'
import { getLimits, getMarkets, getStrategies } from '../api/client'
import type { Limits, Markets, Strategies } from '../api/types'

export type Catalog = { limits: Limits; markets: Markets; strategies: Strategies }

export type CatalogState =
  | { status: 'loading' }
  | { status: 'ready'; catalog: Catalog }
  | { status: 'error'; error: unknown; retry: () => void }

export function useCatalog(): CatalogState {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<CatalogState>({ status: 'loading' })
  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((value) => value + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const options = { signal: controller.signal }
    Promise.all([getLimits(options), getMarkets(options), getStrategies(options)])
      .then(([limits, markets, strategies]) => setState({ status: 'ready', catalog: { limits, markets, strategies } }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', error, retry })
      })
    return () => controller.abort()
  }, [attempt, retry])

  return state
}
