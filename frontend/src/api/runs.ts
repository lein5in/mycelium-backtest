import { parseRunEvent, type RunEvent } from './runEvents'

export type ScenarioName = 'success' | 'failure'

type CreateRunResponse = { run_id: string; events_url: string }

const apiBase = import.meta.env.VITE_API_BASE_URL ?? ''

export async function createFakeRun(scenario: ScenarioName, speed = 1): Promise<CreateRunResponse> {
  const response = await fetch(`${apiBase}/api/dev/fake-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario, speed }),
  })
  if (!response.ok) throw new Error(`The engine refused the run (HTTP ${response.status}).`)
  return (await response.json()) as CreateRunResponse
}

export async function createRealRun(body: unknown): Promise<CreateRunResponse> {
  const response = await fetch(`${apiBase}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`The engine refused the run (HTTP ${response.status}).`)
  return (await response.json()) as CreateRunResponse
}

type StreamHandlers = {
  onEvent: (event: RunEvent) => void
  onInvalid: (raw: string) => void
  onConnectionLost: () => void
}

export function openRunEvents(eventsUrl: string, handlers: StreamHandlers): () => void {
  const source = new EventSource(`${apiBase}${eventsUrl}`)
  let finished = false
  source.onmessage = (message: MessageEvent<string>) => {
    const event = parseRunEvent(message.data)
    if (!event) {
      handlers.onInvalid(message.data)
      return
    }
    handlers.onEvent(event)
    if (event.type === 'run_done' || event.type === 'run_failed') {
      finished = true
      source.close()
    }
  }
  source.onerror = () => {
    if (finished) return
    source.close()
    handlers.onConnectionLost()
  }
  return () => {
    finished = true
    source.close()
  }
}
