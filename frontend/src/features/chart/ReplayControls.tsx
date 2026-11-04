import { useEffect, useRef, useState } from 'react'
import { Button } from '../../ui/Button'
import { advanceCursor, clampCursor, REPLAY_SPEEDS, type ReplaySpeed } from './replay'
import type { Candle } from './types'

type ReplayControlsProps = {
  candles: readonly Candle[]
  cursor: number | null
  onCursor: (cursor: number | null) => void
}

function stamp(candle: Candle | undefined): string {
  return candle ? new Date(candle.time * 1000).toISOString().replace('T', ' ').slice(0, 16) : '—'
}

export function ReplayControls({ candles, cursor, onCursor }: ReplayControlsProps) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<ReplaySpeed>(4)
  const position = useRef(cursor ?? 0)
  const count = candles.length
  const active = cursor !== null

  useEffect(() => {
    if (cursor !== null) position.current = cursor
  }, [cursor])

  useEffect(() => {
    if (!playing || !active) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const next = advanceCursor(position.current, now - last, speed, count)
      last = now
      position.current = next
      const whole = Math.floor(next)
      onCursor(whole)
      if (whole >= count - 1) {
        setPlaying(false)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, count, onCursor, active])

  if (cursor === null) {
    return (
      <Button onClick={() => onCursor(0)} aria-label="Start a replay of the finished run's chart">
        Replay
      </Button>
    )
  }

  const step = (delta: number) => {
    setPlaying(false)
    onCursor(clampCursor(cursor + delta, count))
  }

  return (
    <div role="group" aria-label="Chart replay" className="flex flex-wrap items-center gap-1.5">
      <span className="label-caps text-accent-text">Replay</span>
      <Button onClick={() => step(-1)} aria-label="One bar back" className="px-2">
        ‹
      </Button>
      <Button variant="toggle" active={playing} onClick={() => setPlaying((value) => !value)} disabled={cursor >= count - 1} className="min-w-16">
        {playing ? 'Pause' : 'Play'}
      </Button>
      <Button onClick={() => step(1)} aria-label="One bar forward" className="px-2">
        ›
      </Button>
      <label className="flex items-center gap-1 font-mono text-[11.5px] text-ink-3">
        speed
        <select
          className="h-[30px] border border-line-strong bg-app px-1 font-mono text-[12px] text-ink"
          value={speed}
          onChange={(event) => setSpeed(Number(event.target.value) as ReplaySpeed)}
        >
          {REPLAY_SPEEDS.map((value) => (
            <option key={value} value={value}>
              {value}x
            </option>
          ))}
        </select>
      </label>
      <input
        type="range"
        min={0}
        max={Math.max(0, count - 1)}
        value={cursor}
        onChange={(event) => {
          setPlaying(false)
          onCursor(clampCursor(Number(event.target.value), count))
        }}
        aria-label="Replay position"
        aria-valuetext={`Bar ${cursor + 1} of ${count}, ${stamp(candles[cursor])} UTC`}
        className="h-[30px] w-40 accent-[var(--accent)] sm:w-56"
      />
      <span className="font-mono text-[11.5px] text-ink-2 tabular-nums" data-testid="replay-position">
        bar {(cursor + 1).toLocaleString('en-US')} / {count.toLocaleString('en-US')} · {stamp(candles[cursor])}
      </span>
      <Button
        onClick={() => {
          setPlaying(false)
          onCursor(null)
        }}
      >
        Exit replay
      </Button>
    </div>
  )
}
