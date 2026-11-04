import { useCallback, useEffect, useRef, useState } from 'react'
import { getHealth } from '../api/client'
import type { EngineState } from './context'

export const UP_INTERVAL_MS = 30_000
export const DOWN_INTERVAL_MS = 5_000

export function useHealth(check: typeof getHealth = getHealth): EngineState {
  const [state, setState] = useState<Omit<EngineState, 'recheck'>>({ status: 'checking', health: null })
  const [tick, setTick] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const recheck = useCallback(() => {
    setState((current) => ({ ...current, status: current.status === 'down' ? 'checking' : current.status }))
    setTick((value) => value + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    check({ signal: controller.signal })
      .then((health) => {
        if (cancelled) return
        setState({ status: 'up', health })
        timer.current = setTimeout(() => setTick((value) => value + 1), UP_INTERVAL_MS)
      })
      .catch(() => {
        if (cancelled) return
        setState((current) => ({ status: 'down', health: current.health }))
        timer.current = setTimeout(() => setTick((value) => value + 1), DOWN_INTERVAL_MS)
      })
    return () => {
      cancelled = true
      controller.abort()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [check, tick])

  return { ...state, recheck }
}
