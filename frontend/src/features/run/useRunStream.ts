import { useEffect, useReducer, useState } from 'react'
import { eventsUrl } from '../../api/client'
import { parseRunEvent, type RunEvent } from '../../api/runEvents'

export type Connection = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'lost'

export type StreamState = { events: RunEvent[]; lastSeq: number }

export function streamReducer(state: StreamState, event: RunEvent): StreamState {
  if (event.seq <= state.lastSeq) return state
  return { events: [...state.events, event], lastSeq: event.seq }
}

export const isTerminal = (event: RunEvent) => event.type === 'run_done' || event.type === 'run_failed'

type SourceFactory = (url: string) => EventSource

const openSource: SourceFactory = (url) => new EventSource(url)

export function useRunStream(runId: string, factory: SourceFactory = openSource) {
  const [state, dispatch] = useReducer(streamReducer, { events: [], lastSeq: -1 })
  const [connection, setConnection] = useState<Connection>('connecting')
  const [unreadable, setUnreadable] = useState(0)
  const [firstAt, setFirstAt] = useState<number | null>(null)

  useEffect(() => {
    const source = factory(eventsUrl(`/api/runs/${encodeURIComponent(runId)}/events`))
    let finished = false
    source.onopen = () => setConnection('open')
    source.onmessage = (message: MessageEvent<string>) => {
      const event = parseRunEvent(message.data)
      if (!event) {
        setUnreadable((count) => count + 1)
        return
      }
      dispatch(event)
      setFirstAt((current) => current ?? performance.now())
      if (isTerminal(event)) {
        finished = true
        source.close()
        setConnection('closed')
      }
    }
    source.onerror = () => {
      if (finished) return
      setConnection(source.readyState === EventSource.CLOSED ? 'lost' : 'reconnecting')
    }
    return () => {
      finished = true
      source.close()
    }
  }, [runId, factory])

  return { ...state, connection, unreadable, firstAt }
}
