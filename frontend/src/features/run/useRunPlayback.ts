import { useCallback, useEffect, useRef, useState } from 'react'
import type { RunEvent } from '../../api/runEvents'
import {
  membersOf,
  PlaybackScheduler,
  type DisplayItem,
  type DisplaySpeed,
  type PlaybackState,
  type StepInfo,
} from '../crawler/playback'

const IDLE: PlaybackState = {
  paused: false,
  speed: 1,
  pending: 0,
  shown: 0,
  engineDone: false,
  displayDone: false,
  engineSeconds: null,
}

export type Playback = {
  displayed: RunEvent[]
  state: PlaybackState
  setSpeed: (speed: DisplaySpeed) => void
  pause: () => void
  resume: () => void
  step: () => void
}

export function useRunPlayback(
  arrived: readonly RunEvent[],
  gateOpen: boolean,
  apply: (item: DisplayItem, info: StepInfo) => void,
): Playback {
  const schedulerRef = useRef<PlaybackScheduler | null>(null)
  const pushedRef = useRef(0)
  const applyRef = useRef(apply)
  const [displayed, setDisplayed] = useState<RunEvent[]>([])
  const [state, setState] = useState<PlaybackState>(IDLE)

  useEffect(() => {
    applyRef.current = apply
  }, [apply])

  useEffect(() => {
    let alive = true
    const scheduler = new PlaybackScheduler((item, info) => {
      applyRef.current(item, info)
      if (alive) setDisplayed((current) => [...current, ...membersOf(item)])
    })
    const unsubscribe = scheduler.subscribe(() => {
      if (alive) setState(scheduler.state)
    })
    schedulerRef.current = scheduler
    pushedRef.current = 0
    return () => {
      alive = false
      unsubscribe()
      scheduler.dispose()
      schedulerRef.current = null
      pushedRef.current = 0
      setDisplayed([])
    }
  }, [])

  useEffect(() => {
    const scheduler = schedulerRef.current
    if (!scheduler || !gateOpen) return
    for (let index = pushedRef.current; index < arrived.length; index += 1) {
      const event = arrived[index]
      if (event) scheduler.push(event)
    }
    pushedRef.current = arrived.length
  }, [arrived, gateOpen])

  const setSpeed = useCallback((speed: DisplaySpeed) => schedulerRef.current?.setSpeed(speed), [])
  const pause = useCallback(() => schedulerRef.current?.pause(), [])
  const resume = useCallback(() => schedulerRef.current?.resume(), [])
  const step = useCallback(() => schedulerRef.current?.step(), [])

  return { displayed, state, setSpeed, pause, resume, step }
}
