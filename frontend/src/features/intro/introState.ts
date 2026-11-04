import { useSyncExternalStore } from 'react'

let playing = false
const listeners = new Set<() => void>()

export function setIntroPlaying(value: boolean): void {
  if (playing === value) return
  playing = value
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useIntroPlaying(): boolean {
  return useSyncExternalStore(subscribe, () => playing, () => false)
}
